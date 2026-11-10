import { deleteOutboxItem, listOutboxItems, putOutboxItem } from "../shared/outbox_store.mjs";
import { buildAnnotationPayload } from "./receiver.js";
import { normalizedSeverity, state } from "./shared.js";

const STORAGE_WARNING_BYTES = 200 * 1024 * 1024;

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function newAnnotationId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `ann_${stamp}_${hex(crypto.getRandomValues(new Uint8Array(4)))}`;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256-${hex(new Uint8Array(digest))}`;
}

// Where the annotation should end up, decided by the route at save time.
function destinationForSave() {
  const project = state.project;
  if (project) {
    return { projectId: project.id, projectName: project.name, receiverUrl: project.receiverUrl, token: project.token };
  }
  if (state.target) {
    return { projectId: state.target.projectId ?? null, projectName: state.target.name ?? null, receiverUrl: state.target.receiverUrl, token: state.target.token };
  }
  return null;
}

export async function queueAnnotation() {
  const annotation = { ...buildAnnotationPayload(), id: newAnnotationId() };
  const assets = await Promise.all(state.attachments.map(async ({ name, mime, dataUrl }) => ({
    name,
    mime,
    blob: await (await fetch(dataUrl)).blob()
  })));
  // Lets the receiver recognise a retried send of this exact annotation.
  annotation.clientHash = await sha256(JSON.stringify({
    annotation,
    assets: assets.map(({ name, mime, blob }) => [name, mime, blob.size])
  }));
  const now = new Date().toISOString();
  const item = {
    id: annotation.id,
    annotation,
    assets,
    bytes: assets.reduce((total, { blob }) => total + blob.size, 0),
    destination: destinationForSave(),
    state: "pending",
    reason: null,
    createdAt: now,
    updatedAt: now
  };
  await putOutboxItem(item);
  return item;
}

export async function requestSync() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "SYNC_OUTBOX" });
    return response?.outcomes || {};
  } catch (error) {
    console.info("Waiting annotations will be sent later:", error);
    return {};
  }
}

export async function outboxIsLarge() {
  const items = await listOutboxItems();
  return items.reduce((total, item) => total + (item.bytes || 0), 0) > STORAGE_WARNING_BYTES;
}

function waitingFor(item) {
  return item.destination?.projectName || state.project?.name || null;
}

export function outcomeMessage(outcome, item) {
  if (outcome?.state === "synced") return "Annotation saved.";
  if (outcome?.state === "failed") return `Saved in the browser, but sending failed: ${outcome.message}`;
  if (outcome?.reason === "unassigned") return "Saved in the browser. Add this page to a project to send it.";
  const name = outcome?.projectName || waitingFor(item);
  return name
    ? `Saved in the browser. It will be sent when ${name} is running.`
    : "Saved in the browser. It will be sent when its receiver is running.";
}

export async function loadLocalAnnotations() {
  if (!state.routeKey) return [];
  return (await listOutboxItems()).filter((item) => item.annotation.routeKey === state.routeKey);
}

function statusText(item) {
  if (item.state === "failed") return `Not sent: ${item.message || "the receiver refused it"}`;
  if (item.reason === "unassigned") return "Not sent: this page isn't in a project";
  const name = waitingFor(item);
  return name ? `Waiting for ${name}` : "Waiting for the receiver";
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function textButton(label, accessibleName, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text-btn";
  button.textContent = label;
  button.setAttribute("aria-label", accessibleName);
  button.addEventListener("click", onClick);
  return button;
}

export function localCard(item, { onRetry, onDiscard }) {
  const severity = normalizedSeverity(item.annotation.severity);
  const card = document.createElement("div");
  card.className = `item is-local${item.state === "failed" ? " is-failed" : ""}`;
  const type = span("type-label", { bug: "Bug", feature: "Feature" }[severity] || "Request");
  type.dataset.sev = severity;
  const dot = span("sev-dot", "");
  dot.setAttribute("aria-hidden", "true");
  type.prepend(dot);
  const top = span("item-top", "");
  top.append(type, span("local-state", statusText(item)));

  const actions = span("item-actions", "");
  actions.append(
    textButton("Retry", "Retry sending this annotation", () => onRetry(item)),
    textButton("Discard", "Discard this unsent annotation", () => onDiscard(item))
  );
  card.append(top, span("item-comment", item.annotation.comment || "No comment"), actions);
  return card;
}

export async function discardLocal(item) {
  if (!confirm("Discard this annotation? It hasn't been sent, so it can't be recovered.")) return false;
  await deleteOutboxItem(item.id);
  return true;
}
