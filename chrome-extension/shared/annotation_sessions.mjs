export const CONTENT_SCRIPT_FILES = [
  "content/selector.js",
  "content/locator.js",
  "content/overlay.js",
  "content_script.js"
];

function sessionKey(tabId) {
  if (!Number.isInteger(tabId)) throw new Error("A tab ID is required for annotation state.");
  return `annotationSession:${tabId}`;
}

export async function getAnnotationSession(tabId) {
  const key = sessionKey(tabId);
  const saved = await chrome.storage.session.get(key);
  return saved[key] === true;
}

export async function setAnnotationSession(tabId, enabled) {
  const key = sessionKey(tabId);
  if (enabled) await chrome.storage.session.set({ [key]: true });
  else await chrome.storage.session.remove(key);
}

export async function clearAnnotationSession(tabId) {
  await chrome.storage.session.remove(sessionKey(tabId));
}
