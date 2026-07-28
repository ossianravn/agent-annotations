# Chrome Extension Standards Audit — July 2026

## Purpose

This document records the standards audit of `chrome-extension/` and the
remediation plan. It is the durable checklist for the modernization work that
started after release `v0.3.11`.

## Current status

The modernization work is complete for the extension's documented scope:
top-level pages in Chrome 116 or newer. There are no open P0 or P1 audit
findings. The remaining items are explicit product-scope decisions, not hidden
release blockers.

This remediation is versioned as `v0.4.0`. The repository release workflow
builds the extension assets and publishes both npm packages from that tag.

## Audit basis

- Modern Web Guidance skill version `2026_05_16-c5e78707`
- Current Web Interface Guidelines
- Chrome Manifest V3, Side Panel, Scripting, `activeTab`, storage, and extension
  service-worker guidance
- axe-core `4.12.1`
- `html-validate` and CSS Tree validation
- Browser accessibility-tree inspection
- Repository engineering rules in `AGENTS.md`

## Severity

- Checked findings are remediated; unchecked findings remain follow-up work.
- **P0**: security, privacy, or correctness issue to resolve before adding more
  extension behavior
- **P1**: accessibility, reliability, or maintainability issue expected from a
  mature product
- **P2**: standards, resilience, and product-quality follow-up

## Findings

### Manifest and permission model

- [x] **P0 — Excessive page access.** `host_permissions: ["<all_urls>"]` and a
  static content script inject into every matching frame even when annotation
  mode is unused.
- [x] **P0 — Redundant injection paths.** Static manifest injection and
  programmatic `chrome.scripting.executeScript()` both own content-script
  installation.
- [x] **P1 — Receiver permissions are not modeled separately.** Page access and
  cross-origin receiver access currently share one broad host grant.
- [x] **P2 — Browser support is implicit.** The manifest has no
  `minimum_chrome_version`, while the service worker contains branches for
  multiple Side Panel API generations.
- [x] **P2 — Extension icons are absent.** Chrome must render a placeholder in
  extension surfaces.

### Service-worker lifecycle and state

- [x] **P0 — Ephemeral global state.** `panelStateByWindowId` is a global `Map`;
  Chrome discards it whenever the Manifest V3 service worker shuts down.
- [x] **P0 — Annotation state is global instead of tab-specific.** One
  `annotateEnabled` boolean is read and written across tabs and windows.
- [x] **P1 — State ownership is duplicated.** The side panel and service worker
  both orchestrate content-script installation, annotation mode, persistence,
  and synchronization.
- [x] **P1 — Errors are frequently swallowed.** Empty catches and no-op promise
  handlers hide state and API failures.

### Side-panel semantics and accessibility

- [x] **P1 — Document language and outline are missing.** `<html>` lacks `lang`,
  and visual section labels are generic elements rather than headings.
- [x] **P1 — Comment field relies on placeholder naming.** It has no persistent,
  programmatically associated label.
- [x] **P1 — Annotation type is a broken composite widget.** A button-based
  `radiogroup` is paired with a separate visually hidden, focusable `<select>`;
  selected state is not exposed on the buttons.
- [x] **P1 — Dynamic click targets are pointer-only.** Attachment previews and
  unresolved annotation rows are clickable `<div>` elements.
- [x] **P1 — Dialogs lack explicit names.** Dialog titles are generic elements,
  and close buttons are announced as the multiplication glyph rather than a
  contextual action.
- [x] **P1 — Focus visibility is incomplete.** The custom switch has no visible
  keyboard focus, and text fields remove native outlines without a sufficient
  replacement.
- [x] **P1 — Async feedback is inconsistently announced.** Settings, copy,
  resolve, list, and annotation errors do not use a coherent live-region
  strategy.
- [x] **P2 — Field metadata is incomplete.** Receiver URL and token fields need
  explicit types, names, labels, autocomplete policy, and validation.
- [x] **P2 — Destructive actions have no recovery.** Clearing all attachments is
  immediate, with no confirmation or undo.
- [x] **P2 — Draft state is volatile.** Comment, selection, and attachments are
  lost when the side panel closes.

### Side-panel CSS and responsive behavior

- [x] **P1 — Text-only targets can be smaller than 24 by 24 CSS pixels.**
- [x] **P1 — Dialogs can overflow at high zoom.** Standard dialogs do not have a
  bounded block size, internal overflow, or overscroll containment.
- [x] **P1 — User preferences are incomplete.** Reduced motion, forced colors,
  and contrast preferences are not handled.
- [x] **P2 — Typography uses fixed pixels extensively.** Several labels render
  at 10px.
- [x] **P2 — Scrollbars use WebKit-only selectors.** Standard scrollbar styling
  and contrast behavior are absent.
- [x] **P2 — The theme forces light mode.** This is an explicit design choice,
  but it should be documented as the support policy if retained.

### Content-script interaction and geometry

