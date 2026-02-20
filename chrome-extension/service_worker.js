/**
 * Service worker (Manifest V3)
 * - Opens the side panel on action click
 * - Captures screenshots on demand
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("sidePanel.setPanelBehavior failed:", err));

  chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
});

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      if (!dataUrl) return reject(new Error("No screenshot data returned."));
      resolve(dataUrl);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
    return true;
  } catch {}

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content_script.js"]
    });
    await sleep(60);
    await chrome.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
    return true;
  } catch (e) {
    console.warn("Failed to inject content script:", e);
    return false;
  }
}

async function setAnnotateEnabledForActiveTab(enabled) {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: "No active tab." };

  if (!enabled) {
    await chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ANNOTATE_DISABLE" });
    } catch {}
    chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", enabled: false, tabId: tab.id }).catch(() => {});
    return { ok: true, enabled: false };
  }

  const ok = await ensureContentScript(tab.id);
  if (!ok) {
    await chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
    chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", enabled: false }).catch(() => {});
    return { ok: false, error: "Could not enable annotate mode on this page." };
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ANNOTATE_ENABLE" });
    await chrome.storage.local.set({ annotateEnabled: true }).catch(() => {});
    chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", enabled: true, tabId: tab.id }).catch(() => {});
    return { ok: true, enabled: true };
  } catch (e) {
    await chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
    chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", enabled: false, tabId: tab.id }).catch(() => {});
    return { ok: false, error: String(e?.message || e) };
  }
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-annotation-mode") return;
  (async () => {
    const saved = await chrome.storage.local.get(["annotateEnabled"]);
    const next = !saved.annotateEnabled;
    await setAnnotateEnabledForActiveTab(next);
  })().catch((e) => console.warn("toggle-annotation-mode failed:", e));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return; // don't keep channel open

  if (msg.type === "CAPTURE_VISIBLE_TAB") {
    (async () => {
      try {
        const dataUrl = await captureVisibleTab(msg.windowId);
        sendResponse({ ok: true, dataUrl });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // async response
  }

  if (msg.type === "PING_BG") {
    sendResponse({ ok: true, ts: Date.now() });
    return; // sync response
  }

  if (msg.type === "ANNOTATE_DISABLED_BY_PAGE") {
    chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
    chrome.runtime.sendMessage({ type: "ANNOTATE_MODE_SYNC", enabled: false, tabId: sender?.tab?.id || null }).catch(() => {});
    sendResponse?.({ ok: true });
    return;
  }

  // For all other messages, do not return true (prevents hanging message ports).
});
