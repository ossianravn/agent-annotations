import { bindBackdropClose } from "../sidepanel/feedback.js";
import { createCard } from "./api.js";
import { filesFromPaste, imagesToAssets, renderPendingThumbnails } from "./images.js";
import { $, announce, board } from "./state.js";

let assets = [];

function reset() {
  assets = [];
  $("newComment").value = "";
  $("newCardHint").textContent = "";
  for (const radio of document.querySelectorAll('input[name="newType"]')) radio.checked = radio.value === "info";
  renderPendingThumbnails($("newAttachments"), assets);
}

function close() {
  const unsaved = $("newComment").value.trim() || assets.length;
  if (unsaved && !confirm("Discard this new card?")) return;
  $("newCardDialog").close();
}

// Ideas don't need a page: a card can start on the board.
async function save(status) {
  const comment = $("newComment").value.trim();
  if (!comment) {
    $("newCardHint").textContent = "Write what should be done first.";
    $("newComment").focus();
    return;
  }
  const severity = document.querySelector('input[name="newType"]:checked')?.value || "info";
  for (const button of [$("newCardDraft"), $("newCardSend")]) button.disabled = true;
  try {
    await createCard({ comment, severity, status, createdAt: new Date().toISOString(), tags: [] }, assets);
    reset();
    $("newCardDialog").close();
    announce(status === "draft" ? "Draft saved." : "Sent to the agent.");
    await board.reload();
  } catch (error) {
    $("newCardHint").textContent = error?.message || String(error);
  } finally {
    for (const button of [$("newCardDraft"), $("newCardSend")]) button.disabled = false;
  }
}

export function bindNewCard() {
  $("newCard").addEventListener("click", () => {
    if (!board.target) {
      announce("Start the project's receiver to add cards.", "error");
      return;
    }
    if (!$("newCardDialog").open) $("newCardDialog").showModal();
    $("newComment").focus();
  });
  $("closeNewCard").addEventListener("click", close);
  bindBackdropClose($("newCardDialog"), close);
  $("newCardDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  $("newCardDraft").addEventListener("click", () => save("draft"));
  $("newCardSend").addEventListener("click", () => save("ready"));
  $("newComment").addEventListener("paste", async (event) => {
    const files = filesFromPaste(event);
    if (!files.length) return;
    event.preventDefault();
    try {
      assets = [...assets, ...await imagesToAssets(files)];
      renderPendingThumbnails($("newAttachments"), assets);
    } catch (error) {
      $("newCardHint").textContent = error.message;
    }
  });
}
