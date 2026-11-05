# Ideation: desktop-width annotation, offline capture, and a per-project board

Status: ideation, nothing built yet. Written 2026-11-05 after the v0.4.1 review
and the side-panel UI pass. Each section ends with a recommendation and the
questions that need an answer before work starts.

The three ideas share one missing concept, so it comes first.

## 0. The missing concept: a project

Today the extension knows exactly one receiver URL and token, and the receiver
knows exactly one repo. That holds while you work on one thing at a time, but
all three ideas below break it:

- Offline capture needs to know which repo an annotation belongs to while no
  repo is reachable.
- A board needs a stable key that survives port reuse (`localhost:3000` is a
  different app next week) and spans environments (the same app on
  `localhost:3000`, a preview URL and staging).
- Syncing must never push into the wrong repo just because some other
  receiver happens to be listening on `localhost:8787`.

**Proposal.** Introduce a *project*:

| Field | Purpose |
| --- | --- |
| `projectId` | Random ID generated once by the receiver and stored in `.agent-annotations/config.json`. It is the real identity. |
| `name` | Display name, defaulting to the repo folder name. |
| `receiverUrl`, `token` | How to reach the repo when it is running. |
| `urlPatterns` | Which pages belong to it: `http://localhost:3000/*`, `https://staging.example.com/*`, … |

- The receiver reports `projectId` and `name` from `GET /health`. The extension
  stores projects locally and routes each page to a project through
  `urlPatterns`. When several match, the longest match wins.
- Before every sync the extension checks that the receiver at `receiverUrl`
  reports the expected `projectId`. If it doesn't, it stops and says which repo
  is actually running there.
- The key for the board (question 3) is therefore the **repo** (`projectId`),
  not the domain. Domains and ports are only routing hints.

## 1. Annotating the page at its real width

### The problem

Chrome's side panel takes its width from the page. With a 400px panel on a
1440px window the page's CSS viewport becomes 1040px. Media and container
queries fire, so you annotate a tablet-like layout that normal visitors never
see. Locators, rectangles and screenshots then describe that layout too.

### Options

| Option | How it works | Gains | Costs |
| --- | --- | --- | --- |
| **A. Zoom compensation** (keep the panel) | While the panel is open, set the tab's zoom so its CSS viewport is as wide as it was without the panel: `zoom = pageWidth / (pageWidth + panelWidth)`. For example, 1040 / 1440 gives 72%. Use `chrome.tabs.setZoomSettings(tabId, { scope: "per-tab" })` so other tabs on the same site are untouched, and `chrome.tabs.setZoom`. | True desktop layout. Small change. Fully reversible. Screenshots and crops keep working, because the crop already scales from CSS to image pixels. | Text is smaller (about 70–80% on common setups). Per-tab zoom resets on navigation, so it must be reapplied from `tabs.onUpdated`. Zoom must be restored when the panel closes: the panel holds a `runtime.connect` port and the service worker restores zoom on disconnect. Newer Chrome versions also add side-panel open/close events. `devicePixelRatio` changes, which can affect `resolution` media queries and canvas-heavy pages. |
| **B. Floating in-page panel** | The content script mounts an extension page (`chrome-extension://…/panel.html`) in an iframe inside a closed shadow root, using the `popover` top layer so page dialogs can't cover it. It can be dragged, docked to a corner, and collapsed to a small pill. | The page keeps its full width and normal zoom. It works with any window size. | It covers part of the page (collapsing helps). More engineering: drag/dock behaviour, focus handling, keyboard shortcuts, and coexisting with page styles. Some sites' CSP may block extension iframes; that needs verifying. It also needs access to every page you annotate, which is already true while annotating. |
| C. Detached window | `chrome.windows.create({ type: "popup" })` beside the browser. | The page is untouched. Good with a second monitor. | Window juggling. On a laptop screen it covers the page anyway. |
| D. DevTools panel | A DevTools tab. | Familiar for developers. | Docked DevTools shrink the viewport the same way, and it's heavy for annotating. |
| E. Emulate via the debugger API | `Emulation.setDeviceMetricsOverride` | Exact control. | Chrome shows a persistent "started debugging this browser" banner, and it needs the `debugger` permission. Not acceptable. |

### Do this regardless of the option

