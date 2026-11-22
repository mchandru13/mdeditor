# Roadmap

Remaining work after Markdown Editor 1.1.1. Nothing here blocks normal use: the
application builds, runs and passes its automated checks. Items are grouped by
whether they are defects, deliberate limits, or enhancements that were considered
and consciously deferred.

Current state: 368 TypeScript tests and 43 Rust tests pass (2026-11-22). Four of
the five packaged-app checks were re-run on this build: `check:ui` 30/30,
`check:app` 11/11, `check:e2e` 20/20 and `check:security` 13/13. `check:menu`
could not be re-run — UI Automation hung expanding a submenu and the process had
to be killed — and last passed 5/5 on 1.1.1. File associations for `.md` and
`.markdown` are registered by the installer and verified by double-click and
second-instance forwarding.

1.1.1 names Export PDF in the File menu, persists the sync-scroll toggle and makes
the menu check read the File submenu. 1.1.0 adds comments stored in the document, with editing and removal from the
Edit menu and from a right-click on a rendered comment. It also fixes three ways
a session could lose data: a restored tab started out marked Saved (so Ctrl+S
could write the truncated recovery copy over the original), undo leaked one tab's
text into another, and an unreadable `settings.json` was replaced with defaults.

1.0.3 changed the installer only: `src-tauri/nsis/hooks.nsh` now tells the shell
the association changed, so an upgrade repaints Explorer's cached `.md` icon. No
application code changed in that release.

## 0. Security review, fixed in 1.0.1

Two defects were found by attacking the packaged app rather than reading its
configuration, and both are fixed here.

### 0.1 A document could navigate the webview away (fixed)

A Mermaid `click ... href` directive produced a real anchor inside the rendered
SVG, which bypassed the click handling used for Markdown links. Clicking it
replaced the app UI with a foreign page. Tauri's ACL still refused every app
command from that origin (`not allowed by ACL`), so it was UI takeover and a
denial of service rather than code execution: the close handler then asked a
frontend that no longer existed, so the window could not be closed.

Fixed on three levels: `navigation.rs` cancels any navigation off the app origin
at the engine level, Mermaid anchors open in the system browser instead, and the
viewer now applies the same `isSafeSvg` check the exporter used.

### 0.2 Local documents fetched remote images (fixed)

`img-src` permits `https:`, so `![](https://attacker/pixel.png)` in any opened
file produced a request — an IP and open-time beacon. This contradicted the
claim that remote fetching happens only through the explicit URL action.

Remote images are now replaced with inert text showing the alt text, and the
preview offers *Load images* per document. Export still keeps remote images as
references, because exporting is an explicit action.

### 0.3 Also tightened

`write_document` now enforces an extension allowlist (`md`, `markdown`, plus
`html`/`htm` for export); previously only reads were checked, which left the
command as a general file-write primitive. `isSafeSvg` moved to `svgSafety.ts`
and now anchors its `javascript:` check to a URL attribute so a label reading
"javascript: the good parts" is not rejected.

### 0.4 Still open

- The CSP still allows `img-src https:` so the per-document opt-in can work. The
  pipeline is what blocks the fetch, not the engine.
- Remote images inside a *remote* document are also blocked by default; the same
  *Load images* button applies.

---

## 1. Improvements

The first two were built in 1.0.2 and are recorded here so the reasoning survives.
The rest are the only remaining items where the application could reasonably be
considered incomplete rather than deliberately scoped.

### 1.1 Spell check toggle (done)

Editor spell checking is now on by default, with **View -> Toggle Spell Check**
and a persisted `spellCheck` preference. The constant `spellcheck: 'false'` and
its rationale are gone; `src/App.tsx` owns the setting and the editor applies it
through a `Compartment`, so toggling does not recreate the view.

### 1.2 "New document" in the empty workspace (done)

The empty state now leads with **New document** (primary), followed by Browse,
Open a URL and Paste from clipboard.

### 1.3 Drag to reorder tabs

**Problem.** Tabs can be selected with the mouse and with Left/Right/Home/End,
but not reordered. Notepad++ users expect drag-reordering once many documents
are open.

**Proposal.** Either pointer-based dragging, or (cheaper and more accessible)
`Alt+Shift+Left/Right` to move the active tab. The reducer already stores tab
order as an array, so this is a `move` action plus tests.

**Scope.** ~1 hour for the keyboard variant, ~2 hours including drag with an
accessible fallback.

### 1.4 The toolbar overflows at the minimum window width

**Problem.** `.app-header` is a single non-wrapping row with `overflow-x: auto`.
At the 1024px minimum width its content needs about 1208px, so the right end —
Contents, Sync scroll and the theme selector — is reachable only by scrolling the
header sideways. Measured while adding zoom, which is part of why the zoom stepper
went to the status bar instead. This predates that change; the header fits at the
default 1280px window.

**Proposal.** Let the toolbar wrap below ~1220px (`flex-wrap: wrap` plus a little
vertical padding), which keeps every control visible at the cost of a taller
header only in narrow windows. Deliberately not bundled with the zoom change: it
is a layout decision, not a defect in zoom.

### 1.5 Menu and toolbar duplication

**Problem.** Both surfaces now expose the same actions (File/Edit/View menus and
the toolbar). This is normal for a desktop application, but it costs vertical
space in a compact window and doubles the visual weight of the chrome.

**Proposal.** Either accept it (the current state), or thin the toolbar to the
frequent actions (New, Open, Save, Export, Contents, Sync scroll) and leave the
rest to the menu. This is a design decision, not a defect — do not change it
without a preference.

---

