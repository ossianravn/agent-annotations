import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    assert.doesNotMatch(created.attachments[0].path, /\\/, "stored paths must be portable across OSes");

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

    // Finishing a card changes its status in place; its files never move.
    const cardFile = path.join(temporaryRoot, ".agent-annotations/cards", created.id, "card.md");
    const resolveResponse = await fetch(`${baseUrl}/annotations/${created.id}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({ status: "resolved" })
    });
    assert.equal(resolveResponse.status, 200);
    assert.equal((await resolveResponse.json()).status, "done");
    assert.match(await readFile(cardFile, "utf8"), /"status": "done"/);
    const doneAsset = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`, {
      headers: { "X-Annotation-Token": token }
    });
    assert.equal(doneAsset.status, 200);

    // A hand-edited card must not point the receiver at files outside card assets.
    const cardText = await readFile(cardFile, "utf8");
    await writeFile(path.join(temporaryRoot, "outside-assets.png"), imageBytes);
    await writeFile(cardFile, cardText.replace(created.attachments[0].path, "outside-assets.png"), "utf8");
    const escapedAsset = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`, {
      headers: { "X-Annotation-Token": token }
    });
    assert.equal(escapedAsset.status, 400);
    await writeFile(cardFile, cardText, "utf8");

    const unauthorizedList = await fetch(`${baseUrl}/annotations?status=open`);
    assert.equal(unauthorizedList.status, 401);
    const listResponse = await fetch(`${baseUrl}/annotations?status=open&limit=abc`, {
      headers: { "X-Annotation-Token": token }
    });
    const list = await listResponse.json();
    assert.equal(list.annotations.some((annotation) => annotation.id === created.id), false, "done cards leave the open list");
    const doneList = await (await fetch(`${baseUrl}/annotations?status=done`, {
      headers: { "X-Annotation-Token": token }
    })).json();
    assert.equal(doneList.annotations.find((annotation) => annotation.id === created.id).comment, "Updated comment");

    const createWithId = (id) => fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({
        annotation: { id, routeKey: "client-id", comment: "Client ID" },
        assets: [{ name: "x.png", mime: "image/png", dataBase64: imageBytes.toString("base64") }]
      })
    });
    assert.equal((await createWithId("../../escaped")).status, 400);
    await assert.rejects(access(path.join(temporaryRoot, ".agent-annotations/escaped_0_x.png")));
    assert.equal((await createWithId(created.id)).status, 409);
    assert.equal((await createWithId("client-chosen.id_1")).status, 200);

    // A retried send (same ID and content hash) succeeds once, without a second record.
    const retry = (comment) => fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annotation-Token": token },
      body: JSON.stringify({ annotation: { id: "ann_retry", clientHash: "sha256-a", routeKey: "retry", comment } })
    });
    assert.equal((await (await retry("First send")).json()).duplicate, false);
    const repeated = await retry("First send");
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).duplicate, true);
    const retried = await readFile(path.join(temporaryRoot, ".agent-annotations/cards/ann_retry/card.md"), "utf8");
    assert.match(retried, /First send/);
    const conflicting = await fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annotation-Token": token },
      body: JSON.stringify({ annotation: { id: "ann_retry", clientHash: "sha256-b", comment: "Different" } })
    });
    assert.equal(conflicting.status, 409);

    const malformedId = await fetch(`${baseUrl}/annotations/%E0%A4%A`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": token
      },
      body: JSON.stringify({ comment: "Malformed" })
    });
    assert.equal(malformedId.status, 400);
  } finally {
    await stopProcess(receiver);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("open boards hear about card changes and can edit cards", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-events-test-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const receiver = spawn(process.execPath, [
    receiverScript, "--repo", temporaryRoot, "--host", "127.0.0.1", "--port", String(port)
  ], { cwd: root, env: { ...process.env, ANNOTATION_TOKEN: token }, stdio: "ignore" });
  const headers = { "Content-Type": "application/json", "X-Annotation-Token": token };
  const abort = new AbortController();
  try {
    await waitForReceiver(baseUrl);
    assert.equal((await (await fetch(`${baseUrl}/health`)).json()).wipLimitPerAgent, 2);
    assert.equal((await fetch(`${baseUrl}/events`)).status, 401);

    const created = await (await fetch(`${baseUrl}/annotations`, {
      method: "POST",
      headers,
      body: JSON.stringify({ annotation: { comment: "An idea without a page", status: "draft" } })
    })).json();
    assert.equal(created.status, "draft");

    const stream = await fetch(`${baseUrl}/events`, { headers, signal: abort.signal });
    const reader = stream.body.getReader();
    await reader.read();
    // A change written by someone else (here: an agent editing the file) must reach the board.
    const cardFile = path.join(temporaryRoot, ".agent-annotations/cards", created.id, "card.md");
    await writeFile(cardFile, (await readFile(cardFile, "utf8")).replace("An idea without a page", "Edited on disk"));
    const event = await Promise.race([
      reader.read().then(({ value }) => new TextDecoder().decode(value)),
      new Promise((_, reject) => setTimeout(() => reject(new Error("no change event within 4s")), 4000))
    ]);
    assert.match(event, /event: cards/);

    const edited = await (await fetch(`${baseUrl}/annotations/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ title: "Better title", rank: 12.5 })
    })).json();
    assert.equal(edited.annotation.title, "Better title");
    assert.equal(edited.annotation.rank, 12.5);
    const typed = await (await fetch(`${baseUrl}/annotations/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ severity: "bug", tags: ["Checkout", "checkout", " a11y "], acceptance: [{ text: "Button waits" }, "Spinner shows"] })
    })).json();
    assert.equal(typed.annotation.severity, "bug");
    assert.deepEqual(typed.annotation.tags, ["checkout", "a11y"]);
    assert.deepEqual(typed.annotation.acceptance, [{ text: "Button waits", done: false }, { text: "Spinner shows", done: false }]);
    const badType = await fetch(`${baseUrl}/annotations/${created.id}`, { method: "PATCH", headers, body: JSON.stringify({ severity: "urgent" }) });
    assert.equal(badType.status, 400);
    const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
    const withImage = await (await fetch(`${baseUrl}/annotations/${created.id}/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({ assets: [{ name: "pasted.png", mime: "image/png", dataBase64: imageBytes.toString("base64") }] })
    })).json();
    assert.equal(withImage.annotation.attachments[0].path, `.agent-annotations/cards/${created.id}/assets/0_pasted.png`);
    const image = await fetch(`${baseUrl}/annotations/${created.id}/attachments/0`, { headers });
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), imageBytes);
  } finally {
    abort.abort();
    await stopProcess(receiver);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("receiver listens on this computer only unless told otherwise", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-host-test-"));
  const port = await freePort();
  const receiver = spawn(process.execPath, [receiverScript, "--repo", temporaryRoot, "--port", String(port)], {
    cwd: root,
    env: { ...process.env, ANNOTATION_TOKEN: token, ANNOTATION_HOST: "" }
  });
  let output = "";
  receiver.stdout.setEncoding("utf8");
  receiver.stdout.on("data", (chunk) => { output += chunk; });
  try {
    await waitForReceiver(`http://127.0.0.1:${port}`);
    assert.match(output, new RegExp(`Listening on http://127\\.0\\.0\\.1:${port}`));
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.repoRoot, undefined, "the disk path is nobody else's business");
  } finally {
    await stopProcess(receiver);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("receiver keeps one project identity across restarts", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-project-test-"));
  const startHealth = async () => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const receiver = spawn(process.execPath, [
      receiverScript, "--repo", temporaryRoot, "--host", "127.0.0.1", "--port", String(port)
    ], { cwd: root, env: { ...process.env, ANNOTATION_TOKEN: token }, stdio: "ignore" });
    try {
      await waitForReceiver(baseUrl);
      return await (await fetch(`${baseUrl}/health`)).json();
    } finally {
      await stopProcess(receiver);
    }
  };

  try {
    const first = await startHealth();
    assert.match(first.projectId, /^prj_/);
    assert.equal(first.name, path.basename(temporaryRoot));
    const second = await startHealth();
    assert.equal(second.projectId, first.projectId);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("standalone and scaffold receiver runtimes remain identical", async () => {
  const check = spawnSync(process.execPath, [path.join(root, "scripts/sync-receiver-copies.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
