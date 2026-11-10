import {
  $,
  DEFAULT_SERVER_URL,
  routeKeyFromUrl,
  state
} from "./shared.js";

const REQUEST_TIMEOUT_MS = 5000;

function normalizeServerUrl(value) {
  const url = new URL(String(value || DEFAULT_SERVER_URL).trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Receiver URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) throw new Error("Receiver URL cannot contain credentials.");
  return url.origin;
}

function permissionPattern(serverUrl) {
  const url = new URL(serverUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

async function ensureReceiverPermission(serverUrl, requestIfMissing) {
  const origins = [permissionPattern(serverUrl)];
  if (requestIfMissing) {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) throw new Error("Receiver access was not granted.");
    return;
  }
  if (!await chrome.permissions.contains({ origins })) {
    throw new Error("Receiver access has not been granted.");
  }
}

async function fetchWithTimeout(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Receiver returned invalid JSON (${response.status}).`);
  }
}

export function fillSettingsForm() {
  $("serverUrl").value = state.settings.serverUrl;
  $("token").value = state.settings.token;
}

export async function loadSettings() {
  const saved = await chrome.storage.local.get(["serverUrl", "token"]);
  state.settings.serverUrl = normalizeServerUrl(saved.serverUrl || DEFAULT_SERVER_URL);
  state.settings.token = String(saved.token || "").trim();
  fillSettingsForm();
}

export async function saveSettings() {
  const serverUrl = normalizeServerUrl($("serverUrl").value);
  const token = $("token").value.trim();
  await ensureReceiverPermission(serverUrl, true);
  await chrome.storage.local.set({ serverUrl, token });
  state.settings = { serverUrl, token };
  fillSettingsForm();
}

// Returns the receiver's /health body, or null when nothing usable answers.
export async function probeReceiver(receiverUrl) {
  try {
    await ensureReceiverPermission(receiverUrl, false);
    const response = await fetchWithTimeout(`${receiverUrl}/health`);
    const health = await responseJson(response);
    return response.ok && health.ok ? health : null;
  } catch {
    return null;
  }
}

// "ok" | "unauthorized" | "missing-token" | "offline". An empty POST is
// rejected as a bad request only after the token has been accepted.
export async function checkToken(receiverUrl, token) {
  if (!token) return "missing-token";
  try {
    const response = await fetchWithTimeout(`${receiverUrl}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annotation-Token": token },
      body: "{}"
    });
    if (response.status === 401) return "unauthorized";
    return response.status === 400 || response.ok ? "ok" : "offline";
  } catch {
    return "offline";
  }
}

export async function testConnection(options = {}) {
  const serverUrl = normalizeServerUrl($("serverUrl").value || state.settings.serverUrl);
  await ensureReceiverPermission(serverUrl, Boolean(options.requestPermission));
  const health = await probeReceiver(serverUrl);
  if (!health) throw new Error("Receiver is not reachable.");
  const status = await checkToken(serverUrl, $("token").value.trim());
  if (status === "missing-token") throw new Error("Token is missing.");
  if (status === "unauthorized") throw new Error("Token is invalid.");
  if (status !== "ok") throw new Error("Receiver check failed.");
  return health;
}

// Every request goes to the receiver of the current page's project.
function offlineError(message) {
  const error = new Error(message);
  error.offline = true;
  return error;
}

async function request(path, options = {}) {
  const target = state.target;
  if (!target) {
    if (state.targetBlockedReason) throw new Error(state.targetBlockedReason);
    throw offlineError("No receiver is running for this page.");
  }
  const headers = { "X-Annotation-Token": target.token, ...options.headers };
  if (options.body) headers["Content-Type"] = "application/json";
  try {
    return await fetchWithTimeout(`${target.receiverUrl}${path}`, { ...options, headers });
  } catch {
    throw offlineError(`${target.name || state.project?.name || "The receiver"} isn't running.`);
  }
}

async function requestJson(path, options) {
  const response = await request(path, options);
  const data = await responseJson(response);
  if (!response.ok || data.ok === false) throw new Error(data.error || `Receiver error (${response.status}).`);
  return data;
}

const annotationPath = (annotation) => {
  if (!annotation?.id) throw new Error("Annotation ID is missing.");
  return `/annotations/${encodeURIComponent(annotation.id)}`;
};

export function buildAnnotationPayload() {
  if (!state.activeUrl) throw new Error("No active URL is available.");
  if (!state.selectedElement) throw new Error("Select an element first.");
  const comment = $("comment").value.trim();
  if (!comment) throw new Error("Add a comment first.");
  const rect = state.selectedElement.rect || {};

  return {
    id: "",
    createdAt: new Date().toISOString(),
    url: state.activeUrl,
    routeKey: state.routeKey || routeKeyFromUrl(state.activeUrl),
    status: "open",
    severity: state.severity,
    tags: [],
    ...state.selectedElement,
    // Which layout the comment is about: breakpoints follow the CSS viewport width.
    layout: {
      viewportWidth: rect.viewportW ?? state.layout?.width ?? null,
      viewportHeight: rect.viewportH ?? null,
      devicePixelRatio: rect.dpr ?? null,
      zoom: state.layout?.zoom ?? null,
      desktopWidth: state.desktopWidth
    },
    comment
  };
}

export async function getAnnotationsForRoute() {
  if (!state.routeKey) return [];
  const query = new URLSearchParams({ status: "open", routeKey: state.routeKey, limit: "50" });
  const data = await requestJson(`/annotations?${query}`);
  if (!Array.isArray(data.annotations)) throw new Error("Receiver returned an invalid annotation list.");
  return data.annotations;
}

export async function updateAnnotationComment(annotation, comment) {
  const data = await requestJson(annotationPath(annotation), {
    method: "PATCH",
    body: JSON.stringify({ comment })
  });
  if (!data.annotation) throw new Error("Receiver returned no annotation.");
  return data.annotation;
}

export async function fetchAnnotationAttachment(annotation, index) {
  const response = await request(`${annotationPath(annotation)}/attachments/${index}`);
  if (!response.ok) {
    const data = await responseJson(response);
    throw new Error(data.error || `Receiver error (${response.status}).`);
  }
  return response.blob();
}

export function markResolved(annotation) {
  return requestJson(`${annotationPath(annotation)}/status`, {
    method: "POST",
    body: JSON.stringify({ status: "resolved" })
  });
}
