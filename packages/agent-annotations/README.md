# agent-annotations

Init scaffold for Agent Annotations.

## Usage

```bash
pnpm dlx agent-annotations setup
```

This installs repo integration + skill/instructions and starts the receiver (writes `.agent-annotations/` into the repo).

To install templates only (no receiver), run:
```bash
pnpm dlx agent-annotations init
```

To start the receiver after setup:
```bash
pnpm dlx agent-annotations start
```

### Common options

- `--agent auto|codex|claude|gemini|antigravity|opencode|copilot|all`
- `--skill repo|user|none`
- `--receiver repo|none`
- `--force`
 - `--port 8787`
 - `--host 0.0.0.0`
 - `--repo /path/to/repo`

## Repo

This package is maintained in the `ossianravn/agent-annotations` repository.
