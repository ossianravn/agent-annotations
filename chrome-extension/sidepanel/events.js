import {
  addAttachment,
  captureScreenshot,
  clearAttachments,
  closeAssetPreview,
  cropElementFromScreenshot,
  resetAssetPreview
} from "./attachments.js";
import {
  closeDetail,
  copySelectedAnnotation,
  detailCommentIsDirty,
  detailSaveIsPending,
  refreshList,
  resetDetail,
  resolveSelectedAnnotation,
  saveSelectedAnnotationComment,
  syncDetailCommentState
} from "./annotations.js";
import {
  clearSelectedElement,
  refreshSelectedElementGeometry,
  setAnnotateMode
} from "./annotation_session.js";
import {
  $,
  refreshActiveTabInfo,
  renderSelectedElement,
  setSeverity,
  state
} from "./shared.js";
import {
  announceAction,
  bindBackdropClose,
  showAnnotateError,
  updateSendEnabled,
  withControlFeedback
} from "./feedback.js";
import { fillSettingsForm, saveSettings, testConnection } from "./receiver.js";
import { outboxIsLarge, outcomeMessage, queueAnnotation, requestSync } from "./outbox.js";
import { discardDraft, scheduleDraftSave } from "./drafts.js";
import { bindTabs } from "./tabs.js";
import { refreshRoute } from "./projects.js";
import { renderProjectList } from "./project_settings.js";

// The list comes from the page's project, so the route must be known first.
export async function refreshPage() {
  await refreshRoute();
  await refreshList();
}
import { refreshLayout } from "./desktop_width.js";

async function runControl(control, task, options) {
  try {
    return await withControlFeedback(control, task, options);
  } catch (error) {
    announceAction(error?.message || error, "error");
    return null;
  }
}

function bindSettings() {
  $("openSettings").addEventListener("click", () => {
    if ($("settingsDialog").open) return;
    // Edits abandoned by closing without Save must not linger in the form.
    fillSettingsForm();
    renderProjectList();
    $("settingsHint").textContent = "";
    $("settingsDialog").showModal();
  });
  $("closeSettings").addEventListener("click", () => $("settingsDialog").close());
  bindBackdropClose($("settingsDialog"), () => $("settingsDialog").close());
  $("showToken").addEventListener("click", () => {
    const reveal = $("token").type === "password";
    $("token").type = reveal ? "text" : "password";
    $("showToken").querySelector(".btn-text").textContent = reveal ? "Hide" : "Show";
  });

  $("saveSettings").addEventListener("click", () => runControl($("saveSettings"), async () => {
    await saveSettings();
    $("settingsHint").textContent = "Settings saved.";
    await refreshPage();
  }, { busyText: "Saving…", okText: "Saved", errorText: "Not saved" }));

  $("testConn").addEventListener("click", () => runControl($("testConn"), async () => {
    const health = await testConnection({ requestPermission: true });
    $("settingsHint").textContent = health.name ? `Connected to ${health.name}.` : "Connection verified.";
  }, { busyText: "Testing…", okText: "Connected", errorText: "Failed" }));
}

function bindCapture() {
  $("attachScreenshot").addEventListener("click", () => runControl($("attachScreenshot"), async () => {
    await refreshActiveTabInfo();
    addAttachment({ name: "screenshot.png", mime: "image/png", dataUrl: await captureScreenshot() });
    announceAction("Screenshot attached.");
  }, { busyText: "Capturing…", okText: "Added", errorText: "Failed" }));

  $("attachElementShot").addEventListener("click", () => runControl($("attachElementShot"), async () => {
    await refreshActiveTabInfo();
    const selection = await refreshSelectedElementGeometry();
    const screenshot = await captureScreenshot();
    const dataUrl = await cropElementFromScreenshot(screenshot, selection.rect);
    addAttachment({ name: "element.png", mime: "image/png", dataUrl });
    announceAction("Element screenshot attached.");
  }, { busyText: "Cropping…", okText: "Added", errorText: "Failed" }));

  $("clearAttachments").addEventListener("click", () => {
    if (!state.attachments.length || !confirm("Clear all attachments?")) return;
    clearAttachments();
    announceAction("Attachments cleared.");
  });
}

