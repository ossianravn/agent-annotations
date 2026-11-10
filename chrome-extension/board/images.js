import { fetchAttachment } from "./api.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name || "The image"} could not be read.`));
    reader.readAsDataURL(file);
  });
}

// Pasted, dropped or picked files become upload payloads; non-images are skipped.
export async function imagesToAssets(files) {
  const images = [...files].filter((file) => file.type.startsWith("image/"));
  const tooLarge = images.find((file) => file.size > MAX_IMAGE_BYTES);
  if (tooLarge) throw new Error(`${tooLarge.name || "An image"} is larger than 10 MB.`);
  return Promise.all(images.map(async (file, index) => ({
    name: file.name && file.name !== "image.png" ? file.name : `pasted-${index + 1}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`,
    mime: file.type,
    dataUrl: await readAsDataUrl(file)
  })));
}

export function filesFromPaste(event) {
  return [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function thumbButton(source, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "detail-attachment";
  button.setAttribute("aria-label", `Open ${label}`);
  const image = document.createElement("img");
  image.src = source;
  image.alt = "";
  button.appendChild(image);
  // A new tab shows the image at full size, which a dialog on a dialog can't.
  button.addEventListener("click", () => window.open(source, "_blank"));
  return button;
}

let objectUrls = [];

export function releaseThumbnails() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

export async function renderCardThumbnails(root, card) {
  releaseThumbnails();
  const attachments = card.attachments || [];
  if (!attachments.length) {
    root.textContent = "None";
    return;
  }
  const tiles = await Promise.all(attachments.map(async (attachment, index) => {
    const name = String(attachment.path || "").split("/").pop() || "attachment";
    try {
      const url = URL.createObjectURL(await fetchAttachment(card.id, index));
      objectUrls.push(url);
      return thumbButton(url, name);
    } catch {
      const missing = document.createElement("span");
      missing.className = "detail-attachment is-unavailable";
      missing.textContent = "!";
      missing.title = `${name} could not be loaded`;
      return missing;
    }
  }));
  root.replaceChildren(...tiles);
}

export function renderPendingThumbnails(root, assets) {
  root.replaceChildren(...assets.map((asset) => thumbButton(asset.dataUrl, asset.name)));
}
