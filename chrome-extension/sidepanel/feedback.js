import { $, state } from "./shared.js";

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function setConnectionStatus(status) {
  const label = $("connStatusLabel");
  const value = String(status || "offline");
  const isOk = value === "ok";
  const isWarning = ["unauthorized", "missing-token", "other-repo"].includes(value);
  const descriptions = {
    ok: ["Connected", "Receiver connected"],
    "other-repo": ["Other repo running", "A different repo's receiver is running"],
    "missing-token": ["Token missing", "Add the receiver token in Settings"],
    unauthorized: ["Bad token", "The receiver rejected the token"],
    offline: ["Offline", "Receiver not reachable"]
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

  const control = $("annotateToggle").closest(".mode-switch");
  control.classList.remove("is-error");
  requestAnimationFrame(() => control.classList.add("is-error"));
  setTimeout(() => control.classList.remove("is-error"), 700);
}

let statusTimer = 0;

// Outcomes stay readable for a moment; failures stay until the next message.
export function announceAction(message, tone = "info") {
  const status = $("actionStatus");
  clearTimeout(statusTimer);
  status.textContent = String(message || "");
  status.classList.toggle("is-error", tone === "error");
  if (tone !== "error" && status.textContent) {
    statusTimer = setTimeout(() => { status.textContent = ""; }, 5000);
  }
}

export function updateSendEnabled() {
  const hasElement = Boolean(state.selectedElement);
  const hasComment = Boolean($("comment").value.trim());
  const disabled = state.isSending || !hasElement || !hasComment;
  $("send").disabled = disabled;
  $("saveDraft").disabled = disabled;
}

export function setListMessage(message, className = "empty") {
  const root = $("list");
  root.replaceChildren();
  const text = document.createElement("p");
  text.className = className;
  text.textContent = message;
  root.appendChild(text);
}

export function bindBackdropClose(dialog, close) {
  // Keyboard-activated clicks report (0, 0), and a drag that starts inside the
  // dialog can end on the backdrop, so both press and release must land outside.
  let pressedOutside = false;
  const isOutside = (event) => {
    if (event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
  };
  dialog.addEventListener("pointerdown", (event) => {
    pressedOutside = isOutside(event);
  });
  dialog.addEventListener("click", (event) => {
    const outside = pressedOutside && isOutside(event);
    pressedOutside = false;
    if (outside) close();
  });
}
