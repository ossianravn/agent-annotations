#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createAssetStore } = require("./agent-annotations-receiver-assets.cjs");
const { createCardStore } = require("./agent-annotations-receiver-cards.cjs");

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index === -1 ? fallback : argv[index + 1] || fallback;
};

const port = Number.parseInt(argValue("--port", process.env.ANNOTATION_PORT || "8787"), 10);
// Only this computer by default. Pass --host 0.0.0.0 when the receiver runs
// in a container or VM and Chrome connects from outside it.
const host = argValue("--host", process.env.ANNOTATION_HOST || "127.0.0.1");
const repoRoot = path.resolve(argValue("--repo", process.env.ANNOTATION_REPO_ROOT || process.cwd()));
const baseUrl = argValue("--base-url", process.env.ANNOTATION_BASE_URL || `http://127.0.0.1:${port}`);
const dataDir = path.join(repoRoot, ".agent-annotations");
const files = {
  token: path.join(dataDir, "token.txt"),
  config: path.join(dataDir, "config.json")
};
// The extension caps attachments at 20 MiB decoded; base64 adds a third.
const MAX_CREATE_BODY_BYTES = 32 * 1024 * 1024;
const DEFAULT_WIP_LIMIT = 2;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
  fs.writeFileSync(files.token, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

// "open" (what the extension asks for) means every card that isn't finished.
function listAnnotations(cards, url) {
  const status = (url.searchParams.get("status") || "open").trim().toLowerCase();
  const routeKey = (url.searchParams.get("routeKey") || "").trim();
  const limit = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get("limit"), 10) || 50));
  let annotations;
  if (["open", "active"].includes(status)) annotations = cards.activeCards();
  else if (status === "all") annotations = cards.listCards();
  else {
    const wanted = status === "resolved" ? "done" : status;
    annotations = cards.listCards().filter((card) => card.status === wanted && !card.archivedAt);
  }
  if (routeKey) annotations = annotations.filter((annotation) => (annotation.routeKey || "") === routeKey);
  return annotations
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
    .slice(0, limit);
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

function pathId(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new RequestError(400, "Malformed annotation ID.");
  }
}

// Pushes "cards changed" to open boards and panels. Polling the card files
// (only while someone listens) also catches edits by agents and by hand,
// and behaves the same on every OS, unlike file watchers.
function createEventHub(cardsDir) {
  const clients = new Set();
  let timer = null;
  let signature = "";
  let ticks = 0;

  function currentSignature() {
    if (!fs.existsSync(cardsDir)) return "";
    return fs.readdirSync(cardsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          const stats = fs.statSync(path.join(cardsDir, entry.name, "card.md"));
          return `${entry.name}:${stats.mtimeMs}:${stats.size}`;
        } catch {
          return entry.name;
        }
      })
      .sort()
      .join("|");
  }

  function poll() {
    ticks += 1;
    const next = currentSignature();
    const message = next !== signature ? "event: cards\ndata: {}\n\n" : ticks % 20 === 0 ? ": ping\n\n" : null;
    signature = next;
    if (message) for (const client of clients) client.write(message);
  }

  return {
    add(response) {
      response.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });
      response.write("retry: 2000\n: connected\n\n");
      clients.add(response);
      if (!timer) {
        signature = currentSignature();
        timer = setInterval(poll, 1000);
      }
      response.on("close", () => {
        clients.delete(response);
        if (!clients.size) {
          clearInterval(timer);
          timer = null;
        }
      });
    }
  };
}

function sendAttachment(response, attachment) {
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
}

