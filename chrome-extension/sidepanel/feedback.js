import { $, state } from "./shared.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function setConnectionStatus(status) {
  const label = $("connStatusLabel");
  const value = String(status || "offline");
  const isOk = value === "ok";
  const isWarning = value === "unauthorized" || value === "missing-token";
  const descriptions = {
    ok: ["CONNECTED", "Connected"],
    "missing-token": ["TOKEN MISSING", "Token missing"],
    unauthorized: ["BAD TOKEN", "Bad token"],
    offline: ["OFFLINE", "Not reachable"]
  };
  const [text, title] = descriptions[value] || descriptions.offline;
  label.textContent = text;
  label.title = title;
  label.classList.toggle("is-ok", isOk);
  label.classList.toggle("is-warn", isWarning);
  label.classList.toggle("is-err", !isOk && !isWarning);
}

function controlTextElement(control) {
  return control?.querySelector?.(".btn-text, .action-text, .send-text") || null;
}

function getControlText(control) {
  return controlTextElement(control)?.textContent || control?.textContent || "";
}

function setControlText(control, text) {
  const textElement = controlTextElement(control);
  if (textElement) textElement.textContent = String(text || "");
  else if (control) control.textContent = String(text || "");
}

export async function withControlFeedback(control, task, options = {}) {
  if (!control) return task();
  const {
    busyText = "Working…",
    okText = "Done",
    errorText = "Failed",
    okMs = 650,
    errorMs = 1000,
    restoreDisabled = true
  } = options;
  const originalText = getControlText(control);
  const wasDisabled = control.disabled;
  const originalTitle = control.title;

  control.disabled = true;
  control.removeAttribute("title");
  control.classList.remove("is-ok", "is-error");
  control.classList.add("is-busy");
  setControlText(control, busyText);

  try {
    const result = await task();
    control.classList.replace("is-busy", "is-ok");
    setControlText(control, okText || originalText);
    await sleep(okMs);
    return result;
  } catch (error) {
    control.classList.remove("is-busy");
    control.classList.add("is-error");
    control.title = String(error?.message || error || errorText);
    setControlText(control, errorText);
    await sleep(errorMs);
    throw error;
  } finally {
    control.classList.remove("is-busy", "is-ok", "is-error");
    if (restoreDisabled) control.disabled = wasDisabled;
    if (originalTitle) control.title = originalTitle;
    else control.removeAttribute("title");
    setControlText(control, originalText);
  }
}

export function showAnnotateError(message) {
  const error = $("annotateError");
  const text = String(message || "");
  error.hidden = !text;
  error.textContent = text;
  if (!text) return;

  const control = $("annotateToggle").closest(".switch");
  control.classList.remove("is-error");
  requestAnimationFrame(() => control.classList.add("is-error"));
  setTimeout(() => control.classList.remove("is-error"), 700);
}

export function announceAction(message) {
  $("actionStatus").textContent = String(message || "");
}

export function updateSendEnabled() {
  const hasElement = Boolean(state.selectedElement);
  const hasComment = Boolean($("comment").value.trim());
  $("send").disabled = state.isSending || !hasElement || !hasComment;
}

export function setListMessage(message, className = "muted tiny") {
  const root = $("list");
  root.replaceChildren();
  const text = document.createElement("div");
  text.className = className;
  text.textContent = message;
  root.appendChild(text);
}

export function bindBackdropClose(dialog, close) {
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) close();
  });
}
