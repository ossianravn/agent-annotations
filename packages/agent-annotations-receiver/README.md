# agent-annotations-receiver

Local receiver for Agent Annotations. It stores each annotation as a card in
`.agent-annotations/cards/<id>/` (`card.md` plus `assets/`).

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
cards. Extension 0.4.1 and earlier do not send the token when listing and need
updating alongside the receiver. Attachment responses are restricted to files
inside a card's `assets/` folder, disable caching, and use their recorded MIME
type.

`POST /annotations` creates a card. Attachments come as a base64 data URL in
`dataUrl` or raw base64 in `dataBase64`, up to 32 MiB per request. `status` may
be `draft` or `ready` (older clients' `open` means `ready`). A client-supplied
`annotation.id` may only contain letters, digits, `.`, `_` and `-`, and must not
already exist; leave it empty to have the receiver generate one. A repeated
`POST` with the same `id` and `clientHash` (the extension's retries) returns the
stored card with `"duplicate": true` instead of a 409.

`GET /annotations?status=open` lists unfinished cards; `status` can also be
`all`, `done` (or `resolved`) or any single status. `PATCH /annotations/:id`
accepts `comment`, `status` (with `waitingReason` for `waiting`) and `archived`.
`POST /annotations/:id/comments` with `{ "author", "text" }` adds a note.

Cards are written through a lock file shared with the agent CLI
(`agent-annotations-cards.cjs`), so claims stay atomic whether or not the
receiver is running. On start, the receiver moves a 0.4 `inbox.jsonl` and
`inbox-resolved.jsonl` into card folders and keeps the old files as
`*.migrated`. `config.json` holds `wipLimitPerAgent` (default 2).

Restart a running receiver after upgrading so the new endpoints are available.

## Repo

This package is maintained in the `ossianravn/agent-annotations` repository.
