# agent-annotations-receiver

Local receiver for Agent Annotations (writes `.agent-annotations/` inbox + assets).

## Usage

```bash
pnpm dlx agent-annotations-receiver --port 8787
```

## Extension API

The Chrome extension uses these receiver endpoints for saved annotations:

- `GET /health` reports `projectId` and `name`, which identify the repo. The
  ID is generated once and kept in `.agent-annotations/config.json`; the
  extension uses it to make sure a page's annotations go to the right repo.

- `GET /annotations?status=open&routeKey=…&limit=50` lists annotations.
- `PATCH /annotations/:id` with `{ "comment": "…" }` edits an unresolved
  annotation comment and records `updatedAt`.
- `GET /annotations/:id/attachments/:index` returns the stored attachment
  bytes for thumbnail and full-image previews.

Every endpoint except `GET /health` requires the receiver token in
`X-Annotation-Token`, including the list, so other web pages cannot read the
inbox. Extension 0.4.1 and earlier do not send the token when listing and need
updating alongside the receiver. Attachment
responses are restricted to files inside `.agent-annotations/assets/open/` or
`.agent-annotations/assets/resolved/`, disable caching, and use their recorded
MIME type.

`POST /annotations` accepts attachment content as either a base64 data URL in
`dataUrl` or raw base64 in `dataBase64`, up to 32 MiB per request. A
client-supplied `annotation.id` may only contain letters, digits, `.`, `_` and
`-`, and must not already exist; leave it empty to have the receiver generate
one. Resolving an annotation validates all
attachment moves before changing any files and rolls back completed moves if a
later rename fails, so the open inbox cannot be left pointing at partially
moved attachments.

Restart a running receiver after upgrading so the new endpoints are available.

## Repo

This package is maintained in the `ossianravn/agent-annotations` repository.
