// Board-wide state, shared by the board modules.

export const $ = (id) => document.getElementById(id);

export const board = {
  projects: [],
  project: null,
  target: null,
  wipLimit: 2,
  cards: [],
  filters: { text: "", type: "all", archived: false },
  reload: async () => {}
};

let statusTimer = 0;

export function announce(message, tone = "info") {
  const status = $("boardStatus");
  clearTimeout(statusTimer);
  status.textContent = String(message || "");
  status.classList.toggle("is-error", tone === "error");
  if (tone !== "error" && status.textContent) {
    statusTimer = setTimeout(() => { status.textContent = ""; }, 5000);
  }
}

export function setConnection(status) {
  const labels = { ok: "Connected", offline: "Offline", "other-repo": "Other repo running", none: "No project" };
  const label = $("connStatusLabel");
  label.textContent = labels[status] || labels.offline;
  label.classList.toggle("is-ok", status === "ok");
  label.classList.toggle("is-warn", status === "other-repo");
  label.classList.toggle("is-err", !["ok", "other-repo"].includes(status));
}

export function showMessage(text) {
  $("boardMessage").textContent = text || "";
  $("boardMessage").hidden = !text;
  $("board").hidden = Boolean(text);
}
