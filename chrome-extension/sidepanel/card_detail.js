import { ACTIVITY_LABELS, STATUS_LABELS, relativeTime, statusLabel } from "../shared/card_labels.mjs";
import { addAnnotationComment, updateAnnotationStatus } from "./receiver.js";
import { $, state } from "./shared.js";

export { statusLabel };

function selectValue(card) {
  if (card.status === "waiting") return `waiting:${card.waitingReason || "review"}`;
  return STATUS_LABELS[card.status] ? card.status : "ready";
}

function activityItem(entry) {
  const item = document.createElement("li");
  item.className = "activity-item";
  const head = document.createElement("p");
  head.className = "help";
  head.textContent = `${entry.author || "agent"} · ${ACTIVITY_LABELS[entry.kind] || entry.kind} · ${relativeTime(entry.at)}`;
  const text = document.createElement("p");
  text.className = "activity-text";
  text.textContent = entry.text || "";
  item.append(head, text);
  return item;
}

export function renderCardMeta(card) {
  $("detailStatus").value = selectValue(card);
  // A claim nobody refreshes is the human's to release.
  $("detailClaim").textContent = card.status === "in_progress" && card.claimedBy
    ? `Claimed by ${card.claimedBy}, last active ${relativeTime(card.heartbeatAt || card.claimedAt)}. Move it back to Ready to release it.`
    : "";
  const activity = card.activity || [];
  const links = card.links || [];
  const list = $("detailActivity");
  list.replaceChildren(...activity.map(activityItem));
  if (links.length) {
    const item = document.createElement("li");
    item.className = "activity-item help";
    item.textContent = `Links: ${links.join(", ")}`;
    list.appendChild(item);
  }
  $("detailActivitySection").hidden = !activity.length && !links.length;
  // Answering is what a card waiting on you asks for.
  $("detailReplyField").hidden = card.status !== "waiting";
  $("detailReply").placeholder = card.waitingReason === "question" ? "Your answer" : "What should change? (optional)";
}

async function applyUpdate(updated, { refreshList, closeDetail }) {
  state.selectedAnnotation = updated;
  renderCardMeta(updated);
  $("detailHint").textContent = `Status: ${statusLabel(updated)}.`;
  await refreshList();
  if (["done", "wont_do"].includes(updated.status)) closeDetail();
}

export function bindStatusSelect(actions) {
  $("detailStatus").addEventListener("change", async () => {
    const card = state.selectedAnnotation;
    if (!card) return;
    const [status, waitingReason] = $("detailStatus").value.split(":");
    $("detailStatus").disabled = true;
    try {
      await applyUpdate(await updateAnnotationStatus(card, status, waitingReason), actions);
    } catch (error) {
      renderCardMeta(card);
      $("detailHint").textContent = `Could not change the status: ${error?.message || error}`;
    } finally {
      $("detailStatus").disabled = false;
    }
  });

  $("sendReply").addEventListener("click", async () => {
    const card = state.selectedAnnotation;
    const text = $("detailReply").value.trim();
    if (!card) return;
    if (card.waitingReason === "question" && !text) {
      $("detailHint").textContent = "Write your answer first.";
      $("detailReply").focus();
      return;
    }
    $("sendReply").disabled = true;
    try {
      if (text) await addAnnotationComment(card, text);
      await applyUpdate(await updateAnnotationStatus(card, "ready"), actions);
      $("detailReply").value = "";
      $("detailHint").textContent = "Sent back to the agent.";
    } catch (error) {
      $("detailHint").textContent = `Could not send the reply: ${error?.message || error}`;
    } finally {
      $("sendReply").disabled = false;
    }
  });
}
