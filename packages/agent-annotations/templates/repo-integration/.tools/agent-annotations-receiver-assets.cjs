const fs = require("fs");
const path = require("path");

function requestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function safeName(value) {
  return String(value || "asset").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 80);
}

function extensionForMime(mime) {
  return { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[mime] || ".bin";
}

function assetName(rawName, mime, fallback) {
  const desiredExtension = extensionForMime(mime);
  const deduplicated = safeName(rawName || fallback).replace(/\.(png|jpe?g|webp|gif|bin)(\.\1)+$/i, ".$1");
  if (/\.(png|jpe?g|webp|gif|bin)$/i.test(deduplicated)) return deduplicated;
  return `${deduplicated}${desiredExtension}`;
}

function uploadPayload(asset, index) {
  const dataUrl = String(asset?.dataUrl || "");
  if (dataUrl) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw requestError(400, `Asset ${index + 1} has an invalid data URL.`);
    return { mime: asset.mime || match[1], base64: match[2] };
  }
  const base64 = String(asset?.dataBase64 || "").trim();
  if (!base64) return null;
  return { mime: asset.mime || "application/octet-stream", base64 };
}

// Attachments live in each card's assets/ folder. Reads are limited to those
// folders so a hand-edited card cannot point the receiver at other files.
function createAssetStore(repoRoot, cardsDir) {
  const cardsRoot = `${path.resolve(cardsDir)}${path.sep}`;

  function managedPath(relativePath) {
    const absolutePath = path.resolve(repoRoot, String(relativePath || "").replace(/\\/g, "/"));
    const insideCardAssets = absolutePath.startsWith(cardsRoot) &&
      path.relative(cardsRoot, absolutePath).split(path.sep)[1] === "assets";
    if (!insideCardAssets) throw requestError(400, "Attachment path is outside the card asset folders.");
    return absolutePath;
  }

  // Stored paths use "/" so a repo written on one OS resolves on another.
  function storeUploads(relativeDir, assets, startIndex = 0) {
    const attachments = [];
    for (const [index, asset] of assets.entries()) {
      const payload = uploadPayload(asset, index);
      if (!payload) continue;
      const name = `${startIndex + index}_${assetName(asset?.name, payload.mime, `asset_${index}`)}`;
      const relativePath = path.posix.join(relativeDir, name);
      const absolutePath = path.join(repoRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, Buffer.from(payload.base64, "base64"));
      attachments.push({ kind: "asset", mime: payload.mime, path: relativePath });
    }
    return attachments;
  }

  function readAttachment(attachment) {
    if (!attachment?.path) throw requestError(404, "Attachment not found.");
    const absolutePath = managedPath(attachment.path);
    if (!fs.existsSync(absolutePath)) throw requestError(404, "Attachment file not found.");
    return { ...attachment, absolutePath, name: path.basename(absolutePath) };
  }

  return { readAttachment, storeUploads };
}

module.exports = { createAssetStore };
