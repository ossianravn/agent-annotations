import {
  $,
  DEFAULT_SERVER_URL,
  routeKeyFromUrl,
  state
} from "./shared.js";
import { setConnectionStatus } from "./feedback.js";

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

export async function loadSettings() {
  const saved = await chrome.storage.local.get(["serverUrl", "token"]);
  state.settings.serverUrl = normalizeServerUrl(saved.serverUrl || DEFAULT_SERVER_URL);
  state.settings.token = String(saved.token || "").trim();
  $("serverUrl").value = state.settings.serverUrl;
  $("token").value = state.settings.token;
  $("serverUrlDisplay").textContent = state.settings.serverUrl;
}

export async function saveSettings() {
  const serverUrl = normalizeServerUrl($("serverUrl").value);
  const token = $("token").value.trim();
  await ensureReceiverPermission(serverUrl, true);
  await chrome.storage.local.set({ serverUrl, token });
  state.settings = { serverUrl, token };
  $("serverUrl").value = serverUrl;
  $("serverUrlDisplay").textContent = serverUrl;
}

function formSettings() {
  return {
    serverUrl: normalizeServerUrl($("serverUrl").value || state.settings.serverUrl),
    token: $("token").value.trim()
  };
}

function connectionFailure(status, message) {
  const error = new Error(message);
  error.connectionStatus = status;
  return error;
}

export async function testConnection(options = {}) {
  const { requestPermission = false, useForm = false, throwOnFail = false } = options;
  const settings = useForm ? formSettings() : state.settings;
  try {
    await ensureReceiverPermission(settings.serverUrl, requestPermission);
    const healthResponse = await fetchWithTimeout(`${settings.serverUrl}/health`);
    const health = await responseJson(healthResponse);
    if (!healthResponse.ok || !health.ok) {
      throw connectionFailure("offline", "Receiver is not reachable.");
    }
    if (!settings.token) throw connectionFailure("missing-token", "Token is missing.");

    const authResponse = await fetchWithTimeout(`${settings.serverUrl}/annotations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": settings.token
      },
      body: "{}"
    });
    if (authResponse.status === 401) throw connectionFailure("unauthorized", "Token is invalid.");
    if (authResponse.status !== 400 && !authResponse.ok) {
      throw connectionFailure("offline", `Receiver check failed (${authResponse.status}).`);
    }
    setConnectionStatus("ok");
    return true;
  } catch (error) {
    const status = error.connectionStatus || "offline";
    setConnectionStatus(status);
    if (throwOnFail) throw error;
    return false;
  }
}

export function buildAnnotationPayload() {
  if (!state.activeUrl) throw new Error("No active URL is available.");
  if (!state.selectedElement) throw new Error("Select an element first.");
  const comment = $("comment").value.trim();
  if (!comment) throw new Error("Add a comment first.");

  return {
    id: "",
    createdAt: new Date().toISOString(),
    url: state.activeUrl,
    routeKey: state.routeKey || routeKeyFromUrl(state.activeUrl),
    status: "open",
    severity: state.severity,
    tags: [],
    ...state.selectedElement,
    comment
  };
}

export async function postAnnotation() {
  const response = await fetchWithTimeout(`${state.settings.serverUrl}/annotations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Annotation-Token": state.settings.token
    },
    body: JSON.stringify({
      annotation: buildAnnotationPayload(),
      assets: state.attachments.map(({ name, mime, dataUrl }) => ({ name, mime, dataUrl }))
    })
  });
  const data = await responseJson(response);
  if (!response.ok || !data.ok) throw new Error(data.error || `Receiver error (${response.status}).`);
  return data;
}

export async function getAnnotationsForRoute() {
  if (!state.routeKey) return [];
  const url = new URL(`${state.settings.serverUrl}/annotations`);
  url.searchParams.set("status", "open");
  url.searchParams.set("routeKey", state.routeKey);
  url.searchParams.set("limit", "50");
  const response = await fetchWithTimeout(url);
  const data = await responseJson(response);
  if (!response.ok) throw new Error(data.error || `Receiver error (${response.status}).`);
  if (!Array.isArray(data.annotations)) throw new Error("Receiver returned an invalid annotation list.");
  return data.annotations;
}

export async function markResolved(annotation) {
  if (!annotation?.id) throw new Error("Annotation ID is missing.");
  const response = await fetchWithTimeout(
    `${state.settings.serverUrl}/annotations/${encodeURIComponent(annotation.id)}/status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Annotation-Token": state.settings.token
      },
      body: JSON.stringify({ status: "resolved" })
    }
  );
  const data = await responseJson(response);
  if (!response.ok || !data.ok) throw new Error(data.error || `Receiver error (${response.status}).`);
  return data;
}
