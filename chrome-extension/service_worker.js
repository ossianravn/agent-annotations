/**
 * Service worker (Manifest V3)
 * - Opens the side panel on action click
 * - Captures screenshots on demand
 */
const panelStateByWindowId = new Map(); // windowId -> { tabId, open }

function hasSidePanelOpen() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.open === "function");
}

function hasSidePanelClose() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.close === "function");
}

async function configureSidePanelBehavior() {
  if (!chrome.sidePanel) return;

  // Prefer handling action clicks ourselves so we can enable the panel for the
  // clicked tab before opening it.
  if (hasSidePanelOpen()) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    } catch (err) {
      console.warn("sidePanel.setPanelBehavior failed:", err);
    }
    // Disable the panel by default so it doesn't follow the active tab.
    try {
      await chrome.sidePanel.setOptions({ enabled: false });
    } catch (err) {
      console.warn("sidePanel.setOptions(default) failed:", err);
    }
    return;
  }

  // Fallback: Older Chrome without chrome.sidePanel.open().
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn("sidePanel.setPanelBehavior failed:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureSidePanelBehavior().catch(() => {});
  chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  configureSidePanelBehavior().catch(() => {});
});

configureSidePanelBehavior().catch(() => {});

async function setSidePanelOptionsForTab(tabId, options) {
  if (!tabId || !chrome.sidePanel) return;
  try {
    await chrome.sidePanel.setOptions({ tabId, ...options });
  } catch (e) {
    console.warn("sidePanel.setOptions failed:", e);
  }
}

async function lockSidePanelToTab(tabId) {
  if (!tabId) return { ok: false, error: "Missing tabId." };
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {}
  if (!tab?.id) return { ok: false, error: "Tab not found." };

  const windowId = tab.windowId;
  if (windowId == null) return { ok: false, error: "Missing windowId." };

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {}

  const ops = [];
  for (const t of tabs) {
    if (!t?.id) continue;
    if (t.id === tabId) {
      ops.push(setSidePanelOptionsForTab(t.id, { path: "sidepanel.html", enabled: true }));
    } else {
      ops.push(setSidePanelOptionsForTab(t.id, { enabled: false }));
    }
  }
  await Promise.all(ops);
  return { ok: true, tabId, windowId };
}

function openSidePanelForTab(tabId) {
  if (!hasSidePanelOpen()) return;

  // Important: chrome.sidePanel.open() must be called directly in response to a user action.
  // Do not await before calling it (the user gesture will be lost).
  setSidePanelOptionsForTab(tabId, { path: "sidepanel.html", enabled: true });
  chrome.sidePanel.open({ tabId }).catch((e) => console.warn("sidePanel.open failed:", e));

  // Best-effort: hide the panel on other tabs in the same window after opening.
  lockSidePanelToTab(tabId).catch(() => {});
}

async function closeSidePanelForTab(tabId, windowId) {
  if (!chrome.sidePanel) return;

  if (hasSidePanelClose()) {
    try {
      await chrome.sidePanel.close({ tabId });
      return;
    } catch (e) {
      // Some Chrome versions reject close({tabId}) when only a global panel is open.
      try {
        if (windowId != null) await chrome.sidePanel.close({ windowId });
        return;
      } catch {}
    }
  }

  // Fallback: disabling the panel closes/hides it for this tab.
  await setSidePanelOptionsForTab(tabId, { enabled: false });
}

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

if (chrome.sidePanel?.onOpened?.addListener) {
  chrome.sidePanel.onOpened.addListener((info) => {
    if (!info || typeof info.windowId !== "number") return;
    const prev = panelStateByWindowId.get(info.windowId);
    const tabId = typeof info.tabId === "number" ? info.tabId : (prev?.tabId || null);
    panelStateByWindowId.set(info.windowId, { tabId, open: true });
  });
}

if (chrome.sidePanel?.onClosed?.addListener) {
  chrome.sidePanel.onClosed.addListener((info) => {
    if (!info || typeof info.windowId !== "number") return;
    const prev = panelStateByWindowId.get(info.windowId);
    const tabId = typeof info.tabId === "number" ? info.tabId : (prev?.tabId || null);
    panelStateByWindowId.set(info.windowId, { tabId, open: false });
  });
}

chrome.action.onClicked.addListener((tab) => {
  try {
    if (!hasSidePanelOpen()) return;
    const tabId = tab?.id;
    const windowId = tab?.windowId;
    if (!tabId || windowId == null) return;

    const cur = panelStateByWindowId.get(windowId);
    const isOpenOnThisTab = !!(cur && cur.open && (!cur.tabId || cur.tabId === tabId));

    if (isOpenOnThisTab) {
      closeSidePanelForTab(tabId, windowId).catch((e) => console.warn("sidePanel.close failed:", e));
      panelStateByWindowId.set(windowId, { tabId, open: false });
      return;
    }

    openSidePanelForTab(tabId);
    panelStateByWindowId.set(windowId, { tabId, open: true });
  } catch (e) {
    console.warn("action.onClicked failed:", e);
  }
});
