import { updateAnnotationStatus } from "./receiver.js";
import { $, state } from "./shared.js";

const STATUS_LABELS = {
  draft: "Draft",
  ready: "Ready for agent",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won't do"
};
const ACTIVITY_LABELS = { review: "Ready for review", question: "Question", comment: "Note" };

export function statusLabel(card) {
  if (card.status === "waiting") return `Waiting on you: ${card.waitingReason === "question" ? "question" : "review"}`;
  if (card.status === "in_progress" && card.claimedBy) return `In progress · ${card.claimedBy}`;
  return STATUS_LABELS[card.status] || STATUS_LABELS.ready;
}

function selectValue(card) {
  if (card.status === "waiting") return `waiting:${card.waitingReason || "review"}`;
  return STATUS_LABELS[card.status] ? card.status : "ready";
}

function relativeTime(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "at an unknown time";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
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
}

export function bindStatusSelect({ refreshList, closeDetail }) {
  $("detailStatus").addEventListener("change", async () => {
    const card = state.selectedAnnotation;
    if (!card) return;
    const [status, waitingReason] = $("detailStatus").value.split(":");
    $("detailStatus").disabled = true;
    try {
      const updated = await updateAnnotationStatus(card, status, waitingReason);
      state.selectedAnnotation = updated;
      renderCardMeta(updated);
      $("detailHint").textContent = `Status: ${statusLabel(updated)}.`;
      await refreshList();
      if (["done", "wont_do"].includes(updated.status)) closeDetail();
    } catch (error) {
      renderCardMeta(card);
      $("detailHint").textContent = `Could not change the status: ${error?.message || error}`;
    } finally {
      $("detailStatus").disabled = false;
    }
  });
}
