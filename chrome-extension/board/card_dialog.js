import { ACTIVITY_LABELS, STATUS_LABELS, relativeTime, typeLabel } from "../shared/card_labels.mjs";
import { bindBackdropClose } from "../sidepanel/feedback.js";
import { addAttachments, addComment, updateCard } from "./api.js";
import { filesFromPaste, imagesToAssets, releaseThumbnails, renderCardThumbnails } from "./images.js";
import { showOnPage } from "./show_on_page.js";
import { $, board } from "./state.js";

let currentId = null;
// What the editor last showed, so live updates never overwrite your edits.
let shown = { title: "", comment: "", attachments: 0 };

const current = () => board.cards.find((card) => card.id === currentId) || null;
const hint = (text) => { $("cardHint").textContent = text || ""; };
const editorChanged = () => $("cardTitle").value !== shown.title || $("cardComment").value !== shown.comment;

function syncSave() {
  const empty = !$("cardTitle").value.trim() || !$("cardComment").value.trim();
  $("saveCard").disabled = !current() || !editorChanged() || empty;
}

function selectValue(card) {
  if (card.status === "waiting") return `waiting:${card.waitingReason || "review"}`;
  return STATUS_LABELS[card.status] ? card.status : "ready";
}

function activityItem(entry) {
  const item = document.createElement("li");
  const head = Object.assign(document.createElement("p"), { className: "help" });
  head.textContent = `${entry.author || "agent"} · ${ACTIVITY_LABELS[entry.kind] || entry.kind} · ${relativeTime(entry.at)}`;
  const text = Object.assign(document.createElement("p"), { className: "activity-text", textContent: entry.text || "" });
  item.append(head, text);
  return item;
}

function renderFacts(card) {
  $("cardStatus").value = selectValue(card);
  const type = $("cardType");
  type.textContent = typeLabel(card.severity);
  type.dataset.sev = card.severity || "info";
  type.prepend(Object.assign(document.createElement("span"), { className: "sev-dot", ariaHidden: "true" }));
  $("cardClaim").textContent = card.status === "in_progress" && card.claimedBy
    ? `Claimed by ${card.claimedBy}, last active ${relativeTime(card.heartbeatAt || card.claimedAt)}. Move it back to Ready to release it.`
    : card.archivedAt ? `Archived ${relativeTime(card.archivedAt)}.` : "";
  $("cardPageField").hidden = !card.url;
  $("cardPage").textContent = card.url || "";
  $("cardPage").href = card.url || "#";
  const primary = card.element?.primary;
  $("cardElement").textContent = primary ? `Element: ${primary.type} ${primary.value}` : "";
  const items = (card.activity || []).map(activityItem);
  if (card.links?.length) items.push(Object.assign(document.createElement("li"), { className: "help", textContent: `Links: ${card.links.join(", ")}` }));
  $("cardActivity").replaceChildren(...items);
  $("cardActivitySection").hidden = !items.length;
  $("cardReplyField").hidden = card.status !== "waiting";
  $("cardReply").placeholder = card.waitingReason === "question" ? "Your answer" : "What should change? (optional)";
  $("archiveCard").hidden = !["done", "wont_do"].includes(card.status) || Boolean(card.archivedAt);
  $("doneCard").hidden = card.status === "done";
}

function fillEditor(card) {
  shown = { title: card.title || "", comment: card.comment || "", attachments: card.attachments?.length || 0 };
  $("cardTitle").value = shown.title;
  $("cardComment").value = shown.comment;
  syncSave();
}

export function openCard(id) {
  currentId = id;
  const card = current();
  if (!card) return;
  fillEditor(card);
  $("cardReply").value = "";
  hint("");
  renderFacts(card);
  if (!$("cardDialog").open) $("cardDialog").showModal();
  renderCardThumbnails($("cardAttachments"), card);
}

// Called after every reload: refresh what an agent may have changed.
export function refreshOpenCard() {
  if (!$("cardDialog").open || !currentId) return;
  const card = current();
  if (!card) {
    hint("This card no longer exists.");
    return;
  }
  if (!editorChanged()) fillEditor(card);
  renderFacts(card);
  if ((card.attachments?.length || 0) !== shown.attachments) {
    shown.attachments = card.attachments?.length || 0;
    renderCardThumbnails($("cardAttachments"), card);
  }
}

async function change(task, message, { close = false } = {}) {
  const card = current();
  if (!card) return;
  try {
    const updated = await task(card);
    board.cards = board.cards.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    hint(message);
    await board.reload();
    if (close) $("cardDialog").close();
  } catch (error) {
    hint(`${error?.message || error}`);
    renderFacts(card);
  }
}

async function uploadImages(files) {
  const assets = await imagesToAssets(files);
  if (!assets.length) return;
  hint("Adding images…");
  await change((card) => addAttachments(card.id, assets), `Added ${assets.length} image${assets.length === 1 ? "" : "s"}.`);
}

function closeCard() {
  if (editorChanged() && !confirm("Discard your unsaved changes to this card?")) return;
  $("cardDialog").close();
}

export function bindCardDialog() {
  const dialog = $("cardDialog");
  $("closeCard").addEventListener("click", closeCard);
  bindBackdropClose(dialog, closeCard);
  dialog.addEventListener("cancel", (event) => {
    if (!editorChanged()) return;
    event.preventDefault();
    closeCard();
  });
  dialog.addEventListener("close", () => {
    releaseThumbnails();
    currentId = null;
  });
  for (const field of ["cardTitle", "cardComment"]) $(field).addEventListener("input", syncSave);

  $("saveCard").addEventListener("click", () => change(async (card) => {
    const updated = await updateCard(card.id, { title: $("cardTitle").value.trim(), comment: $("cardComment").value.trim() });
    fillEditor(updated);
    return updated;
  }, "Saved."));
  $("cardStatus").addEventListener("change", () => {
    const [status, waitingReason] = $("cardStatus").value.split(":");
    change((card) => updateCard(card.id, { status, waitingReason }), `Moved to ${STATUS_LABELS[status]}.`);
  });
  $("doneCard").addEventListener("click", () => change((card) => updateCard(card.id, { status: "done" }), "Marked done.", { close: true }));
  $("archiveCard").addEventListener("click", () => change((card) => updateCard(card.id, { archived: true }), "Archived.", { close: true }));
  $("cardSendReply").addEventListener("click", () => {
    const text = $("cardReply").value.trim();
    if (current()?.waitingReason === "question" && !text) {
      hint("Write your answer first.");
      $("cardReply").focus();
      return;
    }
    change(async (card) => {
      if (text) await addComment(card.id, text);
      const updated = await updateCard(card.id, { status: "ready" });
      $("cardReply").value = "";
      return updated;
    }, "Sent back to the agent.");
  });
  $("showOnPage").addEventListener("click", async () => {
    try {
      const found = await showOnPage(current());
      hint(found ? "" : "The page opened, but the element isn't on it any more.");
    } catch (error) {
      hint(error?.message || String(error));
    }
  });
  $("cardImageInput").addEventListener("change", async () => {
    await uploadImages($("cardImageInput").files).catch((error) => hint(error.message));
    $("cardImageInput").value = "";
  });
  dialog.addEventListener("paste", (event) => {
    const files = filesFromPaste(event);
    if (!files.length) return;
    event.preventDefault();
    uploadImages(files).catch((error) => hint(error.message));
  });
}
