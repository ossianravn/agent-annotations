import {
  bindAnnotationMessages,
  bindLockedTabWatchers,
  restoreAnnotationMode
} from "./annotation_session.js";
import { bindUI, refreshPage } from "./events.js";
import { refreshList } from "./annotations.js";
import { announceAction } from "./feedback.js";
import { loadSettings } from "./receiver.js";
import { loadProjectsIntoState, onLiveCardsChanged, onProjectsChanged } from "./projects.js";
import { renderProjectList } from "./project_settings.js";
import { getActiveTab, refreshActiveTabInfo, renderSelectedElement, state } from "./shared.js";
import { renderAttachments } from "./attachments.js";
import { bindDraftLifecycle, restoreDraft } from "./drafts.js";
import { bindDesktopWidth, loadDesktopWidthPreference, syncDesktopWidth } from "./desktop_width.js";

async function restoreComposer(announce = false) {
  const restored = await restoreDraft();
  renderSelectedElement();
  renderAttachments();
  if (announce && restored) announceAction("Draft restored.");
}

async function main() {
  await Promise.all([loadSettings(), loadDesktopWidthPreference(), loadProjectsIntoState()]);
  onProjectsChanged(async () => {
    await refreshPage();
    renderProjectList();
  });
  bindAnnotationMessages();
  const openingTab = await getActiveTab();
  state.lockedTabId = openingTab?.id || null;
  await refreshActiveTabInfo();
  await restoreComposer(true);
  bindLockedTabWatchers({
    refreshList: refreshPage,
    restoreComposer: () => restoreComposer(false),
    syncLayout: syncDesktopWidth
  });
  bindUI();
  // The worker sends waiting annotations in the background; show the result.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OUTBOX_CHANGED") refreshList();
  });
  onLiveCardsChanged(() => refreshList());
  bindDesktopWidth();
  bindDraftLifecycle();
  await Promise.all([refreshPage(), syncDesktopWidth()]);
  await restoreAnnotationMode();
}

main().catch((error) => {
  console.error("Agent Annotations side panel failed to start:", error);
  announceAction(`The side panel could not start: ${error?.message || error}`, "error");
});
