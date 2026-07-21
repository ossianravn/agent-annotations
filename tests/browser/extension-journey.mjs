import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ChromePipe } from "./chrome_pipe.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const extensionPath = path.join(root, "chrome-extension");
const receiverPath = path.join(root, "packages/agent-annotations-receiver/bin/agent-annotations-receiver.js");
const fixturePath = path.join(root, "tests/fixtures/annotation-page.html");
const token = "agent-annotations-browser-test";
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-browser-"));
const profilePath = path.join(temporaryRoot, "chrome-profile");
const receiverRepo = path.join(temporaryRoot, "receiver-repo");

async function findChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const browserRoot = path.join(os.homedir(), ".agent-browser/browsers");
  try {
    const versions = (await readdir(browserRoot))
      .filter((name) => name.startsWith("chrome-"))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    if (versions[0]) return path.join(browserRoot, versions[0], "chrome");
  } catch {
    // Fall through to the system Chrome path.
  }
  return "/usr/bin/google-chrome";
}

const chromePath = await findChromePath();

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

async function waitFor(check, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function evaluate(chrome, sessionId, expression) {
  const response = await chrome.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function click(chrome, sessionId, selector) {
  const response = await chrome.command("Runtime.evaluate", {
    expression: `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing click target: ${selector}");
    element.click();
  })()`,
    userGesture: true,
    awaitPromise: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
}

async function waitForEvaluation(chrome, sessionId, expression, description) {
  await waitFor(() => evaluate(chrome, sessionId, expression), description);
}

async function stopProcess(process) {
  if (!process || process.exitCode != null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    process.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

await access(chromePath);
const [receiverPort, fixturePort] = await Promise.all([freePort(), freePort()]);
const fixtureHtml = await readFile(fixturePath);
const fixtureServer = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(fixtureHtml);
});
await new Promise((resolve) => fixtureServer.listen(fixturePort, "127.0.0.1", resolve));

const receiver = spawn(process.execPath, [
  receiverPath,
  "--repo", receiverRepo,
  "--host", "127.0.0.1",
  "--port", String(receiverPort),
  "--base-url", `http://127.0.0.1:${receiverPort}`
], {
  cwd: root,
  env: { ...process.env, ANNOTATION_TOKEN: token },
  stdio: ["ignore", "ignore", "pipe"]
});
let receiverErrors = "";
receiver.stderr.setEncoding("utf8");
receiver.stderr.on("data", (chunk) => { receiverErrors += chunk; });
await waitFor(async () => {
  try {
    return (await fetch(`http://127.0.0.1:${receiverPort}/health`)).ok;
  } catch {
    return false;
  }
}, "receiver startup");

const chrome = ChromePipe.launch({ executablePath: chromePath, profilePath });
try {
  const { id: extensionId } = await chrome.command("Extensions.loadUnpacked", { path: extensionPath });
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/annotation-page.html`;
  const sidePanelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const { targetId: pageTargetId } = await chrome.command("Target.createTarget", { url: fixtureUrl });
  const pageSession = await chrome.attach(pageTargetId);
  await waitForEvaluation(chrome, pageSession, "document.readyState === 'complete'", "fixture page load");

  const allTargets = (await chrome.command("Target.getTargets", { filter: [{}] })).targetInfos;
  const tabTarget = allTargets.find((target) => target.type === "tab" && target.url === fixtureUrl);
  assert.ok(tabTarget, "fixture tab target should exist");
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.includes(extensionId));
  await new Promise((resolve) => setTimeout(resolve, 500));

  await chrome.command("Extensions.triggerAction", { id: extensionId, targetId: tabTarget.targetId });
  let panelTarget = await chrome.waitForTarget((target) => target.url === sidePanelUrl);
  let panelSession = await chrome.attach(panelTarget.targetId);
  await waitForEvaluation(chrome, panelSession, "Boolean(document.querySelector('#send'))", "side panel load");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const startup = await evaluate(chrome, panelSession, `(async () => {
    const shared = await import(chrome.runtime.getURL('sidepanel/shared.js'));
    return {
      actionStatus: document.querySelector('#actionStatus').textContent,
      activeUrl: shared.state.activeUrl,
      lockedTabId: shared.state.lockedTabId
    };
  })()`);
  assert.equal(startup.actionStatus, "", `side panel startup failed: ${startup.actionStatus}`);
  assert.ok(startup.lockedTabId, "side panel should lock to the fixture tab");

  await click(chrome, panelSession, "#openSettings");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#settingsDialog').open", "settings dialog");
  await evaluate(chrome, panelSession, `(() => {
    document.querySelector('#serverUrl').value = 'http://127.0.0.1:${receiverPort}';
    document.querySelector('#token').value = '${token}';
  })()`);
  await click(chrome, panelSession, "#saveSettings");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#connStatusLabel').textContent === 'CONNECTED'",
    "receiver connection"
  );
  await chrome.command("Runtime.evaluate", { expression: "document.querySelector('#settingsDialog').close()" }, panelSession);

  await click(chrome, panelSession, "#annotateToggle");
  await waitForEvaluation(
    chrome,
    pageSession,
    "Boolean(document.querySelector('#__agent_annotations_overlay'))",
    "annotation overlay"
  );
  await waitFor(async () => {
    const { data } = await chrome.command("Extensions.getStorageItems", {
      id: extensionId,
      storageArea: "session"
    }, pageSession);
    return data[`annotationSession:${startup.lockedTabId}`] === true;
  }, "persisted annotation mode");
  await evaluate(chrome, pageSession, "document.querySelector('[data-testid=checkout-action]').focus()");
  await chrome.command("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13
  }, pageSession);
  await chrome.command("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13
  }, pageSession);
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#selectedSummary').textContent.includes('checkout-action')",
    "selected element"
  );

  await click(chrome, panelSession, "#attachScreenshot");
  await waitForEvaluation(chrome, panelSession, "document.querySelectorAll('.attachment').length === 1", "screenshot");
  await evaluate(chrome, panelSession, `(() => {
    const comment = document.querySelector('#comment');
    comment.value = 'Browser journey annotation';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(chrome, panelSession, "input[value='bug']");
  await evaluate(chrome, panelSession, "import(chrome.runtime.getURL('sidepanel/drafts.js')).then((module) => module.flushDraft())");

  const workerTarget = (await chrome.targets()).find((target) => target.type === "service_worker" && target.url.includes(extensionId));
  assert.ok(workerTarget, "extension service worker target should exist");
  const previousPanelTargetId = panelTarget.targetId;
  await chrome.command("Target.closeTarget", { targetId: panelTarget.targetId });
  await waitFor(
    async () => !(await chrome.targets()).some((target) => target.targetId === previousPanelTargetId),
    "side panel shutdown"
  );
  await chrome.command("Target.closeTarget", { targetId: workerTarget.targetId });
  await waitFor(
    async () => !(await chrome.targets()).some((target) => target.targetId === workerTarget.targetId),
    "service worker shutdown"
  );
  const { data: restartedSession } = await chrome.command("Extensions.getStorageItems", {
    id: extensionId,
    storageArea: "session"
  }, pageSession);
  assert.equal(restartedSession[`annotationSession:${startup.lockedTabId}`], true);
  await chrome.command("Extensions.triggerAction", { id: extensionId, targetId: tabTarget.targetId });
  panelTarget = await chrome.waitForTarget((target) => target.url === sidePanelUrl && target.targetId !== previousPanelTargetId);
  panelSession = await chrome.attach(panelTarget.targetId);
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#comment')?.value === 'Browser journey annotation'", "draft recovery");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#annotateToggle')?.checked", "annotation mode recovery");
  const restored = await evaluate(chrome, panelSession, `(async () => {
    const shared = await import(chrome.runtime.getURL('sidepanel/shared.js'));
    return {
      attachments: shared.state.attachments.length,
      selected: shared.state.selectedElement?.element?.primary?.value,
      enabled: document.querySelector('#annotateToggle').checked
    };
  })()`);
  assert.deepEqual(restored, { attachments: 1, selected: "checkout-action", enabled: true });

  await click(chrome, panelSession, "#attachElementShot");
  await waitForEvaluation(chrome, panelSession, "document.querySelectorAll('.attachment').length === 2", "element crop");
  await click(chrome, panelSession, "#send");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#actionStatus').textContent === 'Annotation saved.'", "annotation save");
  await waitForEvaluation(chrome, panelSession, "Boolean(document.querySelector('.item'))", "annotation list item");
  await click(chrome, panelSession, ".item");
  await click(chrome, panelSession, "#markResolved");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#list').textContent.includes('No unresolved')", "annotation resolve");

  const resolved = await readFile(path.join(receiverRepo, ".agent-annotations/inbox-resolved.jsonl"), "utf8");
  assert.match(resolved, /Browser journey annotation/);
  assert.match(resolved, /"severity":"bug"/);
  assert.match(resolved, /"attachments":\[/);

  const cleanupKey = await evaluate(chrome, panelSession, `(async () => {
    const shared = await import(chrome.runtime.getURL('sidepanel/shared.js'));
    document.querySelector('#comment').value = 'Discard this closed-tab draft';
    document.querySelector('#comment').dispatchEvent(new Event('input', { bubbles: true }));
    await (await import(chrome.runtime.getURL('sidepanel/drafts.js'))).flushDraft();
    return shared.state.lockedTabId + ':' + shared.state.routeKey;
  })()`);
  const { targetId: probeTargetId } = await chrome.command("Target.createTarget", { url: sidePanelUrl });
  const probeSession = await chrome.attach(probeTargetId);
  await waitForEvaluation(chrome, probeSession, "document.readyState === 'complete'", "draft cleanup probe");
  assert.equal(await evaluate(chrome, probeSession, `(async () => Boolean(
    await (await import(chrome.runtime.getURL('shared/draft_store.mjs'))).loadDraftRecord(${JSON.stringify(cleanupKey)})
  ))()`), true);
  await chrome.command("Target.closeTarget", { targetId: pageTargetId });
  await waitForEvaluation(chrome, probeSession, `(async () => !Boolean(
    await (await import(chrome.runtime.getURL('shared/draft_store.mjs'))).loadDraftRecord(${JSON.stringify(cleanupKey)})
  ))()`, "closed-tab draft cleanup");
  process.stdout.write("Browser extension journey passed.\n");
} finally {
  await chrome.close();
  await stopProcess(receiver);
  await new Promise((resolve) => fixtureServer.close(resolve));
  if (temporaryRoot.startsWith(os.tmpdir())) {
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      .catch((error) => process.stderr.write(`Temporary browser files were not removed: ${error.message}\n`));
  }
  if (receiverErrors) process.stderr.write(receiverErrors);
}
