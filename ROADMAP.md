# Roadmap

Remaining work for Markdown Editor 1.0.1. Nothing here blocks normal use: the
application builds, runs and passes its automated checks. Items are grouped by
whether they are defects, deliberate limits, or enhancements that were considered
and consciously deferred.

Current state: 202 TypeScript tests, 36 Rust tests, and three packaged-app checks
(`check:ui` 18/18, `check:app` 10/10, `check:e2e` 12/12) all pass. File
associations for `.md` and `.markdown` are registered by the installer and
verified by double-click and second-instance forwarding.

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

- `katex@0.16.47` is present in `node_modules` as a nested dependency of
  `remark-math`, flagged by `npm audit` for GHSA-238p-pmpm-9mq7. It is **not in
  the shipped bundle** (only `0.19.1` is; the vulnerable entry point is never
  imported) but an `overrides` entry would silence the audit noise.
- The CSP still allows `img-src https:` so the per-document opt-in can work. The
  pipeline is what blocks the fetch, not the engine.
- Remote images inside a *remote* document are also blocked by default; the same
  *Load images* button applies.

---

## 1. Improvements offered but not yet built

These are the only items where the application could reasonably be considered
incomplete rather than deliberately scoped. Ordered by value.

### 1.1 Spell check toggle

**Problem.** `src/components/Editor/Editor.tsx` sets
`EditorView.contentAttributes.of({ spellcheck: 'false' })`. This suppresses the
WebView's spell-check squiggles entirely. It was chosen to avoid a wall of red
underlines in code-heavy notes, but for prose writing it is the wrong default.

**Proposal.** Enable `spellcheck` by default and add a View menu item
("Spell Check") plus a persisted preference, so the behaviour is the user's
choice rather than a hidden constant.

**Scope.** ~20 minutes. `View > Spell Check` (checkbox item), one entry in the
persisted settings version, one compartment reconfigure in the editor, README
row in the View table.

**Risk.** Low. No data path changes.

### 1.2 "New document" in the empty workspace

**Problem.** With no tabs open, the empty state offers "Browse for file",
"Open a URL" and "Paste from clipboard" — but not "New", which now exists in the
toolbar, the File menu and Ctrl+N. A first-time user can therefore miss that a
blank document is possible.

**Proposal.** Add a fourth button, `New document`, wired to the existing
`newDocument()` handler.

**Scope.** ~5 minutes plus a rebuild and a re-run of `check:ui`.

### 1.3 Drag to reorder tabs

**Problem.** Tabs can be selected with the mouse and with Left/Right/Home/End,
but not reordered. Notepad++ users expect drag-reordering once many documents
are open.

**Proposal.** Either pointer-based dragging, or (cheaper and more accessible)
`Alt+Shift+Left/Right` to move the active tab. The reducer already stores tab
order as an array, so this is a `move` action plus tests.

**Scope.** ~1 hour for the keyboard variant, ~2 hours including drag with an
accessible fallback.

### 1.4 Menu and toolbar duplication

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

---

## 3. Known gaps that cannot be automated here

Verified manually, or not verified at all. Called out so nobody mistakes green
checks for full coverage.

| Gap | Status |
|---|---|
| Native file picker | Not automated. The CLI path, file association and drag-and-drop are covered; the OS dialog is not. |
| Print dialog output | Not automated. The stylesheet is unit-tested indirectly; the dialog result is unverified. |
| Export "Save as" dialog | Not automated. `buildStandaloneHtml` is covered by tests; the final dialog is not. |
| Drag-and-drop from Explorer | Covered at the platform-interface level (fake platform) but not from a real Explorer drag. |
| Signed installer | Not done: requires a code-signing certificate and `bundle.windows.signCommand`. Until then Windows shows an unknown-publisher warning. |
| Auto-update | Not implemented. Would need a release host and signing. |
| `npm audit`: 3 low advisories | KaTeX prototype pollution via `remark-math`; no fixed release published. Mitigated by `trust: false` and never passing document values into KaTeX options. Recheck each dependency update. |

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

1. Spell check toggle (§1.1) — smallest change with the clearest user benefit.
2. Empty-state "New" button (§1.2) — closes an onboarding gap.
3. Verify the three native dialogs by hand and record the result (§3).
4. Tab reordering via keyboard (§1.3).
5. Only then consider the performance work in §2, with a measurement plan first.

Every item above must leave `npm test`, `npm run test:rust`, `npm run typecheck`,
`npm run lint` and `npm run build` green, and re-run `check:ui`, `check:app` and
`check:e2e` before being called done.
