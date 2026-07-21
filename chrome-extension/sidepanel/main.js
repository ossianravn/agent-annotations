import { refreshList } from "./annotations.js";
import {
  bindAnnotationMessages,
  bindLockedTabWatchers,
  restoreAnnotationMode
} from "./annotation_session.js";
import { bindUI } from "./events.js";
import { announceAction } from "./feedback.js";
import { loadSettings, testConnection } from "./receiver.js";
import { getActiveTab, refreshActiveTabInfo, renderSelectedElement, state } from "./shared.js";
import { renderAttachments } from "./attachments.js";
import { bindDraftLifecycle, restoreDraft } from "./drafts.js";

async function restoreComposer(announce = false) {
  const restored = await restoreDraft();
  renderSelectedElement();
  renderAttachments();
  if (announce && restored) announceAction("Draft restored.");
}

async function main() {
  await loadSettings();
  bindAnnotationMessages();
  const openingTab = await getActiveTab();
  state.lockedTabId = openingTab?.id || null;
  await refreshActiveTabInfo();
  await restoreComposer(true);
  bindLockedTabWatchers({
    refreshList,
    restoreComposer: () => restoreComposer(false)
  });
  bindUI();
  bindDraftLifecycle();
  await Promise.all([testConnection(), refreshList()]);
  await restoreAnnotationMode();
}

main().catch((error) => {
  console.error("Agent Annotations side panel failed to start:", error);
  announceAction(`The side panel could not start: ${error?.message || error}`);
});
