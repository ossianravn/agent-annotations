import assert from "node:assert/strict";
import { click, evaluate, waitForEvaluation } from "./journey_support.mjs";

const tabZoom = (tabId) => `chrome.tabs.getZoom(${tabId})`;

export async function verifyDesktopWidthToggle(chrome, panelSession, pageSession, tabId) {
  assert.equal(await evaluate(chrome, panelSession, tabZoom(tabId)), 1);
  await click(chrome, panelSession, "#desktopWidthToggle");
  await waitForEvaluation(chrome, panelSession, `${tabZoom(tabId)}.then((zoom) => zoom < 1)`, "desktop width zoom");

  // The page must get back the width it would have without the panel beside it.
  const expectedWidth = await evaluate(chrome, panelSession, `chrome.tabs.get(${tabId}).then((tab) => tab.width + innerWidth)`);
  await waitForEvaluation(chrome, pageSession, `Math.abs(innerWidth - ${expectedWidth}) <= 24`, "full page width");
  await waitForEvaluation(chrome, panelSession, "/^Page \\d+px · \\d+%$/.test(document.querySelector('#layoutInfo').textContent)", "layout readout");

  await click(chrome, panelSession, "#desktopWidthToggle");
  await waitForEvaluation(chrome, panelSession, `${tabZoom(tabId)}.then((zoom) => zoom === 1)`, "zoom restored by switch");
}

// Closing the panel must hand the tab its zoom back, even though the panel is gone.
export async function verifyZoomRestoredOnPanelClose(chrome, panelSession, panelTargetId, probeSession, tabId) {
  await click(chrome, panelSession, "#desktopWidthToggle");
  await waitForEvaluation(chrome, panelSession, `${tabZoom(tabId)}.then((zoom) => zoom < 1)`, "desktop width before close");
  await chrome.command("Target.closeTarget", { targetId: panelTargetId });
  await waitForEvaluation(chrome, probeSession, `${tabZoom(tabId)}.then((zoom) => zoom === 1)`, "zoom restored on panel close");
}
