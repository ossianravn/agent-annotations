# agent-annotations

Init scaffold for Agent Annotations.

## Usage

```bash
pnpm dlx agent-annotations@latest setup
```

This installs repo integration + skill/instructions and starts the receiver (writes `.agent-annotations/` into the repo).

## Updating an existing installation

`setup` preserves existing integration files unless `--force` is supplied.
After stopping the receiver, update the extension and refresh each connected
repo from its root:

```bash
pnpm dlx agent-annotations@latest setup --force
```

This updates the managed integration files and starts the receiver again. To
leave customized agent skills or instructions untouched, add `--skill none`.

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
- `--force` (required when updating an existing repo integration)
- `--port 8787`
- `--host 0.0.0.0`
- `--repo /path/to/repo`

## Repo

This package is maintained in the `ossianravn/agent-annotations` repository.
