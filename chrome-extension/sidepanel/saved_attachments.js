import { openAssetPreview } from "./attachments.js";
import { fetchAnnotationAttachment } from "./receiver.js";
import { $ } from "./shared.js";

let objectUrls = [];
let renderId = 0;

function filename(path) {
  return String(path || "attachment").split(/[\\/]/).pop() || "attachment";
}

function releaseObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

export function clearSavedAttachmentPreviews() {
  renderId += 1;
  releaseObjectUrls();
  const root = $("detailAttachments");
  root.removeAttribute("aria-busy");
  root.replaceChildren();
}

function unavailableTile(name) {
  const tile = document.createElement("span");
  tile.className = "detail-attachment is-unavailable";
  const mark = document.createElement("span");
  mark.textContent = "!";
  mark.setAttribute("aria-hidden", "true");
  const description = document.createElement("span");
  description.className = "sr-only";
  description.textContent = `${name} could not be loaded`;
  tile.append(mark, description);
  return tile;
}

async function loadAttachment(annotation, attachment, index, currentRenderId) {
  const name = filename(attachment.path);
  try {
    const blob = await fetchAnnotationAttachment(annotation, index);
    if (currentRenderId !== renderId) return null;
    if (!(attachment.mime || blob.type).startsWith("image/")) {
      const file = document.createElement("span");
      file.className = "detail-attachment is-file";
      const label = document.createElement("span");
      label.textContent = "FILE";
      label.setAttribute("aria-hidden", "true");
      const description = document.createElement("span");
      description.className = "sr-only";
      description.textContent = name;
      file.append(label, description);
      return file;
    }

    const previewUrl = URL.createObjectURL(blob);
    objectUrls.push(previewUrl);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-attachment";
    button.setAttribute("aria-label", `Preview ${name}`);
    const image = document.createElement("img");
    image.src = previewUrl;
    image.alt = "";
    image.loading = "lazy";
    image.width = 96;
    image.height = 96;
    button.appendChild(image);
    button.addEventListener("click", () => openAssetPreview({
      name,
      mime: attachment.mime || blob.type,
      path: attachment.path,
      previewUrl
    }));
    return button;
  } catch (error) {
    console.error(`Could not load saved attachment ${name}:`, error);
    return unavailableTile(name);
  }
}

export async function renderSavedAttachments(annotation) {
  clearSavedAttachmentPreviews();
  const currentRenderId = renderId;
  const root = $("detailAttachments");
  const attachments = Array.isArray(annotation.attachments) ? annotation.attachments : [];
  if (!attachments.length) {
    root.textContent = "—";
    return;
  }

  root.setAttribute("aria-busy", "true");
  const tiles = await Promise.all(attachments.map((attachment, index) => (
    loadAttachment(annotation, attachment, index, currentRenderId)
  )));
  if (currentRenderId !== renderId) return;
  root.replaceChildren(...tiles.filter(Boolean));
  root.removeAttribute("aria-busy");
  if (tiles.some((tile) => tile?.classList.contains("is-unavailable"))) {
    $("detailHint").textContent = "Some attachments could not be loaded.";
  }
}
