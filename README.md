# Agent Annotations

A Chrome side-panel extension for annotating UI elements on pages (often `localhost`), plus a lightweight local receiver that writes an agent-friendly inbox into your repo.

## Quick start

1. Install the extension (recommended: download the zip from GitHub Releases → unzip → load unpacked)
2. Start the receiver:
   ```bash
   pnpm dlx agent-annotations-receiver --port 8787
   ```
3. Copy the printed token into the extension’s connection settings
4. (Optional) Install repo integration:
   ```bash
   pnpm dlx agent-annotations init
   ```

This kit includes:
- **Chrome extension** (load unpacked)
- **Repo integration** (`.tools` receiver launcher + example snippets)
- **Published npm packages**:
  - `agent-annotations-receiver` (CLI receiver)
  - `agent-annotations` (init scaffold for repos)

---

## 1) Install the extension (Chrome/Chromium: Windows/macOS/Linux)

Requires a Chromium browser with the Extensions Side Panel API (Chrome/Edge/Brave, etc.).

### Option A: Download the extension zip (recommended)

1. Download the latest release asset from GitHub Releases:
   - https://github.com/ossianravn/agent-annotations/releases/latest
2. Unzip it
3. Open `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked**
6. Select the unzipped folder (it contains `manifest.json`)

### Option B: Load unpacked from this repo

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select: `chrome-extension/`

Click the extension icon → the side panel opens.

Shortcut to toggle annotation mode:
- Windows/Linux: `Ctrl+Shift+Y`
- macOS: `Command+Shift+Y`

---

## 2) Run the receiver

### Option A: `pnpm dlx` (recommended)
```bash
pnpm dlx agent-annotations-receiver --port 8787
```

### Option B: in-repo script
After you run `pnpm dlx agent-annotations init` (or otherwise copy the `.tools/` files) in the target repo, run from the repo root:
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
- In most repos you’ll want to ignore `.agent-annotations/`; copy `.gitignore.snippet` into your repo’s `.gitignore`.
