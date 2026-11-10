import { board } from "./state.js";

const TIMEOUT_MS = 8000;
const UPLOAD_TIMEOUT_MS = 60000;

function offline() {
  return Object.assign(new Error(`${board.project?.name || "The receiver"} isn't running.`), { offline: true });
}

async function request(path, options = {}) {
  const target = board.target;
  if (!target) throw new Error("Pick a running project first.");
  const headers = { "X-Annotation-Token": target.token, ...options.headers };
  if (options.body) headers["Content-Type"] = "application/json";
  try {
    return await fetch(`${target.receiverUrl}${path}`, {
      ...options,
      headers,
      signal: AbortSignal.timeout(options.timeout || TIMEOUT_MS)
    });
  } catch {
    throw offline();
  }
}

async function requestJson(path, options) {
  const response = await request(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Receiver error (${response.status}).`);
  return data;
}

const cardPath = (id) => `/annotations/${encodeURIComponent(id)}`;
const post = (body, timeout) => ({ method: "POST", body: JSON.stringify(body), timeout });

export async function readHealth(receiverUrl) {
  try {
    const response = await fetch(`${receiverUrl}/health`, { signal: AbortSignal.timeout(4000) });
    const health = await response.json();
    return response.ok && health.ok ? health : null;
  } catch {
    return null;
  }
}

export async function listCards() {
  return (await requestJson("/annotations?status=all&limit=1000")).annotations;
}

export async function updateCard(id, patch) {
  return (await requestJson(cardPath(id), { method: "PATCH", body: JSON.stringify(patch) })).annotation;
}

export async function addComment(id, text) {
  return (await requestJson(`${cardPath(id)}/comments`, post({ author: "you", text }))).annotation;
}

export async function addAttachments(id, assets) {
  return (await requestJson(`${cardPath(id)}/attachments`, post({ assets }, UPLOAD_TIMEOUT_MS))).annotation;
}

export async function createCard(annotation, assets) {
  return requestJson("/annotations", post({ annotation, assets }, UPLOAD_TIMEOUT_MS));
}

export async function fetchAttachment(id, index) {
  const response = await request(`${cardPath(id)}/attachments/${index}`);
  if (!response.ok) throw new Error(`Attachment unavailable (${response.status}).`);
  return response.blob();
}
