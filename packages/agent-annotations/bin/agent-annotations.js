#!/usr/bin/env node
/**
 * agent-annotations (init CLI)
 *
 * Intended usage after publishing:
 *   pnpm dlx agent-annotations init [--agent auto|codex|claude|gemini|antigravity|opencode|copilot|all]
 *                               [--skill repo|user|none]
 *                               [--receiver repo|none]
 *                               [--force]
 *
 * One-step workflow:
 *   pnpm dlx agent-annotations setup [--port 8787]
 *
 * Receiver only:
 *   pnpm dlx agent-annotations start [--port 8787]
 *
 * This command copies template files into the current repository:
 * - Optional: .tools/agent-annotations-receiver.cjs (local receiver launcher)
 * - Optional: an Agent Skills-compatible skill folder (check-agent-annotations)
 * - Optional: Copilot instruction file snippet
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

function usage() {
  console.log(`
agent-annotations

Usage:
  agent-annotations setup [options]   # recommended: installs + starts receiver
  agent-annotations start [options]   # starts receiver (expects .tools/ installed)
  agent-annotations init [options]    # installs templates only (no receiver)

Options:
  --agent     Which agent integration(s) to install (default: auto)
              auto | codex | claude | gemini | antigravity | opencode | copilot | all

  --skill     Where to install the skill/instructions (default: repo)
              repo  -> install into this repository (recommended for open-source)
              user  -> install into your user/global skill location (when supported)
              none  -> do not install any skill/instructions

  --receiver  Install the local receiver launcher into the repo (default: repo)
              repo  -> copy .tools/agent-annotations-receiver.cjs into this repo
              none  -> do not copy receiver files

  --port      Receiver port (default: 8787)
  --host      Receiver host (default: 0.0.0.0)
  --repo      Repo root to write .agent-annotations into (default: detected repo root)
  --no-start  For setup: install only, don’t start receiver

  --force     Overwrite existing files

Examples:
  pnpm dlx agent-annotations setup
  pnpm dlx agent-annotations setup --port 8787
  pnpm dlx agent-annotations start
  pnpm dlx agent-annotations init
  pnpm dlx agent-annotations init --agent codex
  pnpm dlx agent-annotations init --agent claude --skill user
  pnpm dlx agent-annotations init --agent all --skill repo
  pnpm dlx agent-annotations init --receiver none
`);
}

function parseArgs(argv) {
  const out = {
    cmd: null,
    agent: "auto",
    skill: "repo",
    receiver: "repo",
    force: false,
    start: true,
    port: null,
    host: null,
    repo: null,
    baseUrl: null
  };
  const a = argv.slice(2);
  out.cmd = a[0] || null;
  for (let i = 1; i < a.length; i++) {
    const v = a[i];
    if (v === "--force") out.force = true;
    else if (v === "--no-start") out.start = false;
    else if (v === "--agent") { out.agent = (a[i + 1] || "auto"); i++; }
    else if (v === "--skill") { out.skill = (a[i + 1] || "repo"); i++; }
    else if (v === "--receiver") { out.receiver = (a[i + 1] || "repo"); i++; }
    else if (v === "--port") { out.port = (a[i + 1] || null); i++; }
    else if (v === "--host") { out.host = (a[i + 1] || null); i++; }
    else if (v === "--repo") { out.repo = (a[i + 1] || null); i++; }
    else if (v === "--base-url") { out.baseUrl = (a[i + 1] || null); i++; }
  }

  const agentNorm = String(out.agent || "auto").toLowerCase();
  out.agent = agentNorm;

  if (!["repo","user","none"].includes(out.skill)) out.skill = "repo";
  if (!["repo","none"].includes(out.receiver)) out.receiver = "repo";

  return out;
}

function tryRepoRoot() {
  try {
    const r = cp.execSync("git rev-parse --show-toplevel", { stdio: ["ignore","pipe","ignore"] })
      .toString("utf8").trim();
    if (r) return r;
  } catch {}
  return process.cwd();
}

function receiverScriptPath(repoRoot) {
  const cjs = path.join(repoRoot, ".tools", "agent-annotations-receiver.cjs");
  if (fs.existsSync(cjs)) return cjs;
  return path.join(repoRoot, ".tools", "agent-annotations-receiver.js");
}

function repoIsEsm(repoRoot) {
  try {
    const p = path.join(repoRoot, "package.json");
    if (!fs.existsSync(p)) return false;
    const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
    return pkg && pkg.type === "module";
  } catch {
    return false;
  }
}

function startReceiver({ repoRoot, port, host, baseUrl }) {
  const toolsDir = path.join(repoRoot, ".tools");
  const scriptCjs = path.join(toolsDir, "agent-annotations-receiver.cjs");
  const scriptJs = path.join(toolsDir, "agent-annotations-receiver.js");

  let script = null;
  if (fs.existsSync(scriptCjs)) {
    script = scriptCjs;
  } else if (fs.existsSync(scriptJs)) {
    // If the repo is ESM, .js launchers may crash (require is undefined).
    // Install the .cjs launcher if the templates exist in this package.
    if (repoIsEsm(repoRoot)) {
      const templatesRoot = path.join(__dirname, "..", "templates", "repo-integration");
      const toolsSrc = path.join(templatesRoot, ".tools");
      try {
        copyFile(path.join(toolsSrc, "agent-annotations-receiver.cjs"), scriptCjs, false);
        copyFile(path.join(toolsSrc, "annotation-receiver.cjs"), path.join(toolsDir, "annotation-receiver.cjs"), false);
      } catch {}
    }
    if (fs.existsSync(scriptCjs)) script = scriptCjs;
    else script = scriptJs;
  } else {
    console.error("");
    console.error("Receiver launcher not found in:", toolsDir);
    console.error("Run setup first to install it:");
    console.error("  pnpm dlx agent-annotations setup");
    console.error("");
    process.exit(1);
  }

  const args = [script];
  if (port) args.push("--port", String(port));
  if (host) args.push("--host", String(host));
  if (repoRoot) args.push("--repo", String(repoRoot));
  if (baseUrl) args.push("--base-url", String(baseUrl));

  const child = cp.spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env
  });
  child.on("exit", (code) => process.exit(code || 0));
}

function copyFile(src, dest, force) {
  if (!force && fs.existsSync(dest)) return { copied: false, reason: "exists" };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { copied: true };
}

function copyDir(srcDir, destDir, force) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = path.join(srcDir, e.name);
    const dest = path.join(destDir, e.name);
    if (e.isDirectory()) {
      copyDir(src, dest, force);
    } else {
      copyFile(src, dest, force);
    }
  }
}

function codexHome() {
  const env = process.env.CODEX_HOME && process.env.CODEX_HOME.trim();
  if (env) return env;
  return path.join(os.homedir(), ".codex");
}

function detectAgents(repoRoot) {
  const out = [];
  const has = (p) => fs.existsSync(path.join(repoRoot, p));

  if (has(".codex") || has(".codex/skills")) out.push("codex");
  if (has(".claude") || has(".claude/skills") || has(".claude/commands")) out.push("claude");
  if (has(".gemini") || has(".gemini/skills") || has("GEMINI.md")) out.push("gemini");
  if (has(".agent") || has(".agent/skills")) out.push("antigravity");
  if (has(".opencode") || has(".opencode/skills")) out.push("opencode");
  if (has(".github/copilot-instructions.md") || has(".github/instructions")) out.push("copilot");

  return out.length ? out : ["codex"];
}

function normalizeAgents(agentArg, repoRoot) {
  const supported = new Set(["codex","claude","gemini","antigravity","opencode","copilot"]);
  if (!agentArg || agentArg === "auto") return detectAgents(repoRoot);

  if (agentArg === "all") return Array.from(supported);

  const list = String(agentArg)
    .split(/[,+\s]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s) => supported.has(s));

  return list.length ? list : detectAgents(repoRoot);
}

function skillDestFor(agent, scope, repoRoot) {
  const name = "check-agent-annotations";

  if (agent === "codex") {
    if (scope === "user") return path.join(codexHome(), "skills", name);
    return path.join(repoRoot, ".codex", "skills", name);
  }

  if (agent === "claude") {
    if (scope === "user") return path.join(os.homedir(), ".claude", "skills", name);
    return path.join(repoRoot, ".claude", "skills", name);
  }

  if (agent === "gemini") {
    if (scope === "user") return path.join(os.homedir(), ".gemini", "skills", name);
    return path.join(repoRoot, ".gemini", "skills", name);
  }

  if (agent === "antigravity") {
    if (scope === "user") return path.join(os.homedir(), ".gemini", "antigravity", "skills", name);
    return path.join(repoRoot, ".agent", "skills", name);
  }

  if (agent === "opencode") {
    if (scope === "user") return path.join(os.homedir(), ".config", "opencode", "skills", name);
    return path.join(repoRoot, ".opencode", "skills", name);
  }

  return null;
}

function copilotInstructionsPath(repoRoot) {
  return path.join(repoRoot, ".github", "copilot-instructions.md");
}

function renderCopilotSnippet() {
  return `

## Agent Annotations

- UI annotations may exist under \`.agent-annotations/\`.
- If the user asks you to check annotations (or it is clearly relevant), read:
  - \`.agent-annotations/inbox.jsonl\` (open items)
  - \`.agent-annotations/inbox-resolved.jsonl\` (archive, if present)
- Use annotation data to decide *what to change* and *where*.
- After you implement a fix, mark related annotations as \`resolved\` (append a resolved event to \`inbox-resolved.jsonl\` or follow the repo’s process).

Browser validation:
- Only validate in a browser if the user explicitly requests it, and only using tools available in your environment.
`;
}

function runInit(args, repoRoot) {
  const templatesRoot = path.join(__dirname, "..", "templates", "repo-integration");

  if (!fs.existsSync(templatesRoot)) {
    console.error("Templates not found:", templatesRoot);
    process.exit(1);
  }

  // Receiver launcher (repo integration)
  if (args.receiver !== "none") {
    const toolsSrc = path.join(templatesRoot, ".tools");
    const toolsDest = path.join(repoRoot, ".tools");
    copyDir(toolsSrc, toolsDest, args.force);
  }

  // Helpful extras (examples/snippets) into repo root, but don't overwrite unless --force
  copyFile(path.join(templatesRoot, "AGENTS.md.example"), path.join(repoRoot, "AGENTS.md.example"), args.force);
  copyFile(path.join(templatesRoot, ".gitignore.snippet"), path.join(repoRoot, ".gitignore.snippet"), args.force);

  const agents = normalizeAgents(args.agent, repoRoot);

  // Skill/instructions
  if (args.skill !== "none") {
    const skillSrc = path.join(templatesRoot, "skills", "check-agent-annotations");

    for (const agent of agents) {
      if (agent === "copilot") {
        // Copilot uses instruction files (not SKILL.md)
        const dest = copilotInstructionsPath(repoRoot);
        if (!args.force && fs.existsSync(dest)) {
          const existing = fs.readFileSync(dest, "utf8");
          if (!existing.includes("## Agent Annotations")) {
            fs.appendFileSync(dest, renderCopilotSnippet());
          }
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, `# GitHub Copilot Instructions\n${renderCopilotSnippet().trimStart()}`);
        }
        continue;
      }

      const dest = skillDestFor(agent, args.skill, repoRoot);
      if (!dest) continue;

      copyDir(skillSrc, dest, args.force);
    }
  }

  return { repoRoot, agents };
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.cmd || args.cmd === "-h" || args.cmd === "--help") {
    usage();
    process.exit(args.cmd ? 0 : 1);
  }
  if (!["init", "setup", "start"].includes(args.cmd)) {
    console.error("Unknown command:", args.cmd);
    usage();
    process.exit(1);
  }

  const targetRepoRoot = path.resolve(args.repo || tryRepoRoot());

  if (args.cmd === "start") {
    startReceiver({
      repoRoot: targetRepoRoot,
      port: args.port || process.env.ANNOTATION_PORT || "8787",
      host: args.host || process.env.ANNOTATION_HOST || "0.0.0.0",
      baseUrl: args.baseUrl || process.env.ANNOTATION_BASE_URL || null
    });
    return;
  }

  const { agents } = runInit(args, targetRepoRoot);

  console.log("");
  console.log("Agent Annotations initialized in:", targetRepoRoot);
  console.log("Installed integrations:", agents.join(", "));
  console.log("");

  if (args.cmd === "setup") {
    if (args.receiver === "none") {
      console.log("Receiver installation disabled via --receiver none.");
      console.log("Run a receiver some other way, then connect the extension with its token.");
      console.log("");
      return;
    }
    if (!args.start) {
      console.log("Receiver start disabled via --no-start.");
      console.log("Start it when ready:");
      console.log("  pnpm dlx agent-annotations start --port 8787");
      console.log("");
      return;
    }

    console.log("Starting receiver in:", targetRepoRoot);
    console.log("(Press Ctrl+C to stop)");
    startReceiver({
      repoRoot: targetRepoRoot,
      port: args.port || process.env.ANNOTATION_PORT || "8787",
      host: args.host || process.env.ANNOTATION_HOST || "0.0.0.0",
      baseUrl: args.baseUrl || process.env.ANNOTATION_BASE_URL || null
    });
    return;
  }

  console.log("Next steps:");
  console.log("  1) Start receiver:");
  console.log("     pnpm dlx agent-annotations start --port 8787");
  console.log("  2) Copy token from .agent-annotations/token.txt into the Chrome extension.");
  console.log("  3) In your agent, invoke: check-agent-annotations");
  console.log("     - Codex: $check-agent-annotations");
  console.log("     - Claude Code: /check-agent-annotations");
  console.log("");
}

main();
