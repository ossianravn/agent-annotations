// Keeps the annotated page at the width it had before the side panel took
// part of the window, by zooming the tab out while the panel is open.

const MIN_ZOOM = 0.5;

function stateKey(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("A tab ID is required for desktop width.");
  return `desktopWidth:${tabId}`;
}

async function savedState(tabId) {
  const key = stateKey(tabId);
  return (await chrome.storage.session.get(key))[key] || null;
}

export async function applyDesktopWidth(tabId, panelWidth) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.width) throw new Error("The page size is not available yet.");
  let saved = await savedState(tabId);
  if (!saved) {
    // Remember the zoom from before the first change so closing the panel restores it.
    saved = { originalZoom: await chrome.tabs.getZoom(tabId) };
    await chrome.storage.session.set({ [stateKey(tabId)]: saved });
  }
  // Per-tab scope keeps other tabs on the same site, and Chrome's saved site zoom, untouched.
  await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
  const fullWidth = tab.width + Math.max(0, panelWidth);
  const zoom = Math.max(MIN_ZOOM, Math.min(1, saved.originalZoom * (tab.width / fullWidth)));
  await chrome.tabs.setZoom(tabId, zoom);
  return zoom;
}

export async function restoreDesktopWidth(tabId) {
  const saved = await savedState(tabId);
  if (!saved) return false;
  await chrome.storage.session.remove(stateKey(tabId));
  try {
    await chrome.tabs.setZoom(tabId, saved.originalZoom);
    await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-origin" });
  } catch (error) {
    console.info(`Tab ${tabId} closed before its zoom could be restored:`, error);
  }
  return true;
}

export async function forgetDesktopWidth(tabId) {
  await chrome.storage.session.remove(stateKey(tabId));
}