- [x] **P0 — Selected geometry becomes stale.** Stored viewport rectangles are
  not updated after scrolling, resizing, or layout changes, so screenshots can
  crop the wrong pixels.
- [x] **P0 — Frame context is missing.** Scripts run in every frame, but payloads
  contain no frame identifier, frame URL, iframe offset, or locator chain.
- [x] **P1 — Element selection is mouse-only.** Touch, stylus, keyboard, and
  assistive-technology users cannot complete the primary page-selection flow.
- [x] **P1 — Hover work is unthrottled.** Every mousemove performs hit testing,
  layout reads, and style writes.
- [x] **P1 — Overlay styling can be broken by host CSS.** Highlight elements are
  inserted directly into the host document rather than a contained Shadow DOM.
- [x] **P1 — Highlight states do not meet robust contrast requirements.** The
  green border is 2.10:1 against white, and hover/selected states rely mainly on
  color.
- [x] **P2 — Locator construction repeats expensive work.** CSS selector
  generation and rectangle reads are duplicated during one selection.
- [x] **P2 — XPath escaping is incomplete for quoted IDs.**

### Networking, feedback, and rendering

- [x] **P1 — Connection status can be wrong.** `throwOnFail` turns a detected bad
  token or missing token into the generic offline state.
- [x] **P1 — List failures look like empty data.** Non-success and malformed
  annotation responses silently return `[]`.
- [x] **P1 — Fetches have no explicit timeout or cancellation.** Local receiver
  failures can leave controls busy longer than intended.
- [x] **P1 — Attachment memory is unbounded.** Repeated data-URL screenshots are
  retained and serialized without a client-side count or byte limit.
- [x] **P2 — One error path interpolates into `innerHTML`.** Dynamic messages
  should use DOM creation and `textContent`.
- [x] **P2 — Save/Test semantics are ambiguous.** Settings are persisted before
  connectivity is verified, while the control can report “Failed”.

### Module design and testing

- [x] **P0 — Touched sources violate repository module limits.** Before the
  audit, `sidepanel.js` was 1,020 lines, `sidepanel.css` 622 lines, and
  `content_script.js` 504 lines.
- [x] **P1 — Responsibilities are coupled.** Rendering, network calls,
  attachments, dialogs, tab orchestration, and state transitions share the same
  side-panel file.
- [x] **P1 — Critical regression coverage is incomplete.** Unit checks cover
  tab-specific state, permission boundaries, module packaging and size, icon
  dimensions, and locator escaping. A real-Chrome journey covers keyboard
  selection, top-level geometry and cropping, full-screen capture, side-panel
  and service-worker restart, draft recovery, receiver integration, save, and
  resolve.

## Existing strengths

- Manifest V3 is already in use.
- Native modal dialogs use `showModal()`.
- Most actions use native buttons with explicit `type="button"`.
- Decorative SVGs are hidden from assistive technology.
- Receiver connection status uses a polite live region.
- Most user-provided annotation content is rendered with `textContent`.
- No remotely hosted extension code or inline event handlers are present.
- Motion code does not use `transition: all`.

## Support policy after the first remediation tranche

- **Browser:** Chrome 116 or newer.
- **Page scope:** annotation selection is deliberately limited to the top-level
  document. Nested-frame selection remains unsupported until the payload can
  represent a complete frame chain.
- **Permissions:** page injection requires a toolbar action or extension
  command through `activeTab`. Local receiver access is granted for
  `localhost` and `127.0.0.1`; custom HTTP(S) receiver origins require an
  explicit runtime permission prompt.
- **Theme:** the side panel intentionally ships as a light UI for now. Forced
  Colors is supported; automatic dark appearance remains a product follow-up.

## Validation baseline

- JavaScript syntax checks: passed for all extension JavaScript files.
- CSS Tree validation: passed.
- `html-validate`: 13 findings before remediation.
- axe-core: missing document language (serious) and missing level-one heading
  (moderate) before remediation.
- Accessibility tree: confirmed duplicate annotation-type controls,
  placeholder-named comment field, unnamed settings dialog, and glyph-named
  close action.
- Manual unpacked-extension verification was not run during the audit.

## Remediation order

1. Reduce permissions and make one component own each annotation session.
2. Make page selection tab- and frame-aware, then keep geometry current.
3. Repair semantic HTML, native choice controls, focus, and live feedback.
4. Split oversized JavaScript and CSS by responsibility.
5. Add critical state, locator, receiver, and accessibility regression checks.
6. Finish user-preference, attachment-limit, draft-recovery, and visual-polish
   work.

## Implementation log

- **2026-07-21:** Audit documented; first remediation tranche started.
- **2026-07-21:** Removed persistent all-site access and static all-frame
  injection; added explicit custom-receiver permission requests and a Chrome
  116 support floor.
- **2026-07-21:** Replaced global worker state with per-tab
  `chrome.storage.session` records and made the service worker the canonical
  owner of annotation-mode transitions.