## 2. Deliberate limitations

Documented behaviour, not bugs. Changing any of these means changing a documented
trade-off, so each needs an explicit decision.

| Item | Why it is the current behaviour | What changing it would take |
|---|---|---|
| 200 KB document pipeline is ~491 ms against a 300 ms target | Parsing alone is ~315 ms (micromark throughput on the reference machine); the rest is highlighting and post-processing | Incremental parsing across edits, or a second parser. Large work, uncertain payoff. |
| Lighthouse 97 measures the empty shell | Lighthouse cannot drive the clipboard flow into a populated document, and the desktop build is not served over a URL | A scripted Lighthouse run with a pre-seeded document, or dropping the metric |
| External changes detected on window focus, not by a filesystem watcher | No extra dependency, no idle CPU or handle per open file | `notify` crate in Rust with a debounced event stream and per-document debouncing |
| Replace edits the source and is disabled in Read Mode | The preview is derived; rewriting it would break what "Read Mode" means | Not recommended |
| Chunked parsing replicates reference definitions into each chunk | Keeps links working across boundaries; costs a little extra parse work on definition-heavy files | A two-pass parse that resolves definitions globally before rendering |
| Tabs are capped at 50 with a confirmation prompt | Prevents unbounded session files and memory growth | Raise or remove the limit; check session size and restore time |
| Comments are block-form only, one blockquote after the annotated paragraph | Inline markers such as `{==text==}{>>note<<}` do not survive the Markdown parser: a note containing `$`, `*`, `[` or `|` degrades to literal text, so it would silently break for exactly the notes worth writing | A custom remark plugin with a dedicated inline node type, plus formatting, escaping and sanitizer work |
| Export PDF opens the system print dialog; no `.pdf` is written directly | The dialog is the documented PDF path (spec §10.3, §11.3) and the print stylesheet already yields the document; writing the file ourselves needs WebView2's `ICoreWebView2_7::PrintToPdf` through `with_webview`, i.e. raw COM (`unsafe`, a refcounted callback, and a resolve-after-callback command shape) plus two new dependencies | Confine the `unsafe` to a small `#[cfg(windows)]` module, have the completion callback resolve an async command instead of blocking the UI thread (blocking inside `with_webview` deadlocks: the callback runs there), and cover it with a test that writes and re-reads a real file |
| Zoom is a reading aid: one global level, a fixed 50–200% ladder, rendered page only | It scales the document (text, tables, code, math, diagrams) and never the application chrome; print forces it back to 100%; the source editor keeps its own size. Stored as one global preference, not per document | Per-document zoom needs a persisted field per tab; Ctrl+wheel needs a wheel listener that suppresses the webview's own zoom; editor zoom is CodeMirror's own font setting |
| Comments have no ids or status, and no inline-comment form | Editing and removal by menu and right-click exist, but a comment can only be anchored to a whole paragraph, and it has no identity to reply to or resolve | An anchor model (content hash or persisted id) for status/targeting, and a custom remark plugin for inline comments |

---

## 3. Known gaps that cannot be automated here

Verified manually, or not verified at all. Called out so nobody mistakes green
checks for full coverage.

| Gap | Status |
|---|---|
| Native file picker | Not automated. The CLI path, file association and drag-and-drop are covered; the OS dialog is not. |
| Print dialog output | The *output surface* is now automated: `check:ui` emulates print media and asserts chrome hidden, document at the top, rendered text rather than source, light colours and `break-inside: avoid`. What remains unverified is the native dialog itself and whether a PDF lands on disk — it is a modal that CDP cannot drive, so that needs a human clicking *Save as PDF*. |
| Export "Save as" dialog | Not automated. `buildStandaloneHtml` is covered by tests; the final dialog is not. |
| Drag-and-drop from Explorer | Covered at the platform-interface level (fake platform) but not from a real Explorer drag. |
| Signed installer | Not done: requires a code-signing certificate and `bundle.windows.signCommand`. Until then Windows shows an unknown-publisher warning. |
| Native menu item invocation | `check:menu` reads the menu bar, the File submenu (labels), the Edit submenu (`Add Comment…` accelerator), but this session cannot deliver input to the window, so item *behaviour* is covered by `tests/integration/app.test.tsx` rather than end to end. |
| Auto-update | Not implemented. Would need a release host and signing. |
| `npm audit` | Clean as of 1.1.1 (rechecked 2026-11-22 across 681 dependencies): 0 of every severity. An `overrides` entry pins the nested `katex` (pulled by `remark-math`) to the app's own patched version, which removed the duplicate entirely — verified by `npm ls katex` showing a single deduped `katex@0.19.1`. Recheck after dependency updates. |

---

## 4. Explicitly out of scope

Requested by the specification to be absent, or deliberately excluded. Do not add
without agreeing to change the product.

- Analytics, telemetry, crash reporting, hidden network requests.
- Raw HTML passthrough in Markdown.
- Remote asset fetching for local documents.
- A plugin or extension system.
- Accounts, sync, or cloud storage.
- Multi-window / multi-instance editing of the same file.

---

## 5. If work resumes, do it in this order

1. Verify the three native dialogs by hand and record the result (§3).
2. Tab reordering via keyboard (§1.3).
3. Thin the menu/toolbar duplication (§1.5) if it bothers you in daily use.
4. Only then consider the performance work in §2, with a measurement plan first.

Every item above must leave `npm test`, `npm run test:rust`, `npm run typecheck`,
`npm run lint` and `npm run build` green, and re-run `check:menu`, `check:ui`,
`check:app`, `check:e2e` and `check:security` before being called done.