function bindComposer() {
  $("annotateToggle").addEventListener("change", async () => {
    try {
      await refreshActiveTabInfo();
      await setAnnotateMode($("annotateToggle").checked);
    } catch (error) {
      showAnnotateError(error?.message || error);
    }
  });
  $("clearSelected").addEventListener("click", () => clearSelectedElement());
  $("comment").addEventListener("input", () => {
    updateSendEnabled();
    scheduleDraftSave();
  });
  for (const radio of document.querySelectorAll('input[name="severityChoice"]')) {
    radio.addEventListener("change", () => {
      setSeverity(radio.value);
      scheduleDraftSave();
    });
  }

  $("comment").addEventListener("paste", async (event) => {
    const item = Array.from(event.clipboardData?.items || [])
      .find((candidate) => candidate.type?.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    try {
      const file = item.getAsFile();
      if (!file) throw new Error("The pasted image could not be read.");
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("The pasted image could not be read."));
        reader.readAsDataURL(file);
      });
      const mime = file.type || "image/png";
      const extension = { "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[mime] || "png";
      addAttachment({ name: `pasted.${extension}`, mime, dataUrl });
      announceAction("Pasted image attached.");
    } catch (error) {
      announceAction(error?.message || error, "error");
    }
  });

  $("send").addEventListener("click", () => sendAnnotation());
}

async function resetComposerAfterSend() {
  $("comment").value = "";
  clearAttachments();
  await clearSelectedElement();
  const results = await Promise.allSettled([discardDraft(), setAnnotateMode(false)]);
  const failures = results.filter((result) => result.status === "rejected");
  for (const failure of failures) {
    console.error("Annotation saved, but the composer could not be fully reset:", failure.reason);
  }
  return failures.length === 0;
}

async function sendAnnotation() {
  if (state.isSending) return;
  state.isSending = true;
  updateSendEnabled();
  await runControl($("send"), async () => {
    await refreshActiveTabInfo();
    await Promise.all([refreshSelectedElementGeometry({ allowStored: true }), refreshLayout()]);
    const item = await queueAnnotation();
    // The annotation is safe in the browser now: a cleanup failure must not
    // read as a failed save, or the user would save it again.
    const reset = await resetComposerAfterSend();
    const outcome = (await requestSync())[item.id];
    await refreshList();
    const notes = [
      reset ? null : "Its draft could not be cleared.",
      await outboxIsLarge() ? "Unsent annotations now use over 200 MB in the browser." : null
    ].filter(Boolean);
    announceAction([outcomeMessage(outcome, item), ...notes].join(" "), outcome?.state === "failed" ? "error" : "info");
  }, { busyText: "Saving…", okText: "Saved", errorText: "Failed", restoreDisabled: false });
  state.isSending = false;
  updateSendEnabled();
}

function bindDialogs() {
  $("closeDetail").addEventListener("click", closeDetail);
  bindBackdropClose($("detailDialog"), closeDetail);
  $("detailDialog").addEventListener("cancel", (event) => {
    if (!detailCommentIsDirty() && !detailSaveIsPending()) return;
    event.preventDefault();
    closeDetail();
  });
  $("detailDialog").addEventListener("close", resetDetail);
  $("detailComment").addEventListener("input", syncDetailCommentState);
  $("saveDetail").addEventListener("click", async () => {
    try {
      await saveSelectedAnnotationComment();
    } catch (error) {
      announceAction(error?.message || error);
    }
  });
  $("closeAsset").addEventListener("click", closeAssetPreview);
  bindBackdropClose($("assetDialog"), closeAssetPreview);
  $("assetDialog").addEventListener("close", resetAssetPreview);
  $("copyPrompt").addEventListener("click", copySelectedAnnotation);
  $("markResolved").addEventListener("click", resolveSelectedAnnotation);
}

export function bindUI() {
  bindSettings();
  bindCapture();
  bindComposer();
  bindDialogs();
  bindTabs();
  $("refreshList").addEventListener("click", async () => {
    await refreshActiveTabInfo();
    await refreshPage();
  });
  setSeverity(state.severity);
  renderSelectedElement();
  updateSendEnabled();
}
