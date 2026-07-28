# agent-annotations-receiver

Local receiver for Agent Annotations (writes `.agent-annotations/` inbox + assets).

## Usage

```bash
pnpm dlx agent-annotations-receiver --port 8787
```

## Extension API

The Chrome extension uses these receiver endpoints for saved annotations:

- `PATCH /annotations/:id` with `{ "comment": "…" }` edits an unresolved
  annotation comment and records `updatedAt`.
- `GET /annotations/:id/attachments/:index` returns the stored attachment
  bytes for thumbnail and full-image previews.

Both endpoints require the receiver token in `X-Annotation-Token`. Attachment
responses are restricted to files inside `.agent-annotations/assets/open/` or
`.agent-annotations/assets/resolved/`, disable caching, and use their recorded
MIME type.

`POST /annotations` accepts attachment content as either a base64 data URL in
`dataUrl` or raw base64 in `dataBase64`. Resolving an annotation validates all
attachment moves before changing any files and rolls back completed moves if a
later rename fails, so the open inbox cannot be left pointing at partially
moved attachments.

Restart a running receiver after upgrading so the new endpoints are available.

## Repo

This package is maintained in the `ossianravn/agent-annotations` repository.
