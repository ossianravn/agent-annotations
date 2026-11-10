// Sends annotations saved in the browser to their repo's receiver. Runs in the
// service worker so it works with the panel closed.

import { deleteOutboxItem, getOutboxItem, listOutboxItems, putOutboxItem } from "../shared/outbox_store.mjs";
import { loadProjects, projectForUrl } from "../shared/projects.mjs";

const ALARM_NAME = "outbox-sync";
let currentPass = null;
let followUpPass = null;

function projectDestination(project) {
  return { projectId: project.id, projectName: project.name, receiverUrl: project.receiverUrl, token: project.token };
}

// Projects can change after saving (new token, new receiver URL, page added).
function resolveDestination(item, projects) {
  const projectId = item.destination?.projectId;
  if (projectId) {
    const project = projects.find((candidate) => candidate.id === projectId);
    return project ? projectDestination(project) : item.destination;
  }
  if (item.destination) return item.destination;
  const project = projectForUrl(projects, item.annotation.url);
  return project ? projectDestination(project) : null;
}

async function readHealth(receiverUrl) {
  try {
    const response = await fetch(`${receiverUrl}/health`, { signal: AbortSignal.timeout(4000) });
    const health = await response.json();
    return response.ok && health.ok ? health : null;
  } catch {
    return null;
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function sendItem(item, projects, healthByUrl) {
  const destination = resolveDestination(item, projects);
  if (!destination) return { state: "pending", reason: "unassigned" };
  if (!healthByUrl.has(destination.receiverUrl)) {
    healthByUrl.set(destination.receiverUrl, await readHealth(destination.receiverUrl));
  }
  const health = healthByUrl.get(destination.receiverUrl);
  if (!health) return { state: "pending", reason: "offline", destination };
  // Never write into whichever repo happens to own the port.
  if (destination.projectId && health.projectId !== destination.projectId) {
    return { state: "pending", reason: "other-repo", destination };
  }

  const assets = await Promise.all(item.assets.map(async ({ name, mime, blob }) => ({
    name,
    mime,
    dataBase64: await blobToBase64(blob)
  })));
  let response;
  try {
    response = await fetch(`${destination.receiverUrl}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annotation-Token": destination.token || "" },
      body: JSON.stringify({ annotation: item.annotation, assets }),
      signal: AbortSignal.timeout(60000)
    });
  } catch {
    return { state: "pending", reason: "offline", destination };
  }
  if (response.ok) return { state: "synced", destination };
  const body = await response.json().catch(() => ({}));
  const message = response.status === 401
    ? "The receiver rejected the token."
    : body.error || `Receiver error (${response.status}).`;
  return { state: "failed", reason: response.status === 401 ? "token" : "rejected", message, destination };
}

async function updateAlarm(waiting) {
  if (waiting) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  else await chrome.alarms.clear(ALARM_NAME);
}

async function runPass() {
  const [items, projects] = await Promise.all([listOutboxItems(), loadProjects()]);
  const healthByUrl = new Map();
  const outcomes = {};
  let changed = false;
  let waiting = 0;

  for (const item of items) {
    const outcome = await sendItem(item, projects, healthByUrl);
    outcomes[item.id] = {
      state: outcome.state,
      reason: outcome.reason || null,
      message: outcome.message || null,
      projectName: outcome.destination?.projectName || item.destination?.projectName || null
    };
    if (outcome.state === "synced") {
      await deleteOutboxItem(item.id);
      changed = true;
      continue;
    }
    waiting += 1;
    if (item.state === outcome.state && item.reason === outcome.reason) continue;
    // A discard during this pass must not be undone by writing the item back.
    if (!await getOutboxItem(item.id)) continue;
    await putOutboxItem({ ...item, state: outcome.state, reason: outcome.reason, message: outcome.message || null, updatedAt: new Date().toISOString() });
    changed = true;
  }

  await updateAlarm(waiting > 0);
  if (changed) chrome.runtime.sendMessage({ type: "OUTBOX_CHANGED" }).catch(() => {});
  return outcomes;
}

// One pass at a time. A request during a pass gets one follow-up pass, so an
// item saved mid-pass is still sent.
export function syncOutbox() {
  if (!currentPass) {
    currentPass = runPass().finally(() => { currentPass = null; });
    return currentPass;
  }
  followUpPass ||= currentPass.catch(() => {}).then(() => {
    followUpPass = null;
    return syncOutbox();
  });
  return followUpPass;
}

export function isOutboxAlarm(alarm) {
  return alarm?.name === ALARM_NAME;
}
