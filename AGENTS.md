# Repository Guidelines

A Chrome side-panel extension for annotating UI elements on pages (often `localhost`), plus a lightweight local receiver that writes an agent-friendly inbox into your repo.

## Project Structure & Module Organization

- `chrome-extension/`: Chrome side-panel extension source (`manifest.json`, `sidepanel.*`, `service_worker.js`, `content_script.js`).
- `packages/agent-annotations/`: Node.js CLI that scaffolds/installs repo integration (`agent-annotations`).
- `packages/agent-annotations-receiver/`: Node.js CLI receiver that writes `.agent-annotations/` into a target repo (`agent-annotations-receiver`).
- `repo-integration/`: Template files copied into target repos (e.g. `.tools/` receiver launcher and `skills/`).
- `scripts/`: Release/packaging utilities (Python).
- `docs/`: Documentation assets (screenshots).
- `dist/`: Built release artifacts (ignored by git).

## Build, Test, and Development Commands

Prereqs: Node.js `>=18`, `pnpm` (see `package.json` `packageManager`), and Python 3 for extension packaging.

- `pnpm package:extension`: Builds `dist/agent-annotations-chrome-extension-v<version>.zip` via `scripts/package-extension-zip.py`.
- `pnpm pack:agent-annotations`: Creates a tarball for the scaffold CLI (`packages/agent-annotations`).
- `pnpm pack:receiver`: Creates a tarball for the receiver CLI (`packages/agent-annotations-receiver`).
- Local CLI runs (no publish required):
  - `node packages/agent-annotations/bin/agent-annotations.js --help`
  - `node packages/agent-annotations-receiver/bin/agent-annotations-receiver.js --port 8787`

## Coding Style & Naming Conventions

- JavaScript is plain Node/Chrome JS (CommonJS in `packages/*`), 2-space indentation, double quotes, and semicolons—match surrounding files.
- Keep diffs focused; there’s no repo-wide formatter/linter config, so avoid drive-by reformatting.

## Testing Guidelines

- No automated test suite is currently wired up. For changes, include a short manual test plan in the PR:
  - Extension: load `chrome-extension/` via `chrome://extensions` → “Load unpacked” and verify side panel flows.
  - Receiver: start the receiver and confirm it writes/updates `.agent-annotations/` in a sample repo.

## Commit & Pull Request Guidelines

- Commit subjects are short and imperative; common prefixes include `Extension:`, `Docs:`, `Fix:`, and `Bump version to X.Y.Z`.
- PRs should include: what changed, how to test, and screenshots/GIFs for extension UI changes.
- Releases: keep versions aligned across `chrome-extension/manifest.json` and `packages/*/package.json`; tagging `vX.Y.Z` triggers the extension zip release workflow.

## Security & Repo Hygiene

- Do not commit `.agent-annotations/` (contains tokens/inbox); it is intentionally gitignored.
