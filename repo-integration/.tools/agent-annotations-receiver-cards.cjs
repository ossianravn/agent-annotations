// Cards: one folder per card under .agent-annotations/cards/<id>/ holding
// card.md (JSON front matter + the comment as Markdown) and assets/.
// The receiver and the agent CLI both write through this module, under one
// lock file, so claims stay atomic whether or not the receiver is running.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATUSES = ["draft", "ready", "in_progress", "waiting", "done", "wont_do"];
const ACTIVE_STATUSES = new Set(["draft", "ready", "in_progress", "waiting"]);
const WAITING_REASONS = new Set(["question", "review"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 30000;

function cardError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function now() {
  return new Date().toISOString();
}

function normalizedType(value) {
  const type = String(value || "info").toLowerCase();
  if (["note", "information", "request"].includes(type)) return "info";
  if (["question", "warning", "new feature"].includes(type)) return "feature";
  return type;
}

// Older clients send "open"/"resolved"; they mean Ready and Done.
function normalizedStatus(value) {
  const status = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "open") return "ready";
  if (status === "resolved") return "done";
  return status;
}

function titleFrom(comment) {
  const line = String(comment || "").split(/\r?\n/).find((candidate) => candidate.trim()) || "Untitled";
  const title = line.trim();
  return title.length > 80 ? `${title.slice(0, 79)}…` : title;
}

function serializeCard(card) {
  const { comment = "", ...fields } = card;
  return `---\n${JSON.stringify(fields, null, 2)}\n---\n\n${String(comment).trim()}\n`;
}

function parseCard(text, file) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file} does not start with a --- front matter block.`);
  let fields;
  try {
    fields = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${file}: front matter is not valid JSON (${error.message}).`);
  }
  return { ...fields, comment: match[2].trim() };
}

