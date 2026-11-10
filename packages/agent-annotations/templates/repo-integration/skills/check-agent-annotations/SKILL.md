---
name: check-agent-annotations
description: Work through the UI cards a human left for agents in .agent-annotations/cards (page, element locators, screenshots, comment). Use when asked to check annotations, work the board or queue, or pick up the next UI task.
---

# check-agent-annotations

The human captures UI problems and ideas in the browser. Each one is a card:
`.agent-annotations/cards/<id>/card.md` holds JSON front matter followed by the
human's comment as Markdown, and `cards/<id>/assets/` holds its screenshots.

Change cards only through the cards tool. It takes a lock, so two agents can
never claim the same card:

```bash
node .tools/agent-annotations-cards.cjs <command> --agent <your-name>
```

Use one stable `--agent` name for the whole session (for example `codex` or
`claude`). If `.tools/agent-annotations-cards.cjs` is missing, run
`pnpm dlx agent-annotations cards <command>` instead.

## Statuses

| Status | Meaning | Moved by |
| --- | --- | --- |
| `draft` | The human is still writing it. Never work on drafts. | human |
| `ready` | Ready for an agent. Agents pull from the top. | human |
| `in_progress` | Claimed by one agent (`claimedBy`). | you, with `next` or `claim` |
| `waiting` | Handed back: `waitingReason` is `review` (you finished) or `question` (you need an answer). | you, with `handback` |
| `done`, `wont_do` | Closed by the human. Don't reopen them. | human |

## The loop

1. Claim the top card: `next --agent <name>`. It prints the card. "No cards are
   ready for an agent" means stop. You can hold 2 cards at once
   (`wipLimitPerAgent` in `.agent-annotations/config.json`).
2. Read all of it: the comment, the "Done when" acceptance criteria, the page
   URL, the element locators, `layout` (the viewport width the comment is
   about, which decides the breakpoint), earlier `activity`, and the
   screenshots listed as attachments.
3. Find the code (see Locators below), make the change, and check it.
4. Leave notes while you work: `comment <id> "Found the race in useCartTotal"`.
   Notes also show the human you are still on the card.
5. Hand it back, then take the next card:
   - Finished: first tick each acceptance criterion you met with
     `check <id> <number>` (numbers as `show` prints them), then
     `handback <id> --review "What changed and how to check it" --link <commit or PR>`.
     In the summary, say why any criterion is still unticked.
   - Blocked: `handback <id> --question "One concrete question"`. Don't guess
     at product decisions.

Never mark cards `done`: the human checks the result in the browser first.

## Locators

Given `element.primary`:
- `testid`: search the repo for the value (for example `data-testid="..."`).
- `id`: search for `id="..."`.
- otherwise: use `textHint`, `role` and the alternate locators to narrow down
  the component, and the page URL to find the route.

## Browser validation (only if the user asks)

Only validate in a browser if the user explicitly asks. If a browser tool is
available (browser skill, MCP tool, Playwright), open the card's URL at its
`layout.viewportWidth`, find the element by `data-testid`, role or text, and
capture before and after screenshots. Otherwise, give manual steps.

## Other commands

- `list [--status ready|active|all|<status>]`: list cards (default: not finished).
- `show <id>`: print one card with its notes and attachment paths.
- `claim <id>`: claim a specific Ready card.
- `check <id> <number> [--undo]`: tick (or untick) an acceptance criterion.
- `move <id> <status>`: only when the human asks you to.
- `archive <id>`: hide a finished card.

Add `--json` to any command for machine-readable output.

## Reference

See `references/ANNOTATIONS_SCHEMA.md` for every card field.
