import {
  CONTENT_SCRIPT_FILES,
  clearAnnotationSession,
  getAnnotationSession,
  setAnnotationSession
} from "../shared/annotation_sessions.mjs";

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
    return;
  } catch {
    // A missing receiver is expected until annotation mode is used.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });
  const response = await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
  if (!response?.ok) throw new Error("The page annotation script did not start.");
}

async function broadcastMode(tabId, enabled) {
  try {
    await chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", tabId, enabled });
  } catch (error) {
    console.info("No side panel was listening for annotation state:", error);
  }
}

export async function setAnnotationMode(tabId, enabled, options = {}) {
  const { persist = true } = options;
  if (!Number.isInteger(tabId)) throw new Error("No active tab is available.");
  if (!enabled) {
    if (persist) await clearAnnotationSession(tabId);
    try {
      await chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_DISABLE" });
    } catch (error) {
      console.info("Annotation page was already unavailable while disabling:", error);
    }
    await broadcastMode(tabId, false);
    return;
  }

  try {
    await ensureContentScript(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "ANNOTATE_ENABLE" });
    if (persist) await setAnnotationSession(tabId, true);
    await broadcastMode(tabId, true);
  } catch (error) {
    await clearAnnotationSession(tabId);
    await broadcastMode(tabId, false);
    throw error;
  }
}

export async function toggleAnnotationMode() {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("No active tab is available.");
  const enabled = await getAnnotationSession(tab.id);
  await setAnnotationMode(tab.id, !enabled);
}

export async function pageDisabledAnnotation(tabId) {
  if (!Number.isInteger(tabId)) return;
  await clearAnnotationSession(tabId);
  await broadcastMode(tabId, false);
}
