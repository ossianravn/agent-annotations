export const DEFAULT_SERVER_URL = "http://localhost:8787";

export const $ = (id) => document.getElementById(id);

export const state = {
  annotateEnabled: false,
  desktopWidth: false,
  layout: null,
  localAnnotations: [],
  listError: null,
  projects: [],
  project: null,
  target: null,
  targetBlockedReason: null,
  isSending: false,
  lockedTabId: null,
  activeTab: null,
  activeUrl: null,
  routeKey: null,
  selectedElement: null,
  severity: "info",
  attachments: [],
  openAnnotations: [],
  selectedAnnotation: null,
  previewAttachment: null,
  settings: {
    serverUrl: DEFAULT_SERVER_URL,
    token: ""
  }
};

export function routeKeyFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    return `${url.origin}${url.pathname}`;
  } catch {
    return urlString || "";
  }
}

export function shortUrl(urlString) {
  try {
    const url = new URL(urlString);
    return `${url.pathname}${url.search}`;
  } catch {
    return urlString || "";
  }
}

export async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

export async function getLockedTab() {
  if (!state.lockedTabId) return getActiveTab();
  try {
    return await chrome.tabs.get(state.lockedTabId);
  } catch (error) {
    console.warn("Locked annotation tab is no longer available:", error);
    const activeTab = await getActiveTab();
    state.lockedTabId = activeTab?.id || null;
    return activeTab;
  }
}

export async function refreshActiveTabInfo() {
  const tab = await getLockedTab();
  state.activeTab = tab;
  state.activeUrl = tab?.url || null;
  state.routeKey = state.activeUrl ? routeKeyFromUrl(state.activeUrl) : null;
}

export function elementSummary(selection) {
  const primary = selection?.element?.primary;
  if (!primary) return selection ? "Selected" : "None";
  if (primary.type === "testid") return `data-testid="${primary.value}"`;
  if (primary.type === "id") return `#${primary.value}`;
  if (primary.type === "css") return primary.value || "(css)";
  return `${primary.type}:${primary.value || ""}`;
}

export function renderSelectedElement() {
  const summary = $("selectedSummary");
  summary.textContent = state.selectedElement ? elementSummary(state.selectedElement) : "None selected";
  summary.classList.toggle("is-none", !state.selectedElement);
  $("clearSelected").hidden = !state.selectedElement;
  $("selectedHint").hidden = Boolean(state.selectedElement);
  $("selectedHint").textContent = state.annotateEnabled
    ? "Click an element on the page to select it."
    : "Turn on Annotate, then click an element on the page.";
}

export function closeIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  const attributes = {
    class: "icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "aria-hidden": "true"
  };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, value);
  for (const d of ["M18 6 6 18", "m6 6 12 12"]) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

export function displayPath(value) {
  return String(value || "").replace(/\\/g, "/");
}

export function normalizedSeverity(value) {
  const severity = String(value || "info").toLowerCase();
  if (["warning", "question", "new feature"].includes(severity)) return "feature";
  if (["note", "information"].includes(severity)) return "info";
  return severity;
}

export function setSeverity(value) {
  const normalized = normalizedSeverity(value);
  state.severity = normalized;
  for (const radio of document.querySelectorAll('input[name="severityChoice"]')) {
    radio.checked = radio.value === normalized;
  }
}
