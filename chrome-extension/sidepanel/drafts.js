import { deleteDraftRecord, loadDraftRecord, saveDraftRecord } from "../shared/draft_store.mjs";
import { announceAction } from "./feedback.js";
import { $, setSeverity, state } from "./shared.js";

const SAVE_DELAY_MS = 250;
let saveTimer = 0;

function draftKey() {
  if (!Number.isInteger(state.lockedTabId) || !state.routeKey) return null;
  return `${state.lockedTabId}:${state.routeKey}`;
}

function hasDraftContent(record) {
  return Boolean(
    record.comment ||
    record.selectedElement ||
    record.attachments.length ||
    record.severity !== "info"
  );
}

function currentDraftRecord() {
  const key = draftKey();
  if (!key) return null;
  return {
    key,
    tabId: state.lockedTabId,
    routeKey: state.routeKey,
    url: state.activeUrl,
    comment: $("comment").value,
    severity: state.severity,
    selectedElement: state.selectedElement,
    attachments: state.attachments,
    updatedAt: new Date().toISOString()
  };
}

export async function flushDraft() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const record = currentDraftRecord();
  if (!record) return;
  if (hasDraftContent(record)) await saveDraftRecord(record);
  else await deleteDraftRecord(record.key);
}

export function scheduleDraftSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushDraft().catch((error) => {
      console.error("Could not save the annotation draft:", error);
      announceAction("Draft could not be saved. Keep this panel open until the annotation is submitted.");
    });
  }, SAVE_DELAY_MS);
}

function resetComposerState() {
  $("comment").value = "";
  state.selectedElement = null;
  state.attachments = [];
  setSeverity("info");
}

export async function restoreDraft() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  resetComposerState();
  const key = draftKey();
  if (!key) return false;
  const record = await loadDraftRecord(key);
  if (!record || record.routeKey !== state.routeKey) return false;

  $("comment").value = String(record.comment || "");
  state.selectedElement = record.selectedElement || null;
  state.attachments = Array.isArray(record.attachments) ? record.attachments : [];
  setSeverity(record.severity || "info");
  return hasDraftContent(record);
}

export async function discardDraft() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  const key = draftKey();
  if (key) await deleteDraftRecord(key);
}

export function bindDraftLifecycle() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    flushDraft().catch((error) => console.error("Could not flush the hidden panel draft:", error));
  });
  window.addEventListener("pagehide", () => {
    flushDraft().catch((error) => console.error("Could not flush the closing panel draft:", error));
  });
}
