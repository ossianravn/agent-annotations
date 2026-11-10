#!/usr/bin/env node
// Card commands for agents. Installed into a repo as .tools/agent-annotations-cards.cjs;
// it edits .agent-annotations/cards/ directly, under the same lock as the receiver,
// so it works whether or not the receiver is running.

const fs = require("fs");
const path = require("path");
const { STATUSES, compareRank, createCardStore } = require("./agent-annotations-receiver-cards.cjs");

const USAGE = `Usage: node .tools/agent-annotations-cards.cjs <command> [options]

  list [--status ready|active|all|<status>] [--json]   List cards (default: active)
  show <id> [--json]                                   Print one card
  next --agent <name> [--json]                         Claim the top Ready card
  claim <id> --agent <name>                            Claim a specific Ready card
  comment <id> "text" [--agent <name>]                 Add a note to the card
  check <id> <number> [--undo]                         Tick (or untick) an acceptance criterion
  handback <id> --review "summary" [--link <ref>]...   Done: hand back for review
  handback <id> --question "question"                  Blocked: ask the human
  move <id> <status> [--reason question|review]        Set a status by hand
  archive <id>                                         Hide a finished card

Statuses: ${STATUSES.join(", ")}
Options: --repo <path> (default: this repo), --agent (or AGENT_ANNOTATIONS_AGENT)`;

function parseArgs(argv) {
  const options = { _: [], links: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      options._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["json", "undo"].includes(key)) options[key] = true;
    else if (key === "link") options.links.push(argv[++index]);
    else options[key] = argv[++index];
  }
  return options;
}

function defaultRepo() {
  // Installed at <repo>/.tools/, so the repo is one level up; from a package, use the working directory.
  return path.basename(__dirname) === ".tools" ? path.resolve(__dirname, "..") : process.cwd();
}

function readConfig(repoRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(repoRoot, ".agent-annotations", "config.json"), "utf8"));
  } catch {
    return {};
  }
}

const statusLabel = (card) => (card.status === "waiting" ? `waiting (${card.waitingReason})` : card.status);

function summaryLine(card) {
  const claim = card.claimedBy ? ` [${card.claimedBy}]` : "";
  return `${card.id}  ${statusLabel(card).padEnd(18)} ${String(card.severity || "info").padEnd(8)} ${card.title}${claim}`;
}

function details(card, repoRoot) {
  const lines = [
    `${card.title}`,
    `ID: ${card.id}`,
    `Status: ${statusLabel(card)}${card.claimedBy ? ` (claimed by ${card.claimedBy})` : ""}`,
    `Type: ${card.severity || "info"}`,
    card.url ? `Page: ${card.url}` : null,
    card.element?.primary ? `Element: ${card.element.primary.type}=${card.element.primary.value}` : null,
    card.layout?.viewportWidth ? `Layout: ${card.layout.viewportWidth}px wide viewport` : null,
    card.tags?.length ? `Tags: ${card.tags.join(", ")}` : null,
    ...(card.attachments || []).map((attachment) => `Attachment: ${path.join(repoRoot, attachment.path)}`),
    "",
    card.comment || "(no description)"
  ];
  if (card.acceptance?.length) {
    lines.push("", "Done when:");
    card.acceptance.forEach((item, index) => lines.push(`  ${index + 1}. [${item.done ? "x" : " "}] ${item.text}`));
  }
  for (const entry of card.activity || []) lines.push("", `[${entry.at}] ${entry.author} (${entry.kind}): ${entry.text}`);
  return lines.filter((line) => line !== null).join("\n");
}

function print(value, options, repoRoot) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    process.stdout.write(value.length ? `${value.map(summaryLine).join("\n")}\n` : "No cards.\n");
    return;
  }
  process.stdout.write(`${details(value, repoRoot)}\n`);
}

function agentName(options) {
  return String(options.agent || process.env.AGENT_ANNOTATIONS_AGENT || "").trim();
}

function requireArg(value, message) {
  if (!value) throw Object.assign(new Error(message), { status: 400 });
  return value;
}

function run(argv, overrides = {}) {
  const options = parseArgs(argv);
  const [command, id, extra] = options._;
  if (!command || command === "help" || options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const repoRoot = path.resolve(options.repo || overrides.repoRoot || defaultRepo());
  const config = readConfig(repoRoot);
  const cards = createCardStore(repoRoot, { wipLimit: config.wipLimitPerAgent || 2 });
  cards.migrateInbox();

  if (command === "list") {
    const status = String(options.status || "active").toLowerCase();
    let list = status === "active" ? cards.activeCards() : cards.listCards();
    if (!["active", "all"].includes(status)) list = list.filter((card) => card.status === status && !card.archivedAt);
    print(list.sort(compareRank), options, repoRoot);
  } else if (command === "show") {
    print(cards.requireCard(requireArg(id, "Which card? Pass its ID.")), options, repoRoot);
  } else if (command === "next") {
    const card = cards.claimNext(requireArg(agentName(options), "Pass --agent <name> so the claim says who holds it."));
    if (!card) {
      process.stdout.write(options.json ? "null\n" : "No cards are ready for an agent.\n");
      return 0;
    }
    print(card, options, repoRoot);
  } else if (command === "claim") {
    print(cards.claimCard(requireArg(id, "Which card? Pass its ID."), requireArg(agentName(options), "Pass --agent <name>.")), options, repoRoot);
  } else if (command === "comment") {
    const card = cards.addActivity(requireArg(id, "Which card? Pass its ID."), {
      author: agentName(options) || "agent",
      kind: "comment",
      text: requireArg(String(extra || "").trim(), "Write the comment text in quotes.")
    });
    print(card, options, repoRoot);
  } else if (command === "check") {
    const card = cards.checkAcceptance(
      requireArg(id, "Which card? Pass its ID."),
      requireArg(extra, "Which criterion? Pass its number from `show`."),
      !options.undo
    );
    print(card, options, repoRoot);
  } else if (command === "handback") {
    const reason = options.review != null ? "review" : options.question != null ? "question" : null;
    const card = cards.handBack(requireArg(id, "Which card? Pass its ID."), {
      agent: agentName(options),
      reason: requireArg(reason, "Hand back with --review \"summary\" or --question \"question\"."),
      text: options.review ?? options.question,
      links: options.links.filter(Boolean)
    });
    print(card, options, repoRoot);
  } else if (command === "move") {
    const card = cards.updateCard(requireArg(id, "Which card? Pass its ID."), {
      status: requireArg(extra, `Which status? One of: ${STATUSES.join(", ")}.`),
      waitingReason: options.reason
    });
    print(card, options, repoRoot);
  } else if (command === "archive") {
    print(cards.updateCard(requireArg(id, "Which card? Pass its ID."), { archived: true }), options, repoRoot);
  } else {
    throw Object.assign(new Error(`Unknown command: ${command}\n\n${USAGE}`), { status: 400 });
  }
  return 0;
}

module.exports = { run };

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