function createCardStore(repoRoot, options = {}) {
  const dataDir = path.join(repoRoot, ".agent-annotations");
  const cardsDir = path.join(dataDir, "cards");
  const lockFile = path.join(cardsDir, ".lock");
  const wipLimit = options.wipLimit ?? 2;

  function cardDir(id) {
    if (!ID_PATTERN.test(String(id || ""))) throw cardError(400, "Card IDs may only contain letters, digits, '.', '_' and '-'.");
    return path.join(cardsDir, id);
  }

  function withLock(task) {
    fs.mkdirSync(cardsDir, { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        fs.writeFileSync(lockFile, `${process.pid}\n`, { flag: "wx" });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // A crashed writer leaves the lock behind; it is safe to take over.
        try {
          if (Date.now() - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) fs.rmSync(lockFile, { force: true });
        } catch {
          // The holder released it between the two calls.
        }
        if (Date.now() > deadline) throw cardError(503, "Cards are busy in another process. Try again.");
        sleepSync(25);
      }
    }
    try {
      return task();
    } finally {
      fs.rmSync(lockFile, { force: true });
    }
  }

  function readCard(id) {
    const file = path.join(cardDir(id), "card.md");
    if (!fs.existsSync(file)) return null;
    return parseCard(fs.readFileSync(file, "utf8"), path.relative(repoRoot, file));
  }

  function requireCard(id) {
    const card = readCard(id);
    if (!card) throw cardError(404, `Card not found: ${id}`);
    return card;
  }

  function writeCard(card) {
    const directory = cardDir(card.id);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "card.md");
    fs.writeFileSync(`${file}.tmp`, serializeCard(card), "utf8");
    fs.renameSync(`${file}.tmp`, file);
    return card;
  }

  function listCards() {
    if (!fs.existsSync(cardsDir)) return [];
    const cards = [];
    for (const entry of fs.readdirSync(cardsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue;
      try {
        const card = readCard(entry.name);
        if (card) cards.push(card);
      } catch (error) {
        // One hand-edited file must not hide every other card.
        console.warn(`Skipping card ${entry.name}: ${error.message}`);
      }
    }
    return cards;
  }

  function byRank(left, right) {
    return String(left.rank || left.createdAt).localeCompare(String(right.rank || right.createdAt));
  }

  function createCard(fields, storeAssets) {
    return withLock(() => {
      const supplied = String(fields.id || "").trim();
      if (supplied) {
        const existing = readCard(supplied);
        if (existing) {
          // A retried send of the same card (its response was lost) is not a conflict.
          if (fields.clientHash && existing.clientHash === fields.clientHash) return { card: existing, duplicate: true };
          throw cardError(409, `Card already exists: ${supplied}`);
        }
      }
      const id = supplied || `ann_${now().replace(/[:.]/g, "-")}_${crypto.randomBytes(4).toString("hex")}`;
      const status = normalizedStatus(fields.status);
      const createdAt = String(fields.createdAt || "").trim() || now();
      const { comment = "", ...rest } = fields;
      const card = {
        ...rest,
        id,
        title: String(fields.title || "").trim() || titleFrom(comment),
        status: ["draft", "ready"].includes(status) ? status : "ready",
        severity: normalizedType(fields.severity),
        tags: Array.isArray(fields.tags) ? fields.tags : [],
        rank: createdAt,
        createdAt,
        updatedAt: now(),
        activity: [],
        attachments: storeAssets ? storeAssets(path.posix.join(".agent-annotations", "cards", id, "assets")) : [],
        comment
      };
      return { card: writeCard(card), duplicate: false };
    });
  }

  function applyStatus(card, status, details = {}) {
    if (!STATUSES.includes(status)) throw cardError(400, `Unknown status: ${status}. Use one of ${STATUSES.join(", ")}.`);
    const next = { ...card, status, updatedAt: now() };
    if (status !== "in_progress") {
      delete next.claimedBy;
      delete next.claimedAt;
      delete next.heartbeatAt;
    }
    if (status === "waiting") {
      const reason = details.waitingReason || card.waitingReason;
      if (!WAITING_REASONS.has(reason)) throw cardError(400, "Waiting cards need a reason: question or review.");
      next.waitingReason = reason;
    } else {
      delete next.waitingReason;
    }
    if (["done", "wont_do"].includes(status)) next.closedAt = now();
    else delete next.closedAt;
    return next;
  }

  function updateCard(id, patch) {
    return withLock(() => {
      let card = requireCard(id);
      if (patch.comment != null) {
        const comment = String(patch.comment).trim();
        if (!comment) throw cardError(400, "Comment cannot be empty.");
        if (comment.length > 100000) throw cardError(400, "Comment is too long.");
        card = { ...card, comment, updatedAt: now() };
      }
      if (patch.status != null) card = applyStatus(card, normalizedStatus(patch.status), patch);
      if (patch.archived != null) card = { ...card, archivedAt: patch.archived ? now() : undefined, updatedAt: now() };
      return writeCard(card);
    });
  }

  function claimCard(id, agent) {
    return withLock(() => claimLocked(requireCard(id), agent));
  }

  function claimLocked(card, agent) {
    const name = String(agent || "").trim();
    if (!name) throw cardError(400, "Claiming needs an agent name.");
    if (card.status !== "ready") throw cardError(409, `Card ${card.id} is ${card.status}, not ready.`);
    const held = listCards().filter((candidate) => candidate.status === "in_progress" && candidate.claimedBy === name);
    if (held.length >= wipLimit) {
      throw cardError(409, `${name} already has ${held.length} cards in progress (limit ${wipLimit}). Hand one back first.`);
    }
    const at = now();
    return writeCard({ ...card, status: "in_progress", claimedBy: name, claimedAt: at, heartbeatAt: at, updatedAt: at });
  }

  // Pull, don't push: the highest-ranked Ready card goes to the asking agent.
  function claimNext(agent) {
    return withLock(() => {
      const next = listCards().filter((card) => card.status === "ready" && !card.archivedAt).sort(byRank)[0];
      return next ? claimLocked(next, agent) : null;
    });
  }

  function addActivity(id, entry) {
    return withLock(() => {
      const card = requireCard(id);
      const at = now();
      const updated = { ...card, activity: [...(card.activity || []), { at, ...entry }], updatedAt: at };
      if (card.status === "in_progress" && card.claimedBy === entry.author) updated.heartbeatAt = at;
      return writeCard(updated);
    });
  }

  function handBack(id, { agent, reason, text, links = [] }) {
    if (!WAITING_REASONS.has(reason)) throw cardError(400, "Hand back for review or with a question.");
    if (!String(text || "").trim()) throw cardError(400, reason === "review" ? "Write a summary of the change." : "Write the question.");
    return withLock(() => {
      const card = requireCard(id);
      if (card.status !== "in_progress") throw cardError(409, `Card ${id} is ${card.status}; only cards in progress can be handed back.`);
      const at = now();
      const handed = applyStatus(card, "waiting", { waitingReason: reason });
      return writeCard({
        ...handed,
        lastAgent: agent || card.claimedBy,
        links: [...(card.links || []), ...links],
        activity: [...(card.activity || []), { at, author: agent || card.claimedBy || "agent", kind: reason, text: String(text).trim() }]
      });
    });
  }

  function migrateAttachments(record, id) {
    const legacyAssets = `${path.join(dataDir, "assets")}${path.sep}`;
    const assetsDir = path.join(cardDir(id), "assets");
    return (record.attachments || []).map((attachment, index) => {
      if (!attachment?.path) return attachment;
      const source = path.resolve(repoRoot, String(attachment.path).replace(/\\/g, "/"));
      // Only files the receiver itself stored are moved.
      if (!source.startsWith(legacyAssets) || !fs.existsSync(source)) return attachment;
      const name = `${index}_${path.basename(source).replace(`${record.id}_${index}_`, "")}`;
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.renameSync(source, path.join(assetsDir, name));
      return { ...attachment, path: path.posix.join(".agent-annotations", "cards", id, "assets", name) };
    });
  }

  // Moves records from the pre-0.5 inbox files into card folders, once.
  // The old files stay next to the cards, renamed, as a backup.
  function migrateInbox() {
    const sources = [
      { file: path.join(dataDir, "inbox.jsonl"), status: "ready" },
      { file: path.join(dataDir, "inbox-resolved.jsonl"), status: "done" }
    ].filter(({ file }) => fs.existsSync(file));
    if (!sources.length) return 0;
    return withLock(() => {
      let migrated = 0;
      for (const { file, status } of sources) {
        const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
        for (const [lineIndex, line] of lines.entries()) {
          let record;
          try {
            record = JSON.parse(line);
          } catch {
            console.warn(`Skipping unreadable line ${lineIndex + 1} of ${path.basename(file)} during migration.`);
            continue;
          }
          const id = ID_PATTERN.test(String(record.id || "")) ? record.id : `ann_migrated_${crypto.randomBytes(6).toString("hex")}`;
          if (readCard(id)) continue;
          const { status: legacyStatus, resolvedAt, comment = "", ...rest } = record;
          const createdAt = record.createdAt || now();
          writeCard({
            ...rest,
            id,
            title: record.title || titleFrom(comment),
            status,
            severity: normalizedType(record.severity),
            tags: Array.isArray(record.tags) ? record.tags : [],
            rank: createdAt,
            createdAt,
            updatedAt: now(),
            activity: [],
            attachments: migrateAttachments(record, id),
            ...(status === "done" ? { closedAt: resolvedAt || now() } : {}),
            comment
          });
          migrated += 1;
        }
        const backup = fs.existsSync(`${file}.migrated`) ? `${file}.migrated-${Date.now()}` : `${file}.migrated`;
        fs.renameSync(file, backup);
      }
      return migrated;
    });
  }

  function activeCards() {
    return listCards().filter((card) => ACTIVE_STATUSES.has(card.status) && !card.archivedAt);
  }

  return {
    cardsDir,
    activeCards,
    addActivity,
    claimCard,
    claimNext,
    createCard,
    handBack,
    listCards,
    migrateInbox,
    readCard,
    requireCard,
    updateCard,
    withLock,
    writeCard
  };
}

module.exports = {
  ACTIVE_STATUSES,
  STATUSES,
  createCardStore,
  normalizedStatus,
  parseCard,
  serializeCard,
  titleFrom
};
