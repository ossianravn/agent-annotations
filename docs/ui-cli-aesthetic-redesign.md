# UI Redesign Plan — “Bright CLI” Aesthetic (Chrome Side Panel)

This document describes the **full** new UI for the `chrome-extension/` side panel before any code changes.

## Inspiration Reference

- `docs/redesign-example-inspiration.md` (brutalist “terminal panel” direction: square borders, stacked icon buttons, `[CONNECTED]` status label).

## Goals

- **CLI aesthetics, but bright**: light background, terminal-like structure, mono typography, crisp 1px rules.
- **No rounded corners** anywhere (including dialogs, buttons, inputs, list rows, attachment cards).
- **No filled “badge pills”**: severity/labels should be *text + border* (or bracketed tags), not colored blobs.
- **Connection settings are not in the main flow**: move receiver URL/token into a dedicated **Settings** dialog/sub-menu.

## Non‑Goals (for this pass)

- No new features (only layout/visual/IA changes).
- No dark theme requirement (can be added later, but light-first is the target).
- No icon overhaul required (SVG can remain, but the visual language should read “terminal UI”).

---

## Visual Language

### Typography

- Primary font: `"Fira Mono"` (preferred).
- Fallback stack (mono-first): `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`.
- **Use mono for everything** (headings, labels, buttons), not only “code” bits.
- Type scale (approx):
  - Base: `13px` (comfortable in a narrow side panel).
  - Section headers: `12px` uppercase (or small caps feel via letter-spacing).
  - Micro/help text: `12px` muted.

Notes on “Fira Mono”:
- Prefer **bundling a local woff2** in the extension (predictable, no network dependency).
- If we don’t bundle immediately, ship with the fallback stack and add Fira Mono later.

### Color (light-first)

Use a “paper + ink + ANSI accents” palette:

- Background: near-white (paper) e.g. `#fbfbf8` (tweakable).
- Text: near-black e.g. `#111827`.
- Muted: `#6b7280` / `rgba(17,24,39,0.55)`.
- Borders/rules: `rgba(17,24,39,0.14)` (always 1px).
- Accent (links/primary affordance): “terminal blue” e.g. `#1d4ed8`.
- Status colors (small amounts only):
  - OK: `#15803d`
  - Warn: `#b45309`
  - Err: `#b91c1c`

### Shapes & Spacing

- Border radius: **0** everywhere.
- Shadows: **none** (no elevation; rely on rules + whitespace).
- Rules: prefer **1px**, but allow **2px** for key dividers (matches the inspiration’s “UI kit” feel).
- Spacing: compact and grid-like:
  - Panel padding: `12px–14px`.
  - Vertical rhythm: `12px` between sections.

### “CLI” Motifs

Section headers and blocks should feel like terminal panes:

- Header prefix glyphs: `◇`, `▸`, `◆` (choose one consistently).
- Optional box-drawing separators using CSS pseudo-elements or simple rules:
  - Example header line: `◇ Selected Element ─────────────────`
- Selection/active states are conveyed by:
  - Inverse highlight (light bg → dark bg strip) **or**
  - Left “cursor bar” (1–2px) like a terminal caret.

---

## Information Architecture (IA)

### High-level layout

1. **Top Bar (Header)**
2. **Main Sections (Scroll)**
3. **Footer (Primary Action)**

Connection status is visible only as a tiny indicator in the header; configuration lives behind Settings.

---

## Detailed Layout Spec

### 1) Top Bar (Header)

Single compact row (always visible, sticky):

- Left: `AGENT ANNOTATIONS` (mono, uppercase, tight tracking).
- Right: two small controls:
  - **Status indicator**: either a tiny LED `●` *or* a bracketed label like `[CONNECTED]` / `[OFFLINE]` (colored ok/warn/err) with tooltip text.
  - **Menu button**: `⋯` (or `⚙`) opens **Settings** dialog.

No server URL in the header. No big “connection bar”.

Optional second line (only when relevant):
- Current page indicator in muted mono, e.g. `URL: /settings?tab=billing` (derived from the active tab URL, not the receiver URL).

### 2) Main Sections (scrollable)

Each section has:
- A **CLI header**: `◇ <NAME>` with a thin rule
- A **content block**: bordered container, square corners

#### Section: `◇ Annotate`

Content:
- One line row:
  - Label: `Annotate mode`
  - Right: toggle switch rendered as CLI-style:
    - Prefer: `[ ON ]` / `[ OFF ]` segmented control
    - Acceptable: existing switch, but restyled square + rule-based
- Subtext (muted): `Click elements on the page to select.`

Error feedback (when content script cannot be injected):
- A brief inline message below the row, in err color:
  - `! Could not enable annotate mode on this page.`

#### Section: `◇ Capture`

Content:
- Three square, outlined buttons in a row (equal width):
  - `Fullscreen`
  - `Element`
  - `Clear`

Buttons are **outline only**; use stacked `icon` over `label` (like the inspiration). Hover uses inverse highlight (no soft fills).

#### Section: `◇ Selected Element`

Content:
- A bordered mono “pane” with 1–3 lines:
  - If none: `None`
  - If selected: show locator summary exactly as today (e.g. `data-testid="..."`, `#id`, css)
