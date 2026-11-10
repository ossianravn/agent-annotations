import { $ } from "./shared.js";

const TABS = [
  { tab: "tabNew", panel: "panelNew" },
  { tab: "tabOpen", panel: "panelOpen" }
];

export function selectTab(tabId, options = {}) {
  for (const { tab, panel } of TABS) {
    const selected = tab === tabId;
    $(tab).setAttribute("aria-selected", String(selected));
    $(tab).tabIndex = selected ? 0 : -1;
    $(panel).hidden = !selected;
  }
  // Saving belongs to the composer; on the list it would read as acting on a card.
  $("composerActions").hidden = tabId !== "tabNew";
  if (options.focus) $(tabId).focus();
}

function adjacentTab(tabId, key) {
  const index = TABS.findIndex(({ tab }) => tab === tabId);
  if (key === "Home") return TABS[0].tab;
  if (key === "End") return TABS[TABS.length - 1].tab;
  const step = { ArrowRight: 1, ArrowLeft: -1 }[key];
  return step ? TABS[(index + step + TABS.length) % TABS.length].tab : null;
}

export function bindTabs() {
  for (const { tab } of TABS) {
    $(tab).addEventListener("click", () => selectTab(tab));
    $(tab).addEventListener("keydown", (event) => {
      const next = adjacentTab(tab, event.key);
      if (!next) return;
      event.preventDefault();
      selectTab(next, { focus: true });
    });
  }
}

export function renderOpenCount(count) {
  const badge = $("openCount");
  badge.hidden = !Number.isInteger(count);
  badge.textContent = Number.isInteger(count) ? String(count) : "";
}