Record the layout context on every annotation: CSS viewport width and height,
zoom, `devicePixelRatio`, and the matched breakpoint if one can be detected.
The agent then knows which layout the comment is about. Show it in the panel
too, for example `Page 1440px · zoom 72%`, so it is never a surprise.

### Recommendation

1. Ship **A as an opt-in switch** in the panel header ("Desktop width"),
   remembered per project, together with the layout metadata. It is cheap,
   and it shows whether the smaller text is acceptable in real use.
2. If it isn't, build **B** as the main surface and keep the side panel for
   people who prefer it. Most panel modules (composer, list, dialogs) can be
   reused inside the iframe.

### Questions

- Is 70–80% text size acceptable while annotating, or is it a deal-breaker?
- When the panel closes, should zoom always return to what it was before, or
  stay where you left it?

## 2. Capture while the repo is offline, sync when it's back

### Today

Unsent work is kept as a draft in IndexedDB, per tab and route. Saving needs a
running receiver, and a failed save leaves the draft in the composer.

### Proposal: local-first with an outbox

- **Every save writes locally first.** An annotation gets a client-generated ID
  (ULID-style, which the receiver already accepts after this week's ID
  validation). It is stored in IndexedDB with its attachments as `Blob`s rather
  than base64 strings: about a quarter smaller, and cheap to update.
- **Every queued item has an explicit state:** `local` (waiting) → `syncing` →
  `synced`, or `failed` with a reason and a Retry action. The panel shows the
  state on the card, plus a count such as "2 waiting to sync" in the footer.
- **The service worker syncs, not the panel**, so it works with the panel
  closed. It runs when the panel opens, when a receiver health check succeeds,
  on a `chrome.alarms` timer (30s minimum, backing off while offline), and on
  the browser's `online` event.
- **Writes must be idempotent.** The receiver treats a repeated `POST` with the
  same ID and the same content hash as success instead of answering 409. Edits
  and resolves are queued as operations (`update comment`, `move status`)
  carrying the revision they were based on.
- **Conflicts.** The agent may resolve or edit a card on disk while you were
  offline. Fields are merged last-writer-wins, except the description: if both
  sides changed it, both versions are kept and the card is flagged for you.
  An edit to a card that has since been resolved becomes a visible
  "Resolved while you were offline" note, not a silent failure.
- **Routing and safety.** Queued items carry their `projectId`. They sync only
  to a receiver that reports the same `projectId` (see section 0). Pages that
  match no project are saved to an "Unassigned" bucket, and you pick the
  project once.
- **Storage limits.** Warn when the outbox passes, say, 200 MB, and consider the
  optional `unlimitedStorage` permission. Attachments are the only large part.

### Questions

- Should captures without a project (a random website) be allowed at all, or
  must every page belong to a project?
- Is the "Unassigned" bucket enough, or should the extension offer to create a
  project from the current page?

## 3. A per-project kanban board for human → agent work

### What it's for

A place to dump ideas and tasks per project, with everything an annotation has
today (page, element, screenshots), where the status makes the handoff between
you and the agent explicit. An annotation becomes one kind of *card*: a card
captured from a page, as opposed to a free-standing idea or task.

### Where the data lives

**The repo, as the source of truth, one folder per card:**

```
.agent-annotations/
  config.json                 # projectId, name, receiverBaseUrl
  cards/
    01JC7Z…/
      card.md                 # YAML front matter + Markdown description
      assets/screenshot.png
```

Front matter example:

```yaml
id: 01JC7ZQ4…
title: Checkout button submits a stale total
status: ready            # see the workflow below
type: bug                # bug | feature | request | idea | chore
priority: p2             # optional
labels: [checkout]
rank: "0|hzzzzz:"        # sortable string order within the column (LexoRank-style)
page: { url, routeKey, viewport: { width: 1440, zoom: 0.72 } }
element: { primary, alternates, textHint }
acceptance:
  - [ ] Button is disabled while the total recalculates
claimedBy: null          # agent/session name while in progress
links: []                # commits, PRs
createdAt / updatedAt / createdBy
```

Why this shape:

- Agents read Markdown natively, and a card is reviewable as a diff.
- One folder per card means no shared file for two writers to clobber, unlike
  rewriting `inbox.jsonl` today.
- Status lives in the front matter, not the folder, so attachments never move
  (which removes the rename/rollback logic resolve needs today).
