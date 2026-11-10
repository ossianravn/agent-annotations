// A first-time user: the receiver runs, but the panel has no token yet. The
// panel offers to add the page and asks for the token in the same prompt.
// "Not now" must close that offer (it once came straight back with Add page
// disabled), and pasting the token into the prompt must connect the page.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ChromePipe } from "./chrome_pipe.mjs";
import { click, evaluate, findChromePath, freePort, stopProcess, waitFor, waitForEvaluation } from "./journey_support.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-first-run-"));
const repo = path.join(temporaryRoot, "first-run-repo");
const token = "agent-annotations-first-run";
const [pagePort, receiverPort] = await Promise.all([freePort(), freePort()]);
const receiverUrl = `http://127.0.0.1:${receiverPort}`;
const url = `http://127.0.0.1:${pagePort}/`;

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end("<!doctype html><title>First run</title><h1>First run</h1>");
});
await new Promise((resolve) => server.listen(pagePort, "127.0.0.1", resolve));
const receiver = spawn(process.execPath, [
  path.join(root, "packages/agent-annotations-receiver/bin/agent-annotations-receiver.js"),
  "--repo", repo, "--host", "127.0.0.1", "--port", String(receiverPort), "--base-url", receiverUrl
], { env: { ...process.env, ANNOTATION_TOKEN: token }, stdio: "ignore" });
const chrome = ChromePipe.launch({ executablePath: await findChromePath(), profilePath: path.join(temporaryRoot, "profile") });

async function openPanel(extensionId, tabTargetId, previousId = null) {
  await chrome.command("Extensions.triggerAction", { id: extensionId, targetId: tabTargetId });
  const target = await chrome.waitForTarget((candidate) => (
    candidate.url === `chrome-extension://${extensionId}/sidepanel.html` && candidate.targetId !== previousId
  ), 30000);
  const session = await chrome.attach(target.targetId);
  await waitForEvaluation(chrome, session, "Boolean(document.querySelector('#send'))", "side panel");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { session, targetId: target.targetId };
}

// Named, because another repo's receiver may answer on the default port first.
const tokenPrompt = "!document.querySelector('#projectPrompt').hidden && Boolean(document.querySelector('#projectToken')) && document.querySelector('#projectPrompt').textContent.includes('first-run-repo')";

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${receiverUrl}/health`)).ok;
    } catch {
      return false;
    }
  }, "receiver startup");
  const { id } = await chrome.command("Extensions.loadUnpacked", { path: path.join(root, "chrome-extension") });
  const { targetId } = await chrome.command("Target.createTarget", { url });
  const pageSession = await chrome.attach(targetId);
  await waitForEvaluation(chrome, pageSession, "document.readyState === 'complete'", "page load");
  const tab = (await chrome.command("Target.getTargets", { filter: [{}] })).targetInfos
    .find((target) => target.type === "tab" && target.url === url);
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.includes(id));
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Point the panel at this receiver without a token, as a fresh install on another port would be.
  const first = await openPanel(id, tab.targetId);
  await click(chrome, first.session, "#openSettings");
  await waitForEvaluation(chrome, first.session, "document.querySelector('#settingsDialog').open", "settings dialog");
  await evaluate(chrome, first.session, `(() => {
    document.querySelector('#serverUrl').value = ${JSON.stringify(receiverUrl)};
    document.querySelector('#token').value = '';
  })()`);
  await click(chrome, first.session, "#saveSettings");
  await waitForEvaluation(chrome, first.session, tokenPrompt, "add-page prompt asking for the token");
  await evaluate(chrome, first.session, "document.querySelector('#settingsDialog').close()");

  // A page load refreshes the route; a token being typed must survive it.
  const typed = await evaluate(chrome, first.session, `(async () => {
    document.querySelector('#projectToken').value = 'half-typed';
    await (await import(chrome.runtime.getURL('sidepanel/projects.js'))).refreshRoute();
    return document.querySelector('#projectToken')?.value;
  })()`);
  assert.equal(typed, "half-typed", "a refresh must keep the token being typed");

  await click(chrome, first.session, "#projectPrompt .text-btn");
  await waitForEvaluation(
    chrome,
    first.session,
    "document.querySelector('#projectPrompt').hidden && document.querySelector('#connStatusLabel').textContent === 'Token missing'",
    "Not now closes the offer"
  );

  // "Not now" lasts for one panel session; the next one offers the page again.
  await chrome.command("Target.closeTarget", { targetId: first.targetId });
  await waitFor(async () => !(await chrome.targets()).some((target) => target.targetId === first.targetId), "side panel close");
  const second = await openPanel(id, tab.targetId, first.targetId);
  await waitForEvaluation(chrome, second.session, tokenPrompt, "add-page prompt in the next panel session");
  await evaluate(chrome, second.session, `document.querySelector('#projectToken').value = ${JSON.stringify(token)}`);
  await click(chrome, second.session, "#projectPrompt .btn-primary");
  await waitForEvaluation(
    chrome,
    second.session,
    "document.querySelector('#projectPrompt').hidden && document.querySelector('#projectName').textContent === 'first-run-repo' && document.querySelector('#connStatusLabel').textContent === 'Connected'",
    "page added with the pasted token"
  );
  process.stdout.write("First-run journey passed.\n");
} finally {
  await chrome.close();
  await stopProcess(receiver);
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
