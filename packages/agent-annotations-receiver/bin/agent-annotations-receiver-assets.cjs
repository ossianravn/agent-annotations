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
  return { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" }[mime] || ".bin";
}

function assetName(rawName, mime, fallback) {
  const desiredExtension = extensionForMime(mime);
  const deduplicated = safeName(rawName || fallback).replace(/\.(png|jpe?g|webp|bin)(\.\1)+$/i, ".$1");
  if (/\.(png|jpe?g|webp|bin)$/i.test(deduplicated)) return deduplicated;
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

function createAssetStore(repoRoot, assetDirs) {
  function managedPath(relativePath) {
    const absolutePath = path.resolve(repoRoot, relativePath || "");
    const allowed = Object.values(assetDirs).some((root) => (
      absolutePath.startsWith(`${path.resolve(root)}${path.sep}`)
    ));
    if (!allowed) throw requestError(400, "Attachment path is outside the annotation asset directory.");
    return absolutePath;
  }

  function storeUploads(id, assets) {
    const attachments = [];
    for (const [index, asset] of assets.entries()) {
      const payload = uploadPayload(asset, index);
      if (!payload) continue;
      const name = assetName(asset?.name, payload.mime, `asset_${index}`);
      const relativePath = path.join(".agent-annotations", "assets", "open", `${id}_${index}_${name}`);
      fs.writeFileSync(path.join(repoRoot, relativePath), Buffer.from(payload.base64, "base64"));
      attachments.push({ kind: "asset", mime: payload.mime, path: relativePath });
    }
    return attachments;
  }

  function readAttachment(attachment) {
    if (!attachment?.path) throw requestError(404, "Attachment not found.");
    const absolutePath = managedPath(attachment.path);
    if (!fs.existsSync(absolutePath)) throw requestError(404, "Attachment file not found.");
    return { ...attachment, absolutePath, name: path.basename(attachment.path) };
  }

  function resolveAttachments(attachments) {
    const moves = attachments.map((attachment) => {
      if (!attachment?.path) return { attachment };
      const source = managedPath(attachment.path);
      if (!fs.existsSync(source)) throw new Error(`Attachment file is missing: ${attachment.path}`);
      const relativePath = path.join(".agent-annotations", "assets", "resolved", path.basename(attachment.path));
      const destination = managedPath(relativePath);
      if (fs.existsSync(destination)) throw new Error(`Resolved attachment already exists: ${relativePath}`);
      return { attachment, source, destination, relativePath };
    });

    const completed = [];
    try {
      for (const move of moves) {
        if (!move.source) continue;
        fs.renameSync(move.source, move.destination);
        completed.push(move);
      }
    } catch (error) {
      const rollbackErrors = [];
      for (const move of completed.reverse()) {
        try {
          fs.renameSync(move.destination, move.source);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError.message);
        }
      }
      if (rollbackErrors.length) {
        throw new Error(`${error.message} Rollback failed: ${rollbackErrors.join("; ")}`);
      }
      throw error;
    }

    return moves.map((move) => (
      move.relativePath ? { ...move.attachment, path: move.relativePath } : move.attachment
    ));
  }

  return { readAttachment, resolveAttachments, storeUploads };
}

module.exports = { createAssetStore };
