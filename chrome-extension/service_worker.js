import {
  pageDisabledAnnotation,
  setAnnotationMode,
  toggleAnnotationMode
} from "./background/annotation_commands.js";
import { captureVisibleTab } from "./background/capture.js";
import { configureSidePanel, openPanelForTab } from "./background/panel.js";
import { clearAnnotationSession } from "./shared/annotation_sessions.mjs";
import { deleteDraftRecordsForTab } from "./shared/draft_store.mjs";

function configure() {
  configureSidePanel().catch((error) => console.warn("Could not configure the side panel:", error));
}

chrome.runtime.onInstalled.addListener(configure);
chrome.runtime.onStartup.addListener(configure);
configure();

chrome.action.onClicked.addListener(openPanelForTab);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-annotation-mode") return;
  toggleAnnotationMode().catch((error) => console.warn("Could not toggle annotation mode:", error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  Promise.all([
    clearAnnotationSession(tabId),
    deleteDraftRecordsForTab(tabId)
  ]).catch((error) => {
    console.warn(`Could not clear annotation data for closed tab ${tabId}:`, error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;
  if (message.type === "PING_BG") {
    sendResponse({ ok: true, ts: Date.now() });
    return;
  }
  if (message.type === "CAPTURE_VISIBLE_TAB") {
    captureVisibleTab(message.windowId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message.type === "SET_ANNOTATION_MODE") {
    setAnnotationMode(message.tabId, Boolean(message.enabled), { persist: message.persist !== false })
      .then(() => sendResponse({ ok: true, enabled: Boolean(message.enabled) }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message.type === "ANNOTATE_DISABLED_BY_PAGE") {
    pageDisabledAnnotation(sender?.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
});