- Right-side micro-actions (text buttons):
  - `Change`
  - `Clear` (only visible when a selection exists)

#### Section: `◇ Attachments`

Content:
- Each attachment is a row (not a “card”) with:
  - Left: `IMG` or `FILE` label (2–4 chars) in a small bordered box
  - Middle: filename (mono, truncates)
  - Right: size + `Remove` (as `✕`)
- Clicking image attachment opens the preview dialog (existing behavior).

No thumbnail rounding; no drop shadows.

#### Section: `◇ Comment`

Content:
- Textarea (square, bordered).
- Placeholder: `Write a short note…`
- Help text below: `Tip: paste an image to attach it.`

#### Section: `◇ Severity`

Replace pill badges with bracketed, outline-only options:

- Horizontal options:
  - `[ Bug ]   [ New feature ]   [ Information ]`
- Active option appears as:
  - Inverse highlight **or**
  - Stronger border + a leading marker: `> [ Bug ]`

Color is limited to text/border hints (no filled backgrounds). Optional: include a tiny 8px color square at the left of each option (outline + small “ANSI marker”, matching the inspiration).

#### Section: `◇ Unresolved (this page)`

Header right action:
- `Refresh` (text button)

List items:
- Each row is a bordered, square “pane”:
  - Line 1: `[#<id>]  [BUG|FEATURE|INFO]` (tags are bracketed, outline-only)
  - Line 2: comment preview (truncate to ~2 lines)
- Hover: subtle inverse highlight or caret bar.
- Click opens the Annotation detail dialog.

Empty state:
- `No unresolved annotations for this page.`

### 3) Footer (Primary Action)

Sticky footer with one primary action:

- Button: `SEND ANNOTATION →`
- Style: “terminal selection” look:
  - Default: outline
  - Hover/active: inverse highlight (dark bg strip, light text) or thicker border
- Acceptable variant (matches inspiration): full-width **black-filled** primary with white mono text (still square, no shadow).
- Disabled state:
  - Shows requirement hint just above footer in muted text:
    - `Select an element and write a comment to send.`

---

## Dialogs

Dialogs should also follow the CLI style:

- Square corners, 1px border, no shadows (or extremely minimal).
- Header row:
  - Title left
  - `✕` right
- Body uses key/value rows with mono alignment.

### Settings Dialog (new / repurposed)

Opened from the header menu button.

Sections inside dialog:

1. `Receiver`
   - `Server URL` input
2. `Auth`
   - `Token` input (masked by default)
   - Optional `Show token` checkbox
3. `Diagnostics`
   - `Test connection` button
   - Connection result line:
     - `● Connected` / `● Token missing` / `● Bad token` / `● Not reachable`

Footer actions:
- `Save` (outline)
- `Close` (text)

Important: **Remove the Settings section from the main scroll** (no `<details>` at bottom in the new layout).

### Annotation Detail Dialog

Keep the existing content but render as CLI pane:

- Fields: `ID`, `Locator`, `Comment`, `Attachments`
- Actions:
  - `Copy as prompt`
  - `Resolve`
- Result hint line: `Copied.` / `Marked resolved.` / error message

### Asset Preview Dialog

Keep existing behavior; restyle frame to match (square border).

---

## Connection Status Handling (UI)

Main panel shows only a small indicator:

- Header LED states:
  - OK: green `●`
  - Warn (missing token / unauthorized): amber `●`
  - Err (offline): red `●`

Tooltip / accessible label text reflects:
- `Connected`
- `Token missing`
- `Bad token`
- `Not reachable`

No URL display in main UI; URL is visible only inside Settings.

---

## Copy/Labels (proposed)

Keep copy short and terminal-ish:

- `Annotate mode`
- `Capture`
- `Selected Element`
- `Attachments`
- `Comment`
- `Severity`
- `Unresolved (this page)`
- `Send annotation`

Use uppercase sparingly (header + primary action).

---

## Wireframe (ASCII-ish)

```
AGENT ANNOTATIONS                  [CONNECTED]  ⋯
URL: /settings?tab=billing

◇ Annotate ───────────────────────────────
Annotate mode                         [ ON ]
Click elements on the page to select.

◇ Capture ────────────────────────────────
[ Fullscreen ] [ Element ] [ Clear ]

◇ Selected Element ───────────────────────
data-testid="checkout-button"     Change  ✕

◇ Attachments ────────────────────────────
[IMG] element.png            image/png • 84KB   ✕

◇ Comment ────────────────────────────────
| Write a short note…                     |
Tip: paste an image to attach it.

◇ Severity ───────────────────────────────
> [ Bug ]   [ New feature ]   [ Information ]

◇ Unresolved (this page) ───────── Refresh
[#A12] [BUG]
Button label clips on mobile…

------------------------------------------------
[ SEND ANNOTATION → ]
Select an element and write a comment to send.
```

---

## Implementation Notes (when we start coding)

- Replace “rounded + soft” tokens with rule-based tokens:
  - `--radius: 0`
  - remove shadows
  - replace filled pills/badges with outline tags
- Convert top `conn-bar` into the new header row.
- Replace bottom `<details>` settings block with a **Settings dialog** invoked from header.
- Make the entire UI mono-first (or all-mono) and introduce bundled Fira Mono if desired.
