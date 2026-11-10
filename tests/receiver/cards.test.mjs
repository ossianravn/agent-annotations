import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const cardsCli = path.join(root, "packages/agent-annotations-receiver/bin/agent-annotations-cards.cjs");

async function cli(repo, ...args) {
  const { stdout } = await run(process.execPath, [cardsCli, ...args, "--repo", repo, "--json"]);
  return JSON.parse(stdout);
}

async function cliFails(repo, ...args) {
  try {
    await run(process.execPath, [cardsCli, ...args, "--repo", repo]);
  } catch (error) {
    return error.stderr.trim();
  }
  throw new Error(`Expected "${args.join(" ")}" to fail.`);
}

async function repoWithCards(statuses) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-cards-"));
  for (const [index, status] of statuses.entries()) {
    const id = `card_${index}`;
    await mkdir(path.join(repo, ".agent-annotations/cards", id), { recursive: true });
    const fields = { id, title: `Card ${index}`, status, rank: `2026-01-0${index + 1}`, createdAt: `2026-01-0${index + 1}` };
    await writeFile(path.join(repo, ".agent-annotations/cards", id, "card.md"), `---\n${JSON.stringify(fields)}\n---\n\nDo thing ${index}\n`);
  }
  return repo;
}

test("the inbox from 0.4 migrates into card folders once", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-migrate-"));
  try {
    const data = path.join(repo, ".agent-annotations");
    await mkdir(path.join(data, "assets/open"), { recursive: true });
    await writeFile(path.join(data, "assets/open/ann_old_0_shot.png"), "png-bytes");
    const open = { id: "ann_old", status: "open", comment: "Fix the header", createdAt: "2026-01-01T00:00:00Z", attachments: [{ kind: "asset", mime: "image/png", path: ".agent-annotations\\assets\\open\\ann_old_0_shot.png" }] };
    const resolved = { id: "ann_done", status: "resolved", comment: "Old fix", resolvedAt: "2026-01-02T00:00:00Z" };
    await writeFile(path.join(data, "inbox.jsonl"), `${JSON.stringify(open)}\n`);
    await writeFile(path.join(data, "inbox-resolved.jsonl"), `${JSON.stringify(resolved)}\nnot json\n`);

    const cards = await cli(repo, "list", "--status", "all");
    const byId = Object.fromEntries(cards.map((card) => [card.id, card]));
    assert.equal(byId.ann_old.status, "ready");
    assert.equal(byId.ann_old.title, "Fix the header");
    assert.equal(byId.ann_old.attachments[0].path, ".agent-annotations/cards/ann_old/assets/0_shot.png");
    assert.equal(await readFile(path.join(data, "cards/ann_old/assets/0_shot.png"), "utf8"), "png-bytes");
    assert.equal(byId.ann_done.status, "done");
    await access(path.join(data, "inbox.jsonl.migrated"));
    await assert.rejects(access(path.join(data, "inbox.jsonl")));

    // Running again changes nothing.
    assert.equal((await cli(repo, "list", "--status", "all")).length, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("agents pull ready cards in rank order and hand them back", async () => {
  const repo = await repoWithCards(["draft", "ready", "ready", "ready"]);
  try {
    const first = await cli(repo, "next", "--agent", "codex");
    assert.equal(first.id, "card_1", "drafts are never handed to agents");
    assert.equal(first.status, "in_progress");
    assert.equal(first.claimedBy, "codex");
    assert.equal((await cli(repo, "next", "--agent", "codex")).id, "card_2");
    assert.match(await cliFails(repo, "next", "--agent", "codex"), /already has 2 cards in progress/);

    const reviewed = await cli(repo, "handback", "card_1", "--agent", "codex", "--review", "Disabled the button while recalculating", "--link", "abc123");
    assert.equal(reviewed.status, "waiting");
    assert.equal(reviewed.waitingReason, "review");
    assert.equal(reviewed.claimedBy, undefined);
    assert.deepEqual(reviewed.links, ["abc123"]);
    assert.equal(reviewed.activity.at(-1).text, "Disabled the button while recalculating");
    assert.match(await cliFails(repo, "handback", "card_1", "--question", "Again?"), /only cards in progress/);

    const asked = await cli(repo, "handback", "card_2", "--agent", "codex", "--question", "Lock the total or show a spinner?");
    assert.equal(asked.waitingReason, "question");
    assert.equal((await cli(repo, "move", "card_2", "ready")).status, "ready");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("parallel claims never hand the same card to two agents", async () => {
  const repo = await repoWithCards(["ready", "ready", "ready"]);
  try {
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => (
      run(process.execPath, [cardsCli, "next", "--agent", `agent_${index}`, "--repo", repo, "--json"])
        .then(({ stdout }) => JSON.parse(stdout))
    )));
    const claimed = attempts.filter(Boolean).map((card) => card.id).sort();
    assert.deepEqual(claimed, ["card_0", "card_1", "card_2"]);
    const files = await readdir(path.join(repo, ".agent-annotations/cards"));
    assert.equal(files.includes(".lock"), false, "the lock is released");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("one broken card file does not hide the others", async () => {
  const repo = await repoWithCards(["ready", "ready"]);
  try {
    await writeFile(path.join(repo, ".agent-annotations/cards/card_0/card.md"), "---\n{ not json\n---\n");
    const cards = await cli(repo, "list");
    assert.deepEqual(cards.map((card) => card.id), ["card_1"]);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
