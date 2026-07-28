#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createAssetStore } = require("./agent-annotations-receiver-assets.cjs");

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1] || fallback;
};

const port = Number.parseInt(argValue("--port", process.env.ANNOTATION_PORT || "8787"), 10);
const host = argValue("--host", process.env.ANNOTATION_HOST || "0.0.0.0");
const repoRoot = path.resolve(argValue("--repo", process.env.ANNOTATION_REPO_ROOT || process.cwd()));
const baseUrl = argValue("--base-url", process.env.ANNOTATION_BASE_URL || `http://localhost:${port}`);
const dataDir = path.join(repoRoot, ".agent-annotations");
const files = {
  open: path.join(dataDir, "inbox.jsonl"),
  resolved: path.join(dataDir, "inbox-resolved.jsonl"),
  token: path.join(dataDir, "token.txt"),
  config: path.join(dataDir, "config.json")
};
const assetDirs = {
  open: path.join(dataDir, "assets", "open"),
  resolved: path.join(dataDir, "assets", "resolved")
};
const assetStore = createAssetStore(repoRoot, assetDirs);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function ensureDataDirs() {
  fs.mkdirSync(assetDirs.open, { recursive: true });
  fs.mkdirSync(assetDirs.resolved, { recursive: true });
}

function loadOrCreateToken() {
  const environmentToken = process.env.ANNOTATION_TOKEN?.trim();
  if (environmentToken) return environmentToken;
  try {
    const saved = fs.readFileSync(files.token, "utf8").trim();
    if (saved) return saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const token = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(files.token, `${token}\n`, "utf8");
  return token;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON in ${file} at line ${index + 1}: ${error.message}`);
    }
  });
}

function writeJsonl(file, records) {
  const temporary = `${file}.tmp`;
  const text = records.length ? `${records.map(JSON.stringify).join("\n")}\n` : "";
  fs.writeFileSync(temporary, text, "utf8");
  fs.renameSync(temporary, file);
}

function appendJsonl(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

function normalizedSeverity(value) {
  const severity = String(value || "info").toLowerCase();
  if (["note", "information"].includes(severity)) return "info";
  if (["question", "warning", "new feature"].includes(severity)) return "feature";
  return severity;
}

function createAnnotation(body) {
  const annotation = body?.annotation;
  if (!annotation || typeof annotation !== "object") throw new RequestError(400, "Missing 'annotation' object.");
  const id = String(annotation.id || "").trim() || `ann_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomBytes(4).toString("hex")}`;
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const attachments = assetStore.storeUploads(id, assets);
  const stored = {
    ...annotation,
    id,
    createdAt: String(annotation.createdAt || "").trim() || new Date().toISOString(),
    status: "open",
    severity: normalizedSeverity(annotation.severity),
    attachments
  };
  appendJsonl(files.open, stored);
  return stored;
}

function listAnnotations(url) {
  const status = (url.searchParams.get("status") || "open").trim();
  const routeKey = (url.searchParams.get("routeKey") || "").trim();
  const limit = Math.max(1, Math.min(200, Number.parseInt(url.searchParams.get("limit") || "50", 10)));
  let annotations = readJsonl(status === "resolved" ? files.resolved : files.open);
  if (status !== "resolved") annotations = annotations.filter((annotation) => (annotation.status || "open") === "open");
  if (routeKey) annotations = annotations.filter((annotation) => (annotation.routeKey || "") === routeKey);
  return annotations
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, limit);
}

function updateOpenComment(id, value) {
  const comment = String(value || "").trim();
  if (!comment) throw new RequestError(400, "Comment cannot be empty.");
  if (comment.length > 100000) throw new RequestError(400, "Comment is too long.");
  const annotations = readJsonl(files.open);
  const index = annotations.findIndex((annotation) => annotation?.id === id);
  if (index === -1) throw new RequestError(404, `Annotation not found: ${id}`);
  annotations[index] = { ...annotations[index], comment, updatedAt: new Date().toISOString() };
  writeJsonl(files.open, annotations);
  return annotations[index];
}

function findAttachment(id, index) {
  const annotation = [...readJsonl(files.open), ...readJsonl(files.resolved)]
    .find((candidate) => candidate?.id === id);
  const attachment = annotation?.attachments?.[index];
  return assetStore.readAttachment(attachment);
}

function resolveAnnotation(id) {
  const open = readJsonl(files.open);
  const index = open.findIndex((annotation) => annotation?.id === id);
  if (index === -1) throw new RequestError(404, `Annotation not found: ${id}`);
  const [annotation] = open.splice(index, 1);
  const attachments = assetStore.resolveAttachments(annotation.attachments || []);
  const resolved = { ...annotation, status: "resolved", resolvedAt: new Date().toISOString(), attachments };
  writeJsonl(files.open, open);
  appendJsonl(files.resolved, resolved);
  return resolved;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Annotation-Token"
};

function sendJson(response, status, value) {
  response.writeHead(status, { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value, null, 2));
}

function readJson(request, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) reject(new RequestError(413, "Request body too large."));
      else chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new RequestError(400, "Invalid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function requireAuth(request, token) {
  if (String(request.headers["x-annotation-token"] || "").trim() !== token) {
    throw new RequestError(401, "Unauthorized (bad or missing X-Annotation-Token).");
  }
}

async function handleRequest(request, response, token) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, { ok: true, repoRoot, receiverBaseUrl: baseUrl });
    return;
  }
  if (request.method === "GET" && url.pathname === "/annotations") {
    sendJson(response, 200, { ok: true, annotations: listAnnotations(url) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/annotations") {
    requireAuth(request, token);
    const annotation = createAnnotation(await readJson(request, 25 * 1024 * 1024));
    sendJson(response, 200, { ok: true, id: annotation.id, attachments: annotation.attachments });
    return;
  }
  const attachmentMatch = /^\/annotations\/([^/]+)\/attachments\/(\d+)$/.exec(url.pathname);
  if (request.method === "GET" && attachmentMatch) {
    requireAuth(request, token);
    const attachment = findAttachment(decodeURIComponent(attachmentMatch[1]), Number(attachmentMatch[2]));
    const file = fs.readFileSync(attachment.absolutePath);
    response.writeHead(200, {
      ...corsHeaders,
      "Content-Type": attachment.mime || "application/octet-stream",
      "Content-Length": file.length,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(file);
    return;
  }
  const annotationMatch = /^\/annotations\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PATCH" && annotationMatch) {
    requireAuth(request, token);
    const annotation = updateOpenComment(decodeURIComponent(annotationMatch[1]), (await readJson(request)).comment);
    sendJson(response, 200, { ok: true, annotation });
    return;
  }
  const statusMatch = /^\/annotations\/([^/]+)\/status$/.exec(url.pathname);
  if (request.method === "POST" && statusMatch) {
    requireAuth(request, token);
    const body = await readJson(request);
    if (body.status !== "resolved") throw new RequestError(400, "Only status=resolved is supported.");
    const annotation = resolveAnnotation(decodeURIComponent(statusMatch[1]));
    sendJson(response, 200, { ok: true, id: annotation.id, status: annotation.status });
    return;
  }
  throw new RequestError(404, "Not found.");
}

function main() {
  ensureDataDirs();
  const token = loadOrCreateToken();
  fs.writeFileSync(files.config, `${JSON.stringify({ receiverBaseUrl: baseUrl, tokenPath: ".agent-annotations/token.txt" }, null, 2)}\n`);
  const server = http.createServer((request, response) => {
    handleRequest(request, response, token).catch((error) => {
      if (!response.headersSent) sendJson(response, error.status || 500, { ok: false, error: error.message });
      else response.destroy(error);
    });
  });
  server.listen(port, host, () => {
    console.log(`Agent Annotations Receiver\nRepo root: ${repoRoot}`);
    console.log(`Token (paste into extension): ${token}`);
    console.log(`Listening on http://${host}:${port}\nSuggested base URL for tools: ${baseUrl}`);
  });
}

main();
