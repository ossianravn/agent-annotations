import { getAnnotationSession } from "../shared/annotation_sessions.mjs";
import {
  $,
  getActiveTab,
  refreshActiveTabInfo,
  renderSelectedElement,
  state
} from "./shared.js";
import { showAnnotateError, updateSendEnabled } from "./feedback.js";
import { flushDraft, scheduleDraftSave } from "./drafts.js";

function syncToggle(enabled) {
  state.annotateEnabled = enabled;
  $("annotateToggle").checked = enabled;
}

export async function setAnnotateMode(enabled, options = {}) {
  const { persist = true } = options;
  const tabId = state.activeTab?.id;
  if (!tabId) throw new Error("No annotation tab is available.");
  syncToggle(enabled);
  if (enabled) showAnnotateError("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SET_ANNOTATION_MODE",
      tabId,
      enabled,
      persist
    });
    if (!response?.ok) throw new Error(response?.error || "Annotation mode could not be updated.");
  } catch (error) {
    syncToggle(false);
    showAnnotateError(error?.message || "Could not enable annotate mode on this page.");
    throw error;
  }
}

export async function restoreAnnotationMode() {
  const tabId = state.activeTab?.id;
  if (!tabId) return;
  const enabled = await getAnnotationSession(tabId);
  if (!enabled) {
    syncToggle(false);
    return;
  }
  await setAnnotateMode(true, { persist: false });
}

export async function clearSelectedElement() {
  state.selectedElement = null;
  renderSelectedElement();
  updateSendEnabled();
  scheduleDraftSave();
  const tabId = state.activeTab?.id;
  if (!tabId) return;
  await chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_CLEAR_SELECTION" }).catch((error) => {
    console.info("Could not clear selection on the page:", error);
  });
}

export async function refreshSelectedElementGeometry() {
  const tabId = state.activeTab?.id;
  if (!tabId) throw new Error("No annotation tab is available.");
  const response = await chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_GET_SELECTION" });
  if (!response?.ok || !response.payload) throw new Error("Select a visible element first.");
  state.selectedElement = response.payload;
  renderSelectedElement();
  updateSendEnabled();
  scheduleDraftSave();
  return response.payload;
}

export function bindAnnotationMessages() {
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message?.type) return;
    const messageTabId = message.tabId || sender?.tab?.id || null;
    if (state.lockedTabId && messageTabId && messageTabId !== state.lockedTabId) return;

    if (message.type === "ANNOTATE_MODE_SYNC") {
      syncToggle(Boolean(message.enabled));
    }
    if (message.type === "ANNOTATE_ELEMENT_SELECTED") {
      state.selectedElement = message.payload || null;
      renderSelectedElement();
      updateSendEnabled();
      scheduleDraftSave();
    }
    if (message.type === "ANNOTATE_DISABLED_BY_PAGE") {
      syncToggle(false);
    }
  });
}

export function bindLockedTabWatchers({ refreshList, restoreComposer }) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId !== state.lockedTabId || (!changeInfo.url && changeInfo.status !== "complete")) return;
    (async () => {
      if (changeInfo.url) await flushDraft();
      await refreshActiveTabInfo();
      if (changeInfo.url) await restoreComposer();
      if (changeInfo.status === "complete") await restoreAnnotationMode();
      await refreshList();
    })().catch((error) => console.warn("Failed to refresh the annotated tab:", error));
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId !== state.lockedTabId) return;
    state.lockedTabId = null;
    state.selectedElement = null;
    renderSelectedElement();
    updateSendEnabled();
    (async () => {
      const tab = await getActiveTab();
      state.lockedTabId = tab?.id || null;
      await refreshActiveTabInfo();
      await restoreComposer();
      await restoreAnnotationMode();
      await refreshList();
    })().catch((error) => console.warn("Failed to move the panel to the active tab:", error));
  });
}
