# Agent Annotations

A Chrome side-panel extension for annotating UI elements on pages (often `localhost`), plus a lightweight local receiver that writes an agent-friendly inbox into your repo.

This kit includes:
- **Chrome extension** (load unpacked)
- **Repo integration** (`.tools` receiver launcher + example snippets)
- **NPM package skeletons** for:
  - `agent-annotations-receiver` (CLI receiver)
  - `agent-annotations` (init scaffold for repos)

---

## 1) Install the Chrome extension (Windows)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select: `chrome-extension/`

Click the extension icon → the side panel opens.

---

## 2) Run the receiver

### Option A: `pnpm dlx` (recommended after you publish)
```bash
pnpm dlx agent-annotations-receiver --port 8787
```

### Option B: in-repo script
From your repo root:
```bash
node .tools/agent-annotations-receiver.js --port 8787
```

On first run it:
- prints a token
- writes `.agent-annotations/token.txt`
- writes `.agent-annotations/config.json` with the receiver base URL

Paste the token into the extension’s connection settings.

---

## 3) Install into a repo (init scaffold)

After you publish `agent-annotations`, users can do:

```bash
pnpm dlx agent-annotations init
```

### Options
- `--agent auto|codex|claude|gemini|antigravity|opencode|copilot|all`
  - `auto` detects common agent config folders and falls back to `codex`
- `--skill repo|user|none` (default: `repo`)
- `--receiver repo|none` (default: `repo`)
- `--force` overwrite existing files

### Examples

Install Codex skill into the repo:
```bash
pnpm dlx agent-annotations init --agent codex --skill repo
```

Install Claude Code skill globally:
```bash
pnpm dlx agent-annotations init --agent claude --skill user
```

Skip adding receiver files (you’ll run the receiver some other way):
```bash
pnpm dlx agent-annotations init --receiver none
```

Install everything (useful for open-source repos that want to support multiple agents):
```bash
pnpm dlx agent-annotations init --agent all --skill repo
```

Copilot note:
- Copilot does not use `SKILL.md`. The scaffold will create/update:
  - `.github/copilot-instructions.md`

---

## 4) Where data goes

Open (active):
- `.agent-annotations/inbox.jsonl`
- `.agent-annotations/assets/open/`

Resolved (archive):
- `.agent-annotations/inbox-resolved.jsonl`
- `.agent-annotations/assets/resolved/`

---

## 5) Using it with agents

### Skills-based agents (Codex, Claude Code, Gemini CLI, Antigravity, OpenCode)
If you installed the skill, invoke it by name: `check-agent-annotations`.

Examples:
- **Codex**: `$check-agent-annotations`
- **Claude Code**: `/check-agent-annotations`

### Any agent (manual)
Agents can simply read `.agent-annotations/inbox.jsonl` and act on it.

Browser validation should only happen if the **user explicitly asks**, and only using tools available in that agent environment (browser skill, MCP tool, Playwright, etc.).

---

## Repo hygiene

- `.tools/` is intentionally a **process tool** folder.
- Use `.gitignore.snippet` if you want to keep assets or inbox files out of git.
