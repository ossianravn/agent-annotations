---
name: check-agent-annotations
description: Read .agent-annotations (open inbox + assets) and turn UI annotations into an actionable plan. Optional browser validation only when requested.
---

# check-agent-annotations

## What this skill does
- Reads the open annotation inbox: `.agent-annotations/inbox.jsonl`
- Optionally reads the resolved archive: `.agent-annotations/inbox-resolved.jsonl`
- Summarizes annotations (route, locator hints, comment, attachments)
- Produces an actionable plan (what to search, where to edit, how to validate)

## Where annotations live
Open (active):
- `.agent-annotations/inbox.jsonl`
- `.agent-annotations/assets/open/`

Resolved (archive):
- `.agent-annotations/inbox-resolved.jsonl`
- `.agent-annotations/assets/resolved/`

If files don’t exist, treat as “no annotations yet”.

## How to use locators
Given `element.primary`:
- `testid`: search repo for the value (e.g. `data-testid="..."`)
- `id`: search for `id="..."`
- otherwise: use `textHint`, `role`, and alternate locators to narrow down components/files

## Browser validation (only if user asks)
Only do browser validation if the user explicitly requests it.
If a browser automation tool is available (browser skill, MCP tool, Playwright, etc.), you may:
- open the annotated URL
- locate the element using `data-testid` / role / text hints
- capture before/after screenshots
Otherwise, provide manual validation steps.

## Marking items resolved
Preferred method (if the receiver is running):

1) Read config (optional) and token:
- `.agent-annotations/config.json` contains `receiverBaseUrl` (defaults to `http://localhost:8787`)
- `.agent-annotations/token.txt` contains the token

2) POST status update:

```bash
BASE_URL="$(node -p "try{require('./.agent-annotations/config.json').receiverBaseUrl}catch(e){'http://localhost:8787'}")"
TOKEN="$(cat .agent-annotations/token.txt)"
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Annotation-Token: $TOKEN" \
  -d '{"status":"resolved"}' \
  "$BASE_URL/annotations/<ID>/status"
```

Fallback (if receiver is not running):
- move the record from `inbox.jsonl` to `inbox-resolved.jsonl` and set `status` to `"resolved"`.

## Reference
See `references/ANNOTATIONS_SCHEMA.md`.