async function handleRequest(request, response, context) {
  const { token, project, cards, assetStore, events } = context;
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      projectId: project.projectId,
      name: project.name,
      receiverBaseUrl: baseUrl,
      wipLimitPerAgent: project.wipLimitPerAgent
    });
    return;
  }
  // Everything else needs the token: CORS allows any origin, so without it
  // any web page could read or change the cards.
  requireAuth(request, token);

  if (request.method === "GET" && url.pathname === "/events") {
    events.add(response);
    return;
  }
  if (request.method === "GET" && url.pathname === "/annotations") {
    sendJson(response, 200, { ok: true, annotations: listAnnotations(cards, url) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/annotations") {
    const body = await readJson(request, MAX_CREATE_BODY_BYTES);
    const annotation = body?.annotation;
    if (!annotation || typeof annotation !== "object") throw new RequestError(400, "Missing 'annotation' object.");
    const assets = Array.isArray(body.assets) ? body.assets : [];
    const { card, duplicate } = cards.createCard(annotation, (relativeDir) => assetStore.storeUploads(relativeDir, assets));
    sendJson(response, 200, { ok: true, id: card.id, status: card.status, attachments: card.attachments, duplicate });
    return;
  }
  const attachmentMatch = /^\/annotations\/([^/]+)\/attachments\/(\d+)$/.exec(url.pathname);
  if (request.method === "GET" && attachmentMatch) {
    const card = cards.requireCard(pathId(attachmentMatch[1]));
    sendAttachment(response, assetStore.readAttachment(card.attachments?.[Number(attachmentMatch[2])]));
    return;
  }
  const annotationMatch = /^\/annotations\/([^/]+)$/.exec(url.pathname);
  if (request.method === "PATCH" && annotationMatch) {
    const { comment, title, rank, status, waitingReason, archived } = await readJson(request);
    const annotation = cards.updateCard(pathId(annotationMatch[1]), { comment, title, rank, status, waitingReason, archived });
    sendJson(response, 200, { ok: true, annotation });
    return;
  }
  const statusMatch = /^\/annotations\/([^/]+)\/status$/.exec(url.pathname);
  if (request.method === "POST" && statusMatch) {
    const { status, waitingReason } = await readJson(request);
    if (!status) throw new RequestError(400, "Missing 'status'.");
    const annotation = cards.updateCard(pathId(statusMatch[1]), { status, waitingReason });
    sendJson(response, 200, { ok: true, id: annotation.id, status: annotation.status, annotation });
    return;
  }
  const addAttachmentsMatch = /^\/annotations\/([^/]+)\/attachments$/.exec(url.pathname);
  if (request.method === "POST" && addAttachmentsMatch) {
    const body = await readJson(request, MAX_CREATE_BODY_BYTES);
    const assets = Array.isArray(body.assets) ? body.assets : [];
    if (!assets.length) throw new RequestError(400, "No attachments were sent.");
    const annotation = cards.addAttachments(pathId(addAttachmentsMatch[1]), (relativeDir, startIndex) => (
      assetStore.storeUploads(relativeDir, assets, startIndex)
    ));
    sendJson(response, 200, { ok: true, annotation });
    return;
  }
  const commentMatch = /^\/annotations\/([^/]+)\/comments$/.exec(url.pathname);
  if (request.method === "POST" && commentMatch) {
    const { author, text } = await readJson(request);
    if (!String(text || "").trim()) throw new RequestError(400, "Comment text is empty.");
    const annotation = cards.addActivity(pathId(commentMatch[1]), {
      author: String(author || "you").trim() || "you",
      kind: "comment",
      text: String(text).trim()
    });
    sendJson(response, 200, { ok: true, annotation });
    return;
  }
  throw new RequestError(404, "Not found.");
}

// The project ID identifies this repo to the extension, so it must survive
// restarts and reinstalls; the base URL is refreshed on every start.
function loadProjectConfig() {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(files.config, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Rewriting unreadable ${files.config}: ${error.message}`);
  }
  const config = {
    ...saved,
    projectId: typeof saved.projectId === "string" && saved.projectId ? saved.projectId : `prj_${crypto.randomUUID()}`,
    name: typeof saved.name === "string" && saved.name.trim() ? saved.name.trim() : path.basename(repoRoot),
    receiverBaseUrl: baseUrl,
    tokenPath: ".agent-annotations/token.txt",
    wipLimitPerAgent: Number.isInteger(saved.wipLimitPerAgent) && saved.wipLimitPerAgent > 0
      ? saved.wipLimitPerAgent
      : DEFAULT_WIP_LIMIT
  };
  fs.writeFileSync(files.config, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const token = loadOrCreateToken();
  const project = loadProjectConfig();
  const cards = createCardStore(repoRoot, { wipLimit: project.wipLimitPerAgent });
  const assetStore = createAssetStore(repoRoot, cards.cardsDir);
  const migrated = cards.migrateInbox();
  const events = createEventHub(cards.cardsDir);
  const server = http.createServer((request, response) => {
    handleRequest(request, response, { token, project, cards, assetStore, events }).catch((error) => {
      if (!response.headersSent) sendJson(response, error.status || 500, { ok: false, error: error.message });
      else response.destroy(error);
    });
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the other receiver or start this one with --port <port>.`);
    } else {
      console.error(`Receiver could not start: ${error.message}`);
    }
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Agent Annotations Receiver\nProject: ${project.name} (${project.projectId})\nRepo root: ${repoRoot}`);
    if (migrated) console.log(`Moved ${migrated} annotations from inbox.jsonl into .agent-annotations/cards/ (old files kept as *.migrated).`);
    console.log(`Token (paste into extension): ${token}`);
    console.log(`Listening on http://${host}:${port}\nSuggested base URL for tools: ${baseUrl}`);
  });
}

main();
