// Updating or reloading the extension while a page is in annotate mode leaves
// the old content script running there. It must step aside: the page has to
// stay clickable, and the new copy has to receive mouse clicks.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { ChromePipe } from "./chrome_pipe.mjs";
import { click, evaluate, findChromePath, freePort, waitForEvaluation } from "./journey_support.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-reload-"));
const port = await freePort();
const page = `<!doctype html><html><body style="margin:40px;font:16px system-ui">
  <h1 id="title">Reload journey</h1>
  <p class="lede">A paragraph to select.</p>
  <button type="button" data-testid="counter" onclick="this.dataset.clicks = Number(this.dataset.clicks || 0) + 1">Count</button>
</body></html>`;
const server = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(page);
});
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${port}/`;
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

const selected = (panel) => evaluate(chrome, panel, "document.querySelector('#selectedSummary').textContent");

try {
  const { id } = await chrome.command("Extensions.loadUnpacked", { path: path.join(root, "chrome-extension") });
  const { targetId } = await chrome.command("Target.createTarget", { url });
  const pageSession = await chrome.attach(targetId);
  await waitForEvaluation(chrome, pageSession, "document.readyState === 'complete'", "page load");
  const tab = (await chrome.command("Target.getTargets", { filter: [{}] })).targetInfos
    .find((target) => target.type === "tab" && target.url === url);
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.includes(id));
  await new Promise((resolve) => setTimeout(resolve, 800));

  const first = await openPanel(id, tab.targetId);
  await click(chrome, first.session, "#annotateToggle");
  await waitForEvaluation(chrome, pageSession, "Boolean(document.querySelector('#__agent_annotations_overlay'))", "overlay");
  await click(chrome, pageSession, "#title");
  await waitForEvaluation(chrome, first.session, "document.querySelector('#selectedSummary').textContent === '#title'", "mouse-click selection");

  // Reload the extension while the page is still in annotate mode.
  const worker = (await chrome.command("Target.getTargets", { filter: [{}] })).targetInfos
    .find((target) => target.type === "service_worker" && target.url.includes(id));
  await chrome.command("Runtime.evaluate", { expression: "chrome.runtime.reload()" }, await chrome.attach(worker.targetId)).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2500));
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.includes(id), 15000);

  await click(chrome, pageSession, "[data-testid=counter]");
  await waitForEvaluation(chrome, pageSession, "document.querySelector('[data-testid=counter]').dataset.clicks === '1'", "page stays clickable after the update");

  const second = await openPanel(id, tab.targetId, first.targetId);
  if (!await evaluate(chrome, second.session, "document.querySelector('#annotateToggle').checked")) {
    await click(chrome, second.session, "#annotateToggle");
  }
  await waitForEvaluation(chrome, pageSession, "Boolean(document.querySelector('#__agent_annotations_overlay'))", "overlay after reload");
  await click(chrome, pageSession, ".lede");
  await waitForEvaluation(chrome, second.session, "document.querySelector('#selectedSummary').textContent.includes('p.lede')", "mouse-click selection after reload");
  assert.equal(await evaluate(chrome, pageSession, "document.querySelector('[data-testid=counter]').dataset.clicks"), "1", "annotate mode keeps clicks from the page");
  assert.match(await selected(second.session), /p\.lede/);
  process.stdout.write("Extension reload journey passed.\n");
} finally {
  await chrome.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
}
