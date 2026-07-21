export async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await chrome.sidePanel.setOptions({ enabled: false });
}

async function setPanelOptions(tabId, options) {
  try {
    await chrome.sidePanel.setOptions({ tabId, ...options });
  } catch (error) {
    console.warn(`Could not update side panel options for tab ${tabId}:`, error);
  }
}

async function lockPanelToTab(tabId, windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  await Promise.all(tabs.map((tab) => {
    if (!tab.id) return Promise.resolve();
    return setPanelOptions(
      tab.id,
      tab.id === tabId
        ? { path: "sidepanel.html", enabled: true }
        : { enabled: false }
    );
  }));
}

export function openPanelForTab(tab) {
  if (!tab?.id || tab.windowId == null) return;
  const tabId = tab.id;
  const windowId = tab.windowId;

  // Keep this call synchronous with the action click so Chrome retains the
  // user gesture required by sidePanel.open().
  chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true })
    .catch((error) => console.warn("Could not enable the side panel:", error));
  chrome.sidePanel.open({ tabId })
    .catch((error) => console.warn("Could not open the side panel:", error));
  lockPanelToTab(tabId, windowId)
    .catch((error) => console.warn("Could not lock the side panel to the active tab:", error));
}
