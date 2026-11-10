import { STATUS_LABELS, rankValue, relativeTime, typeLabel } from "../shared/card_labels.mjs";
import { updateCard } from "./api.js";
import { board, announce } from "./state.js";

export const COLUMNS = ["draft", "ready", "in_progress", "waiting", "done"];
const DRAG_TYPE = "text/x-agent-annotations-card";
let openCard = () => {};

export function columnOf(card) {
  if (card.status === "wont_do") return "done";
  return COLUMNS.includes(card.status) ? card.status : "ready";
}

function matchesFilters(card) {
  const { text, type, archived } = board.filters;
  if (card.archivedAt && !archived) return false;
  if (type !== "all" && (card.severity || "info") !== type) return false;
  if (!text) return true;
  const haystack = [card.title, card.comment, card.url, card.claimedBy].join(" ").toLowerCase();
  return haystack.includes(text.toLowerCase());
}

// Draft and Ready follow the rank agents pull by; the rest follow time.
function sortForColumn(status, cards) {
  const sorted = [...cards];
  if (status === "done") return sorted.sort((left, right) => String(right.closedAt || right.updatedAt).localeCompare(String(left.closedAt || left.updatedAt)));
  if (status === "in_progress") return sorted.sort((left, right) => String(left.claimedAt).localeCompare(String(right.claimedAt)));
  return sorted.sort((left, right) => rankValue(left) - rankValue(right));
}

function cardsIn(status, excludeId = null) {
  return sortForColumn(status, board.cards.filter((card) => (
    columnOf(card) === status && matchesFilters(card) && card.id !== excludeId
  )));
}

function span(className, text) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

function pagePath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "";
  }
}

function cardElement(card) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = `board-card${card.archivedAt ? " is-archived" : ""}`;
  button.draggable = true;
  button.dataset.id = card.id;
  button.addEventListener("click", () => openCard(card.id));
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(DRAG_TYPE, card.id);
    event.dataTransfer.effectAllowed = "move";
    button.classList.add("is-dragging");
  });
  button.addEventListener("dragend", () => button.classList.remove("is-dragging"));

  const top = span("item-top", "");
  const type = span("type-label", typeLabel(card.severity));
  type.dataset.sev = card.severity || "info";
  type.prepend(Object.assign(span("sev-dot", ""), { ariaHidden: "true" }));
  top.appendChild(type);
  // The column already names the status; the card adds only what it doesn't.
  const detail = card.archivedAt ? "Archived"
    : card.status === "waiting" ? (card.waitingReason === "question" ? "Question" : "Review")
      : card.status === "in_progress" ? card.claimedBy || ""
        : card.status === "wont_do" ? "Won't do" : "";
  if (detail) top.appendChild(span(`item-status${card.status === "waiting" ? " is-attention" : ""}`, detail));
  const meta = [
    pagePath(card.url),
    card.attachments?.length ? `${card.attachments.length} image${card.attachments.length === 1 ? "" : "s"}` : null,
    relativeTime(card.updatedAt || card.createdAt)
  ].filter(Boolean).join(" · ");
  button.append(top, span("board-card-title", card.title || "Untitled"), span("item-meta", meta));
  item.appendChild(button);
  return item;
}

export function renderBoard() {
  for (const status of COLUMNS) {
    const column = document.querySelector(`.column[data-status="${status}"]`);
    const cards = cardsIn(status);
    column.querySelector("[data-count]").textContent = String(cards.length);
    const list = column.querySelector(".column-cards");
    list.replaceChildren(...cards.map(cardElement));
    if (!cards.length) list.appendChild(span("column-empty", "No cards"));
  }
  const agents = new Set(board.cards.filter((card) => card.status === "in_progress").map((card) => card.claimedBy));
  document.getElementById("wipLimit").textContent = `Up to ${board.wipLimit} per agent${agents.size ? ` · ${agents.size} working` : ""}`;
}

function dropIndex(list, clientY) {
  const cards = [...list.querySelectorAll(".board-card:not(.is-dragging)")];
  const index = cards.findIndex((card) => {
    const rect = card.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2;
  });
  return index === -1 ? cards.length : index;
}

function showMarker(list, index) {
  list.querySelector(".drop-marker")?.remove();
  const marker = Object.assign(document.createElement("li"), { className: "drop-marker", ariaHidden: "true" });
  const items = [...list.children].filter((child) => child.querySelector?.(".board-card:not(.is-dragging)"));
  list.insertBefore(marker, items[index] || null);
}

// A card dropped between two others gets the midpoint of their ranks.
export async function moveCard(id, status, index) {
  const card = board.cards.find((candidate) => candidate.id === id);
  if (!card) return;
  const siblings = cardsIn(status, id);
  const before = siblings[index - 1];
  const after = siblings[index];
  let rank = Date.now();
  if (before && after) rank = (rankValue(before) + rankValue(after)) / 2;
  else if (before) rank = rankValue(before) + 1000;
  else if (after) rank = rankValue(after) - 1000;
  const patch = { rank };
  if (columnOf(card) !== status) {
    patch.status = status;
    if (status === "waiting") patch.waitingReason = "review";
  }
  Object.assign(card, { rank, ...(patch.status ? { status: patch.status } : {}) });
  renderBoard();
  try {
    const updated = await updateCard(id, patch);
    board.cards = board.cards.map((candidate) => (candidate.id === id ? updated : candidate));
    renderBoard();
    if (patch.status) announce(`Moved to ${STATUS_LABELS[status]}.`);
  } catch (error) {
    announce(`Could not move the card: ${error?.message || error}`, "error");
    await board.reload();
  }
}

export function bindColumns({ onOpen }) {
  openCard = onOpen;
  for (const column of document.querySelectorAll(".column")) {
    const list = column.querySelector(".column-cards");
    list.addEventListener("dragover", (event) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      showMarker(list, dropIndex(list, event.clientY));
    });
    list.addEventListener("dragleave", (event) => {
      if (!list.contains(event.relatedTarget)) list.querySelector(".drop-marker")?.remove();
    });
    list.addEventListener("drop", (event) => {
      const id = event.dataTransfer.getData(DRAG_TYPE);
      if (!id) return;
      event.preventDefault();
      const index = dropIndex(list, event.clientY);
      list.querySelector(".drop-marker")?.remove();
      moveCard(id, column.dataset.status, index);
    });
  }
}
