// Type, tags and the "Done when" checklist in the board's card dialog.
import { typeLabel } from "../shared/card_labels.mjs";
import { closeIcon } from "../sidepanel/shared.js";
import { $ } from "./state.js";

export function parseTags(value) {
  return [...new Set(String(value).split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export function tagsText(card) {
  return (card.tags || []).join(", ");
}

export function renderType(card) {
  for (const radio of document.querySelectorAll('input[name="cardType"]')) {
    radio.checked = radio.value === (card.severity || "info");
  }
}

function criterion(item, index, { onToggle, onRemove }) {
  const row = document.createElement("li");
  row.className = "checklist-item";
  const label = document.createElement("label");
  const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: item.done });
  box.addEventListener("change", () => onToggle(index, box.checked));
  label.append(box, Object.assign(document.createElement("span"), { textContent: item.text }));
  const remove = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn ghost", title: "Remove" });
  remove.setAttribute("aria-label", `Remove "${item.text}"`);
  remove.appendChild(closeIcon());
  remove.addEventListener("click", () => onRemove(index));
  row.append(label, remove);
  return row;
}

let renderedKey = "";

// Live refreshes arrive while you click; redrawing an unchanged list would
// swallow the click and drop focus, so only a real change redraws it.
export function renderAcceptance(card, handlers) {
  const items = card.acceptance || [];
  const key = `${card.id}:${JSON.stringify(items)}`;
  if (key === renderedKey && $("cardAcceptance").childElementCount) return;
  renderedKey = key;
  const list = $("cardAcceptance");
  list.replaceChildren(...items.map((item, index) => criterion(item, index, handlers)));
  if (!items.length) list.appendChild(Object.assign(document.createElement("li"), { className: "help", textContent: "None yet." }));
}

// save(patch, message) applies one change to the open card.
export function bindCardFields({ current, save }) {
  for (const radio of document.querySelectorAll('input[name="cardType"]')) {
    radio.addEventListener("change", () => save({ severity: radio.value }, `Type: ${typeLabel(radio.value)}.`));
  }
  const add = async () => {
    const text = $("newCriterion").value.trim();
    const card = current();
    if (!text || !card) return;
    await save({ acceptance: [...(card.acceptance || []), { text, done: false }] }, "Criterion added.");
    $("newCriterion").value = "";
    $("newCriterion").focus();
  };
  $("addCriterion").addEventListener("click", add);
  $("newCriterion").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    add();
  });
}

export function acceptanceHandlers(current, save) {
  return {
    onToggle: (index, done) => {
      const items = (current()?.acceptance || []).map((item, position) => (position === index ? { ...item, done } : item));
      save({ acceptance: items }, done ? "Criterion ticked." : "Criterion unticked.");
    },
    onRemove: (index) => {
      const items = (current()?.acceptance || []).filter((_, position) => position !== index);
      save({ acceptance: items }, "Criterion removed.");
    }
  };
}
