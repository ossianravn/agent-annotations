# Annotations schema (Agent Annotations)

Annotations are stored under `.agent-annotations/`.

Open:
- `.agent-annotations/inbox.jsonl`
- `.agent-annotations/assets/open/`

Resolved archive:
- `.agent-annotations/inbox-resolved.jsonl`
- `.agent-annotations/assets/resolved/`

## Minimal record

```json
{
  "id": "ann_2026-02-01T12-34-56Z_deadbeef",
  "createdAt": "2026-02-01T12:34:56.000Z",
  "url": "http://localhost:3000/library",
  "routeKey": "http://localhost:3000/library",
  "status": "open",
  "severity": "info",
  "tags": ["ui", "copy"],

  "element": {
    "primary": { "type": "testid", "value": "save-button" },
    "alternates": [
      { "type": "role", "value": "button", "nameHint": "Save" },
      { "type": "css", "value": "button[data-testid=\"save-button\"]" }
    ],
    "textHint": "Save",
    "attrs": { "id": null, "class": "btn btn-primary", "name": null, "href": null }
  },

  "rect": { "x": 812, "y": 422, "w": 96, "h": 36, "dpr": 1 },
  "layout": { "viewportWidth": 1440, "viewportHeight": 900, "devicePixelRatio": 0.72, "zoom": 0.72, "desktopWidth": true },

  "comment": "Make this button disabled until form is dirty.",

  "attachments": [
    { "kind": "asset", "mime": "image/png", "path": ".agent-annotations/assets/open/ann_..._0_screenshot.png" }
  ]
}
```

## Notes
- `routeKey` is `origin + pathname` (query/hash removed).
- `rect` is viewport-relative in CSS pixels; `dpr` is devicePixelRatio at capture time.
- `layout` says which layout the comment is about: `viewportWidth` is the CSS viewport width that media queries saw, and `zoom` is the page zoom. `desktopWidth: true` means the page was zoomed out so it kept its full width beside the extension panel. Older records have no `layout`.
- `clientHash` is set by the extension so the receiver can recognise a retried send of the same annotation. Agents can ignore it.
- Attachments are stored as files and referenced via repo-relative `path`.