- The extension keeps a replica for offline use (section 2). The receiver
  watches the folder and pushes changes to open panels through Server-Sent
  Events, so the board updates live while an agent works.

Committing cards to git should be opt-in per project. It is useful for teams,
but noisy for solo work. Assets stay ignored by default.

### Workflow and statuses

| Status | Meaning | Who moves it here |
| --- | --- | --- |
| **Draft** | Captured, not yet specified. Agents ignore it. | You (the default for quick ideas) |
| **Ready for agent** | Specified enough to act on. Agents pull from the top. | You |
| **In progress** | Claimed by an agent, with `claimedBy` and `claimedAt` set. | Agent (atomic claim) |
| **Needs input** | The agent has a question; it is shown on the card. | Agent |
| **In review** | The agent says it's done, with a summary and links attached. | Agent |
| **Done** | You verified it. | You |
| **Won't do** | Dropped, with a reason. | You |

Rules that keep the flow honest. These follow ordinary kanban practice: pull,
explicit policies, and limited work in progress.

- **Definition of ready.** Moving a card to Ready asks for a title, a
  description, and for bugs, expected vs actual behaviour. It warns rather
  than blocks.
- **Pull, don't push.** Agents take the highest-ranked Ready card and claim it
  atomically. Two agents can never hold the same card.
- **Limit work in progress.** For example, at most two cards In progress per
  agent. The board shows the limit on the column.
- **Definition of done.** Moving a card to In review requires the agent to
  write a summary of the change and tick (or explain) each acceptance item.
- **Review in the browser.** Opening a card that is In review offers "Show on
  page": the extension opens its URL and highlights its element, so verifying
  takes one click. Reject sends the card back to Ready with your comment.
- **Blocked is a flag, not a column.** A card waiting on something outside the
  agent's and your control keeps its column and gets a blocked flag with a
  reason. Needs input is different: it is a handoff to you, so it's a column.

Mapping today's data: `open` becomes **Ready for agent** (today every saved
annotation is immediately visible to the agent), and `resolved` becomes
**Done**. The composer gets a choice: *Save as draft* or *Send to agent*.

### How agents work with it

Give agents a CLI instead of `curl` with tokens:

```bash
npx agent-annotations cards list --status ready
npx agent-annotations cards claim <id>
npx agent-annotations cards comment <id> "Found the race in useCartTotal"
npx agent-annotations cards move <id> review --summary "…" --link <commit>
```

The CLI talks to the receiver when it's running, so claims are atomic. When it
isn't, the CLI edits the files directly, protected by a lock file. The
`check-agent-annotations` skill is rewritten around this loop: list Ready,
claim, work, comment, move to In review or Needs input.

### Where the board UI lives

- **Board page:** a full extension page (`board.html`) opened in a normal tab,
  with columns, drag and drop, filters (type, label, page), and a card detail
  view. It already has the token and the offline replica, so no extra auth is
  needed.
- **Side panel:** stays focused on the current page. Its Open tab becomes
  "Cards on this page", grouped by status, with an "Open board" link.
- **Capture paths:** from the panel (element + screenshot, as today); on the
  board, a "New card" with no page (for ideas); pasting or dragging images onto
  any card.

### Questions

- Statuses: does the list above match how you work, or should Needs input and
  In review merge into one "Waiting on you" column?
- Should new cards from the panel default to **Draft** or **Ready for agent**?
- Should Done cards be archived after N days, or kept on the board?
- Is there ever more than one agent per project? That decides whether claims
  and WIP limits are needed in the first version.
- Do you want an export path to an external tracker (GitHub Issues, Trello,
  Linear) later? It doesn't change the design now, but the IDs and fields
  above are chosen to map cleanly.

## Suggested order of work

1. **Layout metadata, plus the zoom-compensation switch.** Small, and it
   answers the readability question with real use.
2. **Projects.** `projectId` in the receiver, a project list in Settings, and
   URL routing. Everything else depends on it.
3. **Local-first outbox and sync** for today's annotations. This proves the
   sync model on the simple case.
4. **Card model in the repo, with the migration** from `inbox.jsonl`, plus the
   agent CLI and the new skill.
5. **Board page**, then live updates over Server-Sent Events.
6. **Floating in-page panel**, if zoom compensation proves too small to read.

Each step ships on its own and keeps the current extension working.