- **2026-07-21:** Split side-panel, content, background, and CSS sources by
  responsibility. Every handwritten extension source is below 300 lines.
- **2026-07-21:** Rebuilt side-panel semantics, focus states, live feedback,
  native annotation-type radios, dialog names, and dynamic list/preview
  controls.
- **2026-07-21:** Limited selection to the top frame, contained overlays in a
  Shadow DOM, added pointer and keyboard selection, throttled pointer work,
  refreshed geometry before element crops, and fixed XPath quote escaping.
- **2026-07-21:** Added receiver timeouts, truthful error states, attachment
  limits, safe DOM rendering, and critical regression checks for tab state,
  permission boundaries, packaged modules, module size, and locators.
- **2026-07-21:** Added IndexedDB-backed drafts keyed by tab and route. Comment,
  annotation type, selected element, and attachments now survive side-panel and
  service-worker restarts. The service worker owns closed-tab cleanup, while
  successful sends remove their own drafts.
- **2026-07-21:** Added production SVG and 16, 32, 48, and 128 pixel PNG icons,
  wired them into the manifest, and added dimension/package checks.
- **2026-07-21:** Added a real-Chrome integration journey using an unpacked
  extension, temporary page, and real receiver. It verifies keyboard selection,
  capture and crop, cold restart recovery, save, list, detail, and resolve.
- **2026-07-21:** Prepared the complete remediation as release `v0.4.0`.
- **2026-07-28:** Made unresolved annotation comments editable and replaced
  saved attachment paths with authenticated square image thumbnails. Saved
  previews reuse the native image dialog, preserve the source aspect ratio,
  and show the stored path below the image.
- **2026-07-29:** Hardened saved-comment concurrency and receiver attachment
  compatibility after review. Slow save responses cannot overwrite newer
  editor text, save failures remain in the modal live region, raw
  `dataBase64` uploads remain supported, and multi-attachment resolution
  preflights and rolls back file moves.

### Saved annotation interface follow-up

- The detail dialog owns comment editing, dirty-state feedback, discard
  confirmation, and save-before-resolve behavior. Copy-as-prompt uses the
  currently visible comment, including unsaved edits.
- While a comment save is pending, close and resolve are disabled. The editor
  remains usable; a response only updates it when the annotation session and
  submitted editor value still match. Newer text stays dirty and available for
  the next save.
- Comment-save failures are shown persistently in the dialog's polite live
  region instead of relying on page-level feedback outside the active modal.
- The receiver owns persistence and asset access through authenticated
  `PATCH /annotations/:id` and
  `GET /annotations/:id/attachments/:index` endpoints.
- Attachment reads are limited to managed open/resolved asset directories.
  Responses are non-cacheable and include `X-Content-Type-Options: nosniff`.
- Thumbnail object URLs are revoked when saved detail content is replaced or
  closed. Images use native buttons and the preview uses a named `<dialog>`,
  `<figure>`, and `<figcaption>`.
- The standalone receiver and both scaffolded receiver copies are kept byte
  identical by an integration test, including the focused attachment-storage
  module.

Follow-up validation on 2026-07-29:

- `pnpm test:extension`: 9 tests passed.
- `pnpm test:receiver`: 2 integration tests passed, covering authenticated
  edits and reads, raw `dataBase64`, managed-path enforcement, failed resolve
  preflight, and runtime-copy parity.
- `pnpm test:extension:browser`: passed in Chrome 146, including saved comment
  persistence, square thumbnails, hidden raw paths, full-aspect preview, path
  caption, stale-response protection, modal-local errors, and
  resolve-after-edit.
- JavaScript syntax, `html-validate`, and CSS Tree validation passed.
- The extension ZIP passed archive and checksum validation with all 31 runtime
  files. Dry runs for both npm packages included the updated receiver copies.

## Final validation

- `pnpm test:extension`: 9 tests passed.
- `pnpm test:extension:browser`: passed in Chrome 146. The test loads the
  unpacked extension, uses a real page and receiver, restarts the side panel and
  service worker, restores the draft/session, completes save and resolve, and
  verifies closed-tab draft cleanup.
- JavaScript syntax checks: passed for every extension JavaScript file.
- `html-validate`: passed with zero findings.
- CSS Tree validation: passed for all CSS modules.
- Unpacked Chromium load: passed with no manifest errors, runtime errors, or
  warnings.
- Browser accessibility-tree smoke check: passed for document outline, native
  annotation-type radios, labeled fields, and the named settings dialog.
- `pnpm package:extension`: passed; the release archive contains all 30 runtime
  files and its SHA-256 checksum verifies.
- `git diff --check`: passed.

## Remaining follow-up

- Add complete nested-frame selection only with a frame-chain payload and crop
  model; do not restore all-frame injection without that model. This is a future
  feature, not a defect in the documented top-level-page scope.
- Decide whether automatic dark appearance belongs in the product theme. The
  current light-theme policy and Forced Colors support are intentional.
- Keep the extension manifest and both public package versions aligned for
  future releases.
