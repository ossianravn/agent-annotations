#!/usr/bin/env node
/**
 * .tools/agent-annotations-receiver.js
 *
 * Tiny local HTTP server (no deps) that receives annotations from the Chrome extension and writes:
 *   Open:
 *     .agent-annotations/inbox.jsonl
 *     .agent-annotations/assets/open/*
 *   Resolved archive:
 *     .agent-annotations/inbox-resolved.jsonl
 *     .agent-annotations/assets/resolved/*
 *
 * Run from repo root (WSL2 / any):
 *   node .tools/agent-annotations-receiver.js --port 8787
 *
 * It prints a token on first run and stores it in:
 *   .agent-annotations/token.txt
 *
 * It also writes a small config for agents:
 *   .agent-annotations/config.json
 *     { "receiverBaseUrl": "http://localhost:8787" }
 *
 * Paste token into the extension’s Connection settings.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const argv = process.argv.slice(2);
function argValue(flag, fallback = null) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  return argv[i + 1] || fallback;
}

const PORT = parseInt(argValue("--port", process.env.ANNOTATION_PORT || "8787"), 10);
const HOST = argValue("--host", process.env.ANNOTATION_HOST || "0.0.0.0");
const REPO_ROOT = path.resolve(argValue("--repo", process.env.ANNOTATION_REPO_ROOT || process.cwd()));
const BASE_URL = argValue("--base-url", process.env.ANNOTATION_BASE_URL || `http://localhost:${PORT}`);

const dataDir = path.join(REPO_ROOT, ".agent-annotations");
const assetsOpenDir = path.join(dataDir, "assets", "open");
const assetsResolvedDir = path.join(dataDir, "assets", "resolved");
const inboxOpenFile = path.join(dataDir, "inbox.jsonl");
const inboxResolvedFile = path.join(dataDir, "inbox-resolved.jsonl");
const tokenFile = path.join(dataDir, "token.txt");
const configFile = path.join(dataDir, "config.json");

function ensureDirs() {
  fs.mkdirSync(assetsOpenDir, { recursive: true });
  fs.mkdirSync(assetsResolvedDir, { recursive: true });
}

function loadOrCreateToken() {
  if (process.env.ANNOTATION_TOKEN && process.env.ANNOTATION_TOKEN.trim()) {
    return process.env.ANNOTATION_TOKEN.trim();
  }
  try {
    const t = fs.readFileSync(tokenFile, "utf8").trim();
    if (t) return t;
  } catch {}
  const t = crypto.randomBytes(18).toString("base64url");
  fs.writeFileSync(tokenFile, t + "\n", "utf8");
  return t;
}

function writeConfig() {
  try {
    const cfg = { receiverBaseUrl: BASE_URL, tokenPath: ".agent-annotations/token.txt" };
    fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  } catch {}
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Annotation-Token"
  });
  res.end(body);
}

function readBody(req, limitBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: "application/octet-stream", b64: dataUrl || "" };
}

function safeName(name) {
  return String(name || "asset")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function extFromMime(mime) {
  if (!mime) return ".bin";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

function normalizeAssetFilename(rawName, mime, fallbackBase) {
  const desiredExt = extFromMime(mime);
  const base = safeName(rawName || fallbackBase);
  const lower = base.toLowerCase();
  // If something upstream already doubled extensions (e.g. ".png.png"), normalize it.
  const deduped = base.replace(/\.(png|jpe?g|webp|bin)(\.\1)+$/i, ".$1");
  const dedupedLower = deduped.toLowerCase();
  if (dedupedLower.endsWith(desiredExt)) return deduped;
  if (/\.(png|jpe?g|webp|bin)$/i.test(deduped)) return deduped;
  return deduped + desiredExt;
}

function generateId() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `ann_${ts}_${rand}`;
}

function appendJsonlLine(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

function writeJsonl(file, lines) {
  const tmp = file + ".tmp";
  const text = lines.map((o) => JSON.stringify(o)).join("\n") + (lines.length ? "\n" : "");
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

function getHeaderToken(req) {
  return (req.headers["x-annotation-token"] || "").toString().trim();
}

function requireAuth(req, token) {
  const provided = getHeaderToken(req);
  return provided && provided === token;
}

function handleHealth(req, res) {
  sendJson(res, 200, { ok: true, repoRoot: REPO_ROOT, receiverBaseUrl: BASE_URL });
}

function handleGetAnnotations(req, res, urlObj) {
  const status = (urlObj.searchParams.get("status") || "open").trim();
  const routeKey = (urlObj.searchParams.get("routeKey") || "").trim();
  const limit = Math.max(1, Math.min(200, parseInt(urlObj.searchParams.get("limit") || "50", 10)));

  let anns = [];
  if (status === "resolved") {
    anns = readJsonl(inboxResolvedFile);
  } else {
    anns = readJsonl(inboxOpenFile).filter(a => (a.status || "open") === "open");
  }

  if (routeKey) anns = anns.filter((a) => (a.routeKey || "") === routeKey);
  anns.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  anns = anns.slice(0, limit);

  sendJson(res, 200, { ok: true, annotations: anns });
}

async function handlePostAnnotation(req, res, token) {
  if (!requireAuth(req, token)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized (bad or missing X-Annotation-Token)." });
    return;
  }

  const bodyBuf = await readBody(req);
  let body = null;
  try { body = JSON.parse(bodyBuf.toString("utf8")); }
  catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON." });
    return;
  }

  const ann = body && body.annotation ? body.annotation : null;
  if (!ann || typeof ann !== "object") {
    sendJson(res, 400, { ok: false, error: "Missing 'annotation' object." });
    return;
  }

  const id = ann.id && String(ann.id).trim() ? String(ann.id).trim() : generateId();
  const createdAt = ann.createdAt && String(ann.createdAt).trim() ? String(ann.createdAt).trim() : new Date().toISOString();
  const severityRaw = String(ann.severity || "info").toLowerCase();
  const severity =
    severityRaw === "note" || severityRaw === "information" ? "info" :
    severityRaw === "question" || severityRaw === "warning" || severityRaw === "new feature" ? "feature" :
    severityRaw;

  const assets = Array.isArray(body.assets) ? body.assets : [];
  const attachments = [];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i] || {};
    const parsed = parseDataUrl(a.dataUrl || a.dataBase64 || "");
    if (!parsed || !parsed.b64) continue;

    const mime = a.mime || parsed.mime || "application/octet-stream";
    const name = normalizeAssetFilename(a.name, mime, `asset_${i}`);
    const relPath = path.join(".agent-annotations", "assets", "open", `${id}_${i}_${name}`);
    const absPath = path.join(REPO_ROOT, relPath);

    const bytes = Buffer.from(parsed.b64, "base64");
    fs.writeFileSync(absPath, bytes);

    attachments.push({ kind: "asset", mime, path: relPath });
  }

  const stored = { ...ann, id, createdAt, status: "open", severity, attachments };
  appendJsonlLine(inboxOpenFile, stored);
  sendJson(res, 200, { ok: true, id, attachments });
}

function moveAssetToResolved(relPath) {
  // relPath is repo-relative
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) return { ok: false, newRel: relPath };

  const base = path.basename(relPath);
  const newRel = path.join(".agent-annotations", "assets", "resolved", base);
  const newAbs = path.join(REPO_ROOT, newRel);
  try {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.renameSync(abs, newAbs);
    return { ok: true, newRel };
  } catch {
    return { ok: false, newRel: relPath };
  }
}

async function handlePostStatus(req, res, urlObj, token) {
  if (!requireAuth(req, token)) {
    sendJson(res, 401, { ok: false, error: "Unauthorized (bad or missing X-Annotation-Token)." });
    return;
  }

  const id = decodeURIComponent(urlObj.pathname.split("/")[2] || "");
  if (!id) {
    sendJson(res, 400, { ok: false, error: "Missing annotation id." });
    return;
  }

  const bodyBuf = await readBody(req, 512 * 1024);
  let body = null;
  try { body = JSON.parse(bodyBuf.toString("utf8")); }
  catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON." });
    return;
  }

  const status = body && body.status ? String(body.status) : "";
  if (!status) {
    sendJson(res, 400, { ok: false, error: "Missing status." });
    return;
  }

  if (status !== "resolved") {
    // MVP only supports resolving for now
    sendJson(res, 400, { ok: false, error: "Only status=resolved is supported in this version." });
    return;
  }

  const openLines = readJsonl(inboxOpenFile);
  const remaining = [];
  let moved = null;

  for (const a of openLines) {
    if (a && a.id === id) moved = a;
    else remaining.push(a);
  }

  if (!moved) {
    sendJson(res, 404, { ok: false, error: `Annotation not found: ${id}` });
    return;
  }

  // Move assets & rewrite attachment paths
  const updatedAttachments = [];
  for (const att of (moved.attachments || [])) {
    if (att && typeof att.path === "string" && att.path.includes(path.join(".agent-annotations","assets","open"))) {
      const mv = moveAssetToResolved(att.path);
      updatedAttachments.push({ ...att, path: mv.newRel });
    } else {
      updatedAttachments.push(att);
    }
  }

  const archived = { ...moved, status: "resolved", resolvedAt: new Date().toISOString(), attachments: updatedAttachments };

  // Update files
  writeJsonl(inboxOpenFile, remaining);
  appendJsonlLine(inboxResolvedFile, archived);

  sendJson(res, 200, { ok: true, id, status: "resolved" });
}

function main() {
  ensureDirs();
  const token = loadOrCreateToken();
  writeConfig();

  console.log("");
  console.log("Agent Annotations Receiver");
  console.log("--------------------------");
  console.log("Repo root:", REPO_ROOT);
  console.log("Open inbox:", path.relative(REPO_ROOT, inboxOpenFile));
  console.log("Resolved:", path.relative(REPO_ROOT, inboxResolvedFile));
  console.log("Assets (open):", path.relative(REPO_ROOT, assetsOpenDir));
  console.log("Assets (resolved):", path.relative(REPO_ROOT, assetsResolvedDir));
  console.log("Config:", path.relative(REPO_ROOT, configFile));
  console.log("Token (paste into extension):", token);
  console.log("");
  console.log(`Listening on http://${HOST}:${PORT}`);
  console.log(`Suggested base URL for tools: ${BASE_URL}`);
  console.log("");

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Annotation-Token"
        });
        res.end();
        return;
      }

      const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && urlObj.pathname === "/health") {
        handleHealth(req, res);
        return;
      }

      if (req.method === "GET" && urlObj.pathname === "/annotations") {
        handleGetAnnotations(req, res, urlObj);
        return;
      }

      if (req.method === "POST" && urlObj.pathname === "/annotations") {
        await handlePostAnnotation(req, res, token);
        return;
      }

      if (req.method === "POST" && /^\/annotations\/[^/]+\/status$/.test(urlObj.pathname)) {
        await handlePostStatus(req, res, urlObj, token);
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found." });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e?.message || e) });
    }
  });

  server.listen(PORT, HOST);
}

main();
