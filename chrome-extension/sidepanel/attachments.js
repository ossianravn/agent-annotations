import { $, state } from "./shared.js";
import { updateSendEnabled } from "./feedback.js";
import { scheduleDraftSave } from "./drafts.js";

const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function estimateBytesFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") return null;
  const match = /^data:[^;]+;base64,(.+)$/.exec(dataUrl);
  return match ? Math.floor(match[1].length * 3 / 4) : null;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes}B`;
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) return `${kibibytes.toFixed(kibibytes < 10 ? 1 : 0)}KB`;
  const mebibytes = kibibytes / 1024;
  return `${mebibytes.toFixed(mebibytes < 10 ? 1 : 0)}MB`;
}

function sanitizeFilename(name) {
  return (name || "asset")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function assertAttachmentCapacity(dataUrl) {
  if (state.attachments.length >= MAX_ATTACHMENTS) {
    throw new Error(`A maximum of ${MAX_ATTACHMENTS} attachments is supported.`);
  }
  const bytes = estimateBytesFromDataUrl(dataUrl);
  if (!Number.isFinite(bytes)) throw new Error("The attachment data is invalid.");
  if (bytes > MAX_ATTACHMENT_BYTES) throw new Error("This attachment is larger than 10MB.");
  const total = state.attachments.reduce(
    (sum, attachment) => sum + (estimateBytesFromDataUrl(attachment.dataUrl) || 0),
    bytes
  );
  if (total > MAX_TOTAL_BYTES) throw new Error("Attachments cannot exceed 20MB in total.");
}

function makeAttachmentId() {
  return `att_${crypto.randomUUID()}`;
}

export function addAttachment({ name, mime, dataUrl }) {
  assertAttachmentCapacity(dataUrl);
  state.attachments.push({ id: makeAttachmentId(), name: sanitizeFilename(name), mime, dataUrl });
  renderAttachments();
  updateSendEnabled();
  scheduleDraftSave();
}

export function clearAttachments() {
  state.attachments = [];
  renderAttachments();
  updateSendEnabled();
  scheduleDraftSave();
}

function removeAttachment(id) {
  state.attachments = state.attachments.filter((attachment) => attachment.id !== id);
  renderAttachments();
  updateSendEnabled();
  scheduleDraftSave();
}

export function openAssetPreview(attachment) {
  if (!attachment?.dataUrl) return;
  state.previewAttachment = attachment;
  $("assetTitle").textContent = attachment.name || "Attachment";
  const size = formatBytes(estimateBytesFromDataUrl(attachment.dataUrl));
  $("assetMeta").textContent = [attachment.mime || "attachment", size].filter(Boolean).join(" • ");
  $("assetImg").src = attachment.dataUrl;
  $("assetImg").alt = attachment.name || "Attachment preview";
  $("assetDialog").showModal();
}

export function closeAssetPreview() {
  state.previewAttachment = null;
  $("assetImg").src = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  if ($("assetDialog").open) $("assetDialog").close();
}

export function renderAttachments() {
  const root = $("attachments");
  root.replaceChildren();
  $("attachmentsSection").hidden = state.attachments.length === 0;

  for (const attachment of state.attachments) {
    const card = document.createElement("div");
    card.className = "attachment";
    const isImage = attachment.mime?.startsWith("image/") && attachment.dataUrl;
    const preview = document.createElement(isImage ? "button" : "div");
    preview.className = "thumb";
    if (isImage) {
      preview.type = "button";
      preview.classList.add("is-clickable");
      preview.setAttribute("aria-label", `Preview ${attachment.name}`);
      const image = document.createElement("img");
      image.src = attachment.dataUrl;
      image.alt = "";
      preview.appendChild(image);
      preview.addEventListener("click", () => openAssetPreview(attachment));
    } else {
      preview.textContent = "File";
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = attachment.name;
    const detail = document.createElement("div");
    detail.className = "sub";
    detail.textContent = [attachment.mime || "attachment", formatBytes(estimateBytesFromDataUrl(attachment.dataUrl))]
      .filter(Boolean)
      .join(" • ");
    meta.append(name, detail);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn ghost remove";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.textContent = "✕";
    remove.addEventListener("click", () => removeAttachment(attachment.id));
    card.append(preview, meta, remove);
    root.appendChild(card);
  }
}

export async function captureScreenshot() {
  if (!state.activeTab?.windowId) throw new Error("No active window.");
  if (!state.activeTab.active) throw new Error("Switch to the annotated tab before capturing.");
  const response = await chrome.runtime.sendMessage({
    type: "CAPTURE_VISIBLE_TAB",
    windowId: state.activeTab.windowId
  });
  if (!response?.ok) throw new Error(response?.error || "Screenshot failed.");
  return response.dataUrl;
}

export async function cropElementFromScreenshot(dataUrl, rect) {
  if (!rect) throw new Error("Select an element first.");
  const image = await new Promise((resolve, reject) => {
    const candidate = new Image();
    candidate.onload = () => resolve(candidate);
    candidate.onerror = () => reject(new Error("Failed to load the screenshot."));
    candidate.src = dataUrl;
  });
  const scaleX = rect.viewportW > 0 ? image.width / rect.viewportW : rect.dpr || 1;
  const scaleY = rect.viewportH > 0 ? image.height / rect.viewportH : rect.dpr || 1;
  const sourceX = Math.max(0, Math.floor(rect.x * scaleX));
  const sourceY = Math.max(0, Math.floor(rect.y * scaleY));
  const sourceRight = Math.min(image.width, Math.ceil((rect.x + rect.w) * scaleX));
  const sourceBottom = Math.min(image.height, Math.ceil((rect.y + rect.h) * scaleY));
  const width = sourceRight - sourceX;
  const height = sourceBottom - sourceY;
  if (width <= 0 || height <= 0) {
    throw new Error("The selected element is outside the visible viewport.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, sourceX, sourceY, width, height, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}
