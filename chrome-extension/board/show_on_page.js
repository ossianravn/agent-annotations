import { CONTENT_SCRIPT_FILES } from "../shared/annotation_sessions.mjs";

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const finish = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") finish();
    };
    const timer = setTimeout(finish, 15000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Opens the card's page and outlines its element, so reviewing takes one click.
// Returns false when the element can't be found on the page any more.
export async function showOnPage(card) {
  if (!card.url) throw new Error("This card isn't tied to a page.");
  const url = new URL(card.url);
  // Must run first in the click handler: Chrome asks only during a user gesture.
  const granted = await chrome.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
  if (!granted) throw new Error("Allow access to the page so the element can be highlighted.");
  const tab = await chrome.tabs.create({ url: card.url, active: true });
  await waitForLoad(tab.id);
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPT_FILES });
  const response = await chrome.tabs.sendMessage(tab.id, { type: "ANNOTATE_HIGHLIGHT", element: card.element });
  return Boolean(response?.found);
}
