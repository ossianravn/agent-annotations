import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const extensionRoot = path.resolve("chrome-extension");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(location));
    else if (/\.(css|html|m?js)$/.test(entry.name)) files.push(location);
  }
  return files;
}

test("manifest grants page access only on explicit user action", async () => {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions.includes("<all_urls>"), false);
  assert.equal(manifest.permissions.includes("activeTab"), true);
  assert.equal(manifest.background.type, "module");
});

test("all programmatically injected content modules are packaged", async () => {
  const source = await readFile(
    path.join(extensionRoot, "shared", "annotation_sessions.mjs"),
    "utf8"
  );
  const matches = [...source.matchAll(/"([^\"]+\.js)"/g)].map((match) => match[1]);
  assert.ok(matches.length >= 4);
  for (const relativePath of matches) {
    assert.equal((await stat(path.join(extensionRoot, relativePath))).isFile(), true);
  }
});

test("manifest icons exist at every declared pixel size", async () => {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.icons), ["16", "32", "48", "128"]);
  assert.deepEqual(manifest.action.default_icon, {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png"
  });

  for (const [declaredSize, relativePath] of Object.entries(manifest.icons)) {
    const image = await readFile(path.join(extensionRoot, relativePath));
    assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(image.readUInt32BE(16), Number(declaredSize));
    assert.equal(image.readUInt32BE(20), Number(declaredSize));
  }
});

test("handwritten extension sources stay below the 300-line module limit", async () => {
  for (const file of await sourceFiles(extensionRoot)) {
    const lineCount = (await readFile(file, "utf8")).split("\n").length;
    assert.ok(lineCount <= 300, `${path.relative(extensionRoot, file)} has ${lineCount} lines`);
  }
});
