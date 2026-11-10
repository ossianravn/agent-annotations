# Card schema (Agent Annotations)

Each card is a folder under `.agent-annotations/cards/`:

```
.agent-annotations/cards/<id>/
  card.md        JSON front matter between --- lines, then the comment as Markdown
  assets/        screenshots and other attachments
```

The front matter is JSON, not YAML, so the receiver can stay a single
dependency-free file. Change cards with `node .tools/agent-annotations-cards.cjs`
rather than by hand: the tool takes the lock that keeps claims atomic.

## Example

```
---
{
  "id": "ann_2026-11-10T12-00-00-000Z_deadbeef",
  "title": "Checkout button stays enabled while the total recalculates",
  "status": "waiting",
  "waitingReason": "review",
  "severity": "bug",
  "tags": ["checkout"],
  "rank": "2026-11-10T12:00:00.000Z",
  "createdAt": "2026-11-10T12:00:00.000Z",
  "updatedAt": "2026-11-10T13:10:00.000Z",
  "url": "http://localhost:3000/cart",
  "routeKey": "http://localhost:3000/cart",
  "element": {
    "primary": { "type": "testid", "value": "checkout-action" },
    "alternates": [{ "type": "role", "value": "button", "nameHint": "Continue to checkout" }],
    "textHint": "Continue to checkout",
    "attrs": { "id": null, "class": "btn btn-primary", "name": null, "href": null }
  },
  "rect": { "x": 812, "y": 422, "w": 96, "h": 36, "dpr": 1 },
  "layout": { "viewportWidth": 1440, "viewportHeight": 900, "devicePixelRatio": 0.72, "zoom": 0.72, "desktopWidth": true },
  "attachments": [
    { "kind": "asset", "mime": "image/png", "path": ".agent-annotations/cards/ann_2026-11-10T12-00-00-000Z_deadbeef/assets/0_screenshot.png" }
  ],
  "activity": [
    { "at": "2026-11-10T13:10:00.000Z", "author": "codex", "kind": "review", "text": "Disabled the button while the total recalculates." }
  ],
  "links": ["a1b2c3d"],
  "lastAgent": "codex"
}
---

The total jumps after the coupon applies; the button should wait for the final amount.
```

## Fields

- `status`: `draft`, `ready`, `in_progress`, `waiting`, `done` or `wont_do`.
  `waitingReason` (`question` or `review`) is set only while `waiting`.
- `claimedBy`, `claimedAt`, `heartbeatAt`: set only while `in_progress`.
  Notes from the claiming agent refresh `heartbeatAt`.
- `rank`: sort order within Ready; agents take the lowest rank first.
- `severity`: `bug`, `feature` or `info` (a request).
- `routeKey` is `origin + pathname` (no query or hash).
- `rect` is viewport-relative in CSS pixels; `dpr` is devicePixelRatio at capture time.
- `layout` says which layout the comment is about: `viewportWidth` is the CSS
  viewport width that media queries saw, and `zoom` is the page zoom.
  `desktopWidth: true` means the page was zoomed out so it kept its full width
  beside the extension panel. Older cards may have no `layout`.
- `activity`: notes, questions (`kind: "question"`) and review summaries
  (`kind: "review"`), oldest first.
- `links`: commits or PRs attached when a card is handed back.
- `archivedAt`: set when a finished card is archived; archived cards are hidden.
- `clientHash` is set by the extension so the receiver can recognise a retried
  send of the same card. Agents can ignore it.
- Attachment `path`s are repo-relative and always use `/`.

## Migration from 0.4

Before 0.5, annotations lived in `inbox.jsonl` and `inbox-resolved.jsonl`. The
receiver (or the cards tool) moves them into card folders once: open records
become `ready`, resolved ones `done`. The old files are kept as `*.migrated`.
