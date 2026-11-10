import { applyDesktopWidth, restoreDesktopWidth } from "../shared/desktop_width.mjs";
import { announceAction } from "./feedback.js";
import { $, state } from "./shared.js";

const PREFERENCE_KEY = "desktopWidth";
let port = null;
let appliedTabId = null;
let resizeTimer = 0;

function reportTab() {
  if (!port) {
    port = chrome.runtime.connect({ name: "sidepanel" });
    // The worker may be stopped while the panel stays open. Reconnect, so that
    // closing the panel still restores the tab's zoom.
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(reportTab, 1000);
    });
  }
  port.postMessage({ tabId: state.activeTab?.id ?? null });
}

function renderLayout() {
  const layout = state.layout;
  $("layoutInfo").textContent = layout
    ? `Page ${layout.width}px · ${Math.round(layout.zoom * 100)}%`
    : "";
}

export async function refreshLayout() {
  const tabId = state.activeTab?.id;
  state.layout = null;
  if (Number.isInteger(tabId)) {
    try {
      const [tab, zoom] = await Promise.all([chrome.tabs.get(tabId), chrome.tabs.getZoom(tabId)]);
      if (tab.width) state.layout = { width: Math.round(tab.width / zoom), zoom };
    } catch (error) {
      console.info("Page size is unavailable:", error);
    }
  }
  renderLayout();
  return state.layout;
}

async function applyForCurrentTab() {
  const tabId = state.activeTab?.id;
  reportTab();
  if (appliedTabId != null && appliedTabId !== tabId) {
    await restoreDesktopWidth(appliedTabId);
    appliedTabId = null;
  }
  if (Number.isInteger(tabId)) {
    if (state.desktopWidth) {
      await applyDesktopWidth(tabId, window.innerWidth);
      appliedTabId = tabId;
    } else {
      // Also clears zoom left behind by a panel that closed without restoring it.
      await restoreDesktopWidth(tabId);
      appliedTabId = null;
    }
  }
  await refreshLayout();
}

export async function syncDesktopWidth() {
  try {
    await applyForCurrentTab();
  } catch (error) {
    await refreshLayout();
    announceAction(`Zoom to fit is unavailable on this page: ${error?.message || error}`, "error");
  }
}

export async function loadDesktopWidthPreference() {
  const saved = await chrome.storage.local.get(PREFERENCE_KEY);
  state.desktopWidth = saved[PREFERENCE_KEY] === true;
  $("desktopWidthToggle").checked = state.desktopWidth;
}

export function bindDesktopWidth() {
  $("desktopWidthToggle").addEventListener("change", async () => {
    state.desktopWidth = $("desktopWidthToggle").checked;
    await chrome.storage.local.set({ [PREFERENCE_KEY]: state.desktopWidth });
    await syncDesktopWidth();
  });
  // A wider or narrower panel changes how much the page has to be zoomed out.
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.desktopWidth) syncDesktopWidth();
      else refreshLayout();
    }, 150);
  });
  chrome.tabs.onZoomChange.addListener(({ tabId }) => {
    if (tabId === state.activeTab?.id) refreshLayout();
  });
}
