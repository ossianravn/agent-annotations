import {
  addAttachment,
  captureScreenshot,
  clearAttachments,
  closeAssetPreview,
  cropElementFromScreenshot
} from "./attachments.js";
import {
  closeDetail,
  copySelectedAnnotation,
  refreshList,
  resolveSelectedAnnotation
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
import { postAnnotation, saveSettings, testConnection } from "./receiver.js";
import { discardDraft, scheduleDraftSave } from "./drafts.js";

async function runControl(control, task, options) {
  try {
    return await withControlFeedback(control, task, options);
  } catch (error) {
    announceAction(error?.message || error);
    return null;
  }
}

function bindSettings() {
  $("openSettings").addEventListener("click", () => {
    $("settingsHint").textContent = "";
    if (!$("settingsDialog").open) $("settingsDialog").showModal();
  });
  $("closeSettings").addEventListener("click", () => $("settingsDialog").close());
  bindBackdropClose($("settingsDialog"), () => $("settingsDialog").close());
  $("showToken").addEventListener("change", () => {
    $("token").type = $("showToken").checked ? "text" : "password";
  });

  $("saveSettings").addEventListener("click", () => runControl($("saveSettings"), async () => {
    await saveSettings();
    $("settingsHint").textContent = "Settings saved.";
    await testConnection();
  }, { busyText: "Saving…", okText: "Saved", errorText: "Not saved" }));

  $("testConn").addEventListener("click", () => runControl($("testConn"), async () => {
    await testConnection({ requestPermission: true, useForm: true, throwOnFail: true });
    $("settingsHint").textContent = "Connection verified.";
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
    await refreshActiveTabInfo();
    try {
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
      addAttachment({ name: "pasted.png", mime: file.type || "image/png", dataUrl });
      announceAction("Pasted image attached.");
    } catch (error) {
      announceAction(error?.message || error);
    }
  });

  $("send").addEventListener("click", () => sendAnnotation());
}

async function sendAnnotation() {
  if (state.isSending) return;
  state.isSending = true;
  updateSendEnabled();
  await runControl($("send"), async () => {
    let draftCleared = true;
    await saveSettings();
    await refreshActiveTabInfo();
    await refreshSelectedElementGeometry();
    await postAnnotation();
    await clearSelectedElement();
    await setAnnotateMode(false);
    $("comment").value = "";
    clearAttachments();
    try {
      await discardDraft();
    } catch (error) {
      draftCleared = false;
      console.error("Annotation saved, but its draft could not be deleted:", error);
    }
    await refreshList();
    announceAction(
      draftCleared
        ? "Annotation saved."
        : "Annotation saved, but its old draft could not be deleted."
    );
  }, { busyText: "Saving…", okText: "Saved", errorText: "Failed", restoreDisabled: false });
  state.isSending = false;
  updateSendEnabled();
}

function bindDialogs() {
  $("closeDetail").addEventListener("click", closeDetail);
  bindBackdropClose($("detailDialog"), closeDetail);
  $("closeAsset").addEventListener("click", closeAssetPreview);
  bindBackdropClose($("assetDialog"), closeAssetPreview);
  $("copyPrompt").addEventListener("click", copySelectedAnnotation);
  $("markResolved").addEventListener("click", resolveSelectedAnnotation);
}

export function bindUI() {
  bindSettings();
  bindCapture();
  bindComposer();
  bindDialogs();
  $("refreshTab").addEventListener("click", async () => {
    await refreshActiveTabInfo();
    await refreshList();
  });
  $("refreshList").addEventListener("click", refreshList);
  setSeverity(state.severity);
  renderSelectedElement();
  updateSendEnabled();
}
