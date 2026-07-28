import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const receiverScript = path.join(
  root,
  "packages/agent-annotations-receiver/bin/agent-annotations-receiver.js"
);
const token = "receiver-integration-token";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForReceiver(baseUrl) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // The receiver has not bound its port yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Receiver did not start.");
}

async function stopProcess(child) {
  if (child.exitCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

test("receiver updates comments and serves authenticated attachment bytes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-receiver-test-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const receiver = spawn(process.execPath, [
    receiverScript,
    "--repo", temporaryRoot,
    "--host", "127.0.0.1",
    "--port", String(port),
    "--base-url", baseUrl
  ], {
    cwd: root,
    env: { ...process.env, ANNOTATION_TOKEN: token },
    stdio: "ignore"
  });

  try {
    await waitForReceiver(baseUrl);
    const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const createResponse = await fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({
        annotation: {
          routeKey: "http://example.test/create",
          url: "http://example.test/create",
          comment: "Original comment"
        },
        assets: [{
          name: "element.png",
          mime: "image/png",
          dataUrl: `data:image/png;base64,${imageBytes.toString("base64")}`
        }]
      })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 200);
    assert.ok(created.id);

    const unauthorizedEdit = await fetch(`${baseUrl}/annotations/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "Not allowed" })
    });
    assert.equal(unauthorizedEdit.status, 401);

    const emptyEdit = await fetch(`${baseUrl}/annotations/${created.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({ comment: "   " })
    });
    assert.equal(emptyEdit.status, 400);

    const editResponse = await fetch(`${baseUrl}/annotations/${created.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({ comment: "Updated comment" })
    });
    const edited = await editResponse.json();
    assert.equal(editResponse.status, 200);
    assert.equal(edited.annotation.comment, "Updated comment");
    assert.ok(edited.annotation.updatedAt);

    const unauthorizedAsset = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`);
    assert.equal(unauthorizedAsset.status, 401);
    const assetResponse = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`, {
      headers: { "X-Annotation-Token": token }
    });
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), imageBytes);

    const rawUploadResponse = await fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({
        annotation: { routeKey: "raw-upload", comment: "Raw upload" },
        assets: [{
          name: "raw.png",
          mime: "image/png",
          dataBase64: imageBytes.toString("base64")
        }]
      })
    });
    const rawUpload = await rawUploadResponse.json();
    assert.equal(rawUploadResponse.status, 200);
    assert.equal(rawUpload.attachments.length, 1);
    const rawAssetResponse = await fetch(`${baseUrl}/annotations/${rawUpload.id}/attachments/0`, {
      headers: { "X-Annotation-Token": token }
    });
    assert.equal(rawAssetResponse.status, 200);
    assert.deepEqual(Buffer.from(await rawAssetResponse.arrayBuffer()), imageBytes);

    const multiUploadResponse = await fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({
        annotation: { routeKey: "atomic-resolve", comment: "Atomic resolve" },
        assets: [
          { name: "first.png", mime: "image/png", dataUrl: `data:image/png;base64,${imageBytes.toString("base64")}` },
          { name: "second.png", mime: "image/png", dataUrl: `data:image/png;base64,${imageBytes.toString("base64")}` }
        ]
      })
    });
    const multiUpload = await multiUploadResponse.json();
    const firstSource = path.join(temporaryRoot, multiUpload.attachments[0].path);
    const secondSource = path.join(temporaryRoot, multiUpload.attachments[1].path);
    const firstDestination = path.join(
      temporaryRoot,
      ".agent-annotations/assets/resolved",
      path.basename(firstSource)
    );
    await unlink(secondSource);
    const failedResolve = await fetch(`${baseUrl}/annotations/${multiUpload.id}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({ status: "resolved" })
    });
    assert.equal(failedResolve.status, 500);
    await access(firstSource);
    await assert.rejects(access(firstDestination));

    const inboxPath = path.join(temporaryRoot, ".agent-annotations/inbox.jsonl");
    const records = (await readFile(inboxPath, "utf8")).trim().split("\n").map(JSON.parse);
    const stored = records.find((record) => record.id === created.id);
    stored.attachments[0].path = "outside-assets.png";
    await writeFile(path.join(temporaryRoot, "outside-assets.png"), imageBytes);
    await writeFile(inboxPath, `${records.map(JSON.stringify).join("\n")}\n`, "utf8");
    const escapedAsset = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`, {
      headers: { "X-Annotation-Token": token }
    });
    assert.equal(escapedAsset.status, 400);

    const listResponse = await fetch(`${baseUrl}/annotations?status=open`);
    const list = await listResponse.json();
    assert.equal(list.annotations.find((annotation) => annotation.id === created.id).comment, "Updated comment");
  } finally {
    await stopProcess(receiver);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("standalone and scaffold receiver runtimes remain identical", async () => {
  const runtimeFiles = [
    "agent-annotations-receiver.js",
    "agent-annotations-receiver-assets.cjs"
  ];
  for (const filename of runtimeFiles) {
    const canonical = await readFile(path.join(root, "packages/agent-annotations-receiver/bin", filename));
    const installedFilename = filename.replace(/\.js$/, ".cjs");
    const copies = [
      `repo-integration/.tools/${installedFilename}`,
      `packages/agent-annotations/templates/repo-integration/.tools/${installedFilename}`
    ];
    for (const relativePath of copies) {
      assert.deepEqual(await readFile(path.join(root, relativePath)), canonical);
    }
  }
});
