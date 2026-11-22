# Markdown Editor

[![CI](https://github.com/mchandru13/mdeditor/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/mchandru13/mdeditor/actions/workflows/ci.yml)

A local-first Markdown viewer and editor for Windows, built with Tauri 2, Rust, React and TypeScript. It opens Markdown files in tabs, renders GitHub-flavoured Markdown with syntax highlighting, KaTeX math and Mermaid diagrams, and offers three workspace modes: **Read**, **Edit** and **Split**.

The frontend is framework-independent of Tauri: every native capability goes through a single platform interface (`src/platform/`), which the tests replace with an in-memory implementation. The same interface lets `npm run dev` run in a plain browser with no native features, which is useful for UI work and for the performance audit.

## Download

Every published build is a GitHub Release:

| Release | Installer | Notes |
|---|---|---|
| [v1.1.2](https://github.com/mchandru13/mdeditor/releases/tag/v1.1.2) | `Markdown Editor_1.1.2_x64-setup.exe` | Read/Split zoom (Ctrl++ / Ctrl+- / Ctrl+0), printing from Split Mode no longer includes the source editor, correct outline highlight while scrolling |
| [v1.1.1](https://github.com/mchandru13/mdeditor/releases/tag/v1.1.1) | `Markdown Editor_1.1.1_x64-setup.exe` | Per-user install, no admin prompt; names Export PDF in the File menu and persists the sync-scroll toggle |

Earlier versions are on the [releases page](https://github.com/mchandru13/mdeditor/releases).

The `.msi` on each release is for enterprise deployment (Group Policy, Intune); use the `.exe` otherwise. Installed builds go to `%LOCALAPPDATA%\Markdown Editor` and need about 13 MB. The installer is unsigned, so SmartScreen asks for confirmation; see [Install requirements](#install-requirements) below.

## Requirements

| Requirement | Version used |
|---|---|
| Windows | 10 or 11 |
| Node.js | 24.13.0 (20.19+ works) |
| npm | 11.x |
| Rust | 1.100.0, `x86_64-pc-windows-msvc` |
| MSVC build tools | Visual Studio 2022 Build Tools with `VC.Tools.x86.x64` and the Windows 11 SDK |
| WebView2 Runtime | installed on Windows 11 and current Windows 10 |

If `cargo` is not on your `PATH`, add `%USERPROFILE%\.cargo\bin`. Tauri resolves `link.exe` through the Visual Studio installation; no developer prompt is required once the build tools are installed.

### Install requirements

Only needed to run the released installer, not to build:

| Requirement | Detail |
|---|---|
| Windows 10 or 11, x64 | ARM64 runs the x64 build under emulation |
| WebView2 Runtime | preinstalled on Windows 11 and updated Windows 10. If absent, the installer downloads Microsoft's bootstrapper (~2 MB), so the install needs network access |
| Administrator rights | not required — `currentUser` install into `%LOCALAPPDATA%` |
| VC++ redistributable | not required — the binary imports no `vcruntime`/`msvcp`/`ucrt` DLLs |
| Disk | ~13 MB installed |

Two first-run surprises are expected rather than broken: SmartScreen warns because the build is unsigned (*More info → Run anyway*), and Windows may keep an existing `.md` handler until you choose *Open with → Markdown Editor → Always use this app* once.

## Install and run

```bash
npm install          # installs frontend dependencies
npm run dev          # Vite only, in a browser, no native features
npm run tauri:dev    # the desktop app with hot reload
```

> `npm run dev` opens the UI with an in-memory platform: file dialogs, file writes and clipboard access do nothing. Use `npm run tauri:dev` for real work.

## Build and package

```bash
npm run build        # type-check and produce dist/
npm run tauri:build  # produce installers in src-tauri/target/release/bundle/
```

Windows bundles are generated for **NSIS** (`.exe`) and **WiX** (`.msi`). Sizes below are from the v1.0.0 reference build; installer file names carry whatever version `tauri.conf.json` declares, so they differ from these examples:

| Artifact | Size |
|---|---|
| `src-tauri/target/release/mdeditor.exe` | 13.1 MiB |
| `src-tauri/target/release/bundle/nsis/Markdown Editor_1.0.0_x64-setup.exe` | 10.1 MiB |
| `src-tauri/target/release/bundle/msi/Markdown Editor_1.0.0_x64_en-US.msi` | 10.7 MiB |

Icons live in `src-tauri/icons/`. They are generated from `design/icon-master.svg`, which is the source of truth:

```bash
npm run icon   # renders the SVG to app-icon.png, then generates every platform size
```

The artwork is drawn rather than hand-painted so the geometry can be tuned until it survives 16 px. `design/icon-in-context.png` is the check that drove the design: the icon shown as a desktop shortcut, a 24/20/16 px taskbar slot and an Alt-Tab tile, on both light and dark shells. Two findings came from it — a navy sheet disappears against the dark Windows taskbar, and any detail thinner than about 6 px at 1024 reads as noise once the sheet is only 13 px wide.

## Continuous integration and releasing

Two GitHub Actions workflows live in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `CI` | every push to `master`, pull requests, manual dispatch | type-check, lint, 368 tests, production build, and `check:ui` in Edge — plus `cargo test` in a second job |
| `Release` | a `v*` tag, or manual dispatch | builds the NSIS and MSI installers; on a tag, publishes them as a GitHub Release with checksums |

A manual `Release` run builds the installers and keeps them as workflow artifacts without publishing, which is the way to test packaging changes.

Publishing a version:

```bash
# 1. bump all three, they must agree or the workflow fails
#    package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json
git commit -am "Release 1.1.0"
git tag -a v1.1.0 -m "Markdown Editor 1.1.0"
git push origin master --follow-tags
```

The workflow refuses to publish when the tag and the three version fields disagree, so an installer whose file name says one version can never be attached to a release whose tag says another.

## npm scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server on port 1420 |
| `npm run build` | `tsc --noEmit` followed by `vite build` |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest unit and integration tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:rust` | `cargo test` for the native layer |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run tauri:dev` | Desktop app with hot reload |
| `npm run tauri:build` | Release build and installers |
| `npm run bench` | Markdown pipeline benchmark (writes `bench/results.json`) |
| `npm run clean` | Reclaims `src-tauri/target/` space, keeping the dependency cache (see AGENTS.md) |
| `npm run check:ui` | Playwright smoke test against the production bundle (needs `npm run preview` on :4173) |
| `npm run check:app` | Playwright + CDP smoke test against the packaged desktop app |
| `npm run check:menu` | Windows UI Automation check of the native menu bar, the File and Edit submenus, and the Add Comment accelerator |
| `npm run check:e2e` | End-to-end run of the packaged app: open, edit, replace, save, external change, comment, undo, modes |
| `npm run check:security` | Attacks the packaged app: navigation escape, remote-image beaconing, hostile Markdown, comment spoofing |

## Using the application

### Menu bar

A native Windows menu bar exposes every action and its accelerator:

| Menu | Items |
|---|---|
| File | New (Ctrl+N), Open… (Ctrl+O), Open from URL…, New from Clipboard, Save (Ctrl+S), Save As… (Ctrl+Shift+S), Export HTML…, Print / Export PDF… (Ctrl+P), Exit |
| Edit | Undo (Ctrl+Z), Redo (Ctrl+Y), Cut, Copy, Paste, Select All, Find… (Ctrl+F), Replace… (Ctrl+H), Add Comment… (Ctrl+Shift+M), Edit Comment…, Remove Comment, Remove All Comments |
| View | Read Mode (Ctrl+1), Edit Mode (Ctrl+2), Split Mode (Ctrl+3), Toggle Contents, Toggle Sync Scroll, Toggle Spell Check, Zoom In, Zoom Out, Actual Size, Theme ▸ Light / Dark / System |
| Help | Keyboard Shortcuts, About Markdown Editor |

The menu, the toolbar and the keyboard shortcuts all call the same handlers, so behaviour cannot drift between them. Cut/Copy/Paste/Select All are predefined OS items and therefore apply to whatever currently has focus. Toggle items do not show a check mark; the toolbar's pressed state and the View menu act on the same underlying setting.

### Opening documents

A file can be opened directly from the command line, which also makes the packaged app scriptable and testable:

```powershell
mdeditor.exe --file "C:\docs\notes.md"
mdeditor.exe --url "https://example.com/README.md"
mdeditor.exe "C:\docs\notes.md"   # what the file association passes
```

`--file` accepts `.md`/`.markdown`; `--url` goes through the same HTTPS-only fetch path as the dialog. A bare path (no flag) is also accepted, which is how Windows launches the application when a `.md` file is opened from Explorer or "Open with".

### File association

The installer registers the application as a handler for `.md` and `.markdown`:

- `HKCU\Software\Classes\.md` → `Markdown Document`
- `HKCU\Software\Classes\Markdown Document\shell\open\command` → `"...\mdeditor.exe" "%1"`

Double-clicking a Markdown file launches the app with that file. If an instance is already running, a second launch is intercepted by the single-instance plugin and the path is forwarded to the running window as a new tab, which is then focused — no second window, no duplicate process.

The installer adds the entry under `OpenWithProgids`; Windows may still ask which application to use the first time, because modern Windows no longer lets an installer silently take over an existing association (`.md` is currently held by another editor on most machines). Choose "Markdown Editor" and tick "Always use this app" to make it stick.

- **New** (Ctrl+N) creates an empty untitled document, numbered (`Untitled 1`, `Untitled 2`, …).
- **Open** (Ctrl+O) uses the native file picker and accepts `.md` and `.markdown`.
- **Drag and drop** a file onto the window. Other extensions are rejected with a message.
- **From clipboard** creates a new unsaved document from clipboard text.
- **Open URL** fetches a remote document. Only `https:` is accepted; the request is made in Rust with a 10 s connect timeout, a 30 s total timeout, at most 5 redirects and a 10 MB response cap.
- Opening a file that is already open focuses its existing tab.
- The last session is restored on start: tab order, paths, mode, theme, panel sizes and scroll positions. Untitled or modified documents keep up to 256 KB of recovery text each, for at most 20 documents.

### Workspace modes

| Mode | Shortcut | Behaviour |
|---|---|---|
| Read | Ctrl+1 | Rendered document, table of contents, search, zoom, reading statistics |
| Edit | Ctrl+2 | CodeMirror 6 source editor with line numbers and Markdown highlighting |
| Split | Ctrl+3 | Editor and preview side by side, draggable divider, 150 ms render debounce, optional synchronised scrolling |

Switching modes never reloads from disk, never discards edits and never creates a new document. Unsaved changes are preserved for every tab and shown as a dot on the tab.

**Zoom.** Read and Split share one level. *Ctrl++* / *Ctrl+-* step the rendered page through 50%, 67%, 75%, 80%, 90%, 100%, 110%, 125%, 150%, 175% and 200%, the status bar's −, + and percentage controls do the same, and the percentage button resets to 100% (*Ctrl+0*). It scales the document — text, tables, code, math and diagrams — not the application chrome, and the level is remembered between sessions. The range stops at 200% because `zoom` scales the available width too: in Split Mode at the smallest window a 300% page reflows to a handful of characters per line. Edit Mode has no preview, so the controls are disabled there.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+N | New document |
| Ctrl+1 / Ctrl+2 / Ctrl+3 | Read / Edit / Split |
| Ctrl++ / Ctrl+= | Zoom the document in |
| Ctrl+- | Zoom the document out |
| Ctrl+0 | Reset the zoom to 100% |
| Ctrl+F | Search in the current document |
| Ctrl+H | Find and replace |
| Ctrl+Shift+M | Add a comment to the selected text |
| Enter / Shift+Enter | Next / previous match (while search is open) |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+O | Open file |
| Ctrl+P | Print / Export PDF |
| Ctrl+W | Close tab |
| Escape | Dismiss search or a dialog |

Shortcuts are suppressed while a modal dialog has focus. In Edit Mode, `Ctrl+F` opens the application search rather than CodeMirror's own panel, which is deliberately not installed.

### Search

Search is application-owned. In Read and Split modes it matches rendered text nodes and highlights them with the CSS Custom Highlight API (falling back to `<mark>` elements). In Edit Mode it searches the Markdown source and selects matches in the editor. Matching stops at 5,000 results; the count then reads `5000+` while navigation continues to work.

**Replace** (Ctrl+H, or Edit → Replace…) adds a second row with Replace and Replace All. Replacement edits the Markdown source, respects the case-sensitivity toggle, is undoable, and is disabled in Read Mode with a note pointing at Edit/Split — the preview itself is never mutated. The current match index is preserved while replacing, so repeated Replace walks the document.

### Comments

Comments are written into the Markdown file itself, as a blockquote that starts
with a `[!comment]` marker (the same shape Obsidian uses for a callout), so any
editor or assistant reading the file sees the note next to the text it refers to:

```markdown
The cache is invalidated on write.

> [!comment] chand 2026-11-21
>
> Is this safe when the write fails halfway through?
```

Select text in Edit or Split Mode and choose **Edit → Add Comment…**
(Ctrl+Shift+M). The comment is inserted immediately after the selected paragraph,
and a blank line separates it from what follows.

- The marker must own its paragraph, so `> [!comment] header` is followed by a
  `>` line before the body. A quoted sentence that merely contains the marker is
  ordinary prose.
- Comments attach to top-level blocks only. Selections inside a list, table,
  blockquote or code block are refused with a message rather than mis-anchored to
  something the user did not select.
- Select the text you want to annotate, then use any of three entry points:
  **Edit → Add Comment…**, **Ctrl+Shift+M**, or right-clicking the selection and
  choosing **Add Comment…**. A selection works in **Read Mode** too, where no
  editor is mounted: the selected text is matched back to the document source.
  With nothing selected the command asks for a selection instead of guessing a
  position.
- Right-clicking a **rendered comment** offers **Edit Comment…** and **Remove
  Comment** for that comment, regardless of where the caret is. That is the
  quickest way to revise a note while reading.
- A comment body is ordinary sanitized Markdown (bold, links and inline math
  render normally), stored one `> ` level deep and capped at 4 KB including
  quoting. A header is a single line of at most 120 characters.
- **Edit Comment…** opens the comment the caret is in (or the nearest one) with
  its text loaded, and saves over the same block. **Remove Comment** deletes that
  block, and **Remove All Comments** deletes every comment in the document,
  leaving the prose untouched. All three are undoable with Ctrl+Z.
- The accelerator is **Ctrl+Shift+M**. It was Ctrl+Alt+M, which cannot work on a
  layout where Ctrl+Alt is AltGr: the OS turns that combination into a character
  (it arrived as "ṁ" with no modifier flags and an empty `code`), so it reaches
  neither the menu accelerator nor the webview. Ctrl+Shift+M is never an AltGr
  combination. If a key seems dead, the right-click menu and the Edit menu do the
  same thing.
- Comments are excluded from word and character counts and from the outline, and
  are skipped by in-document search in Read/Split Mode (Edit Mode searches the
  raw source, so it still finds them).
- **Export HTML removes comments**: they are editorial notes, not part of the
  artifact being handed over. Copy HTML and Print show the rendered document as
  displayed, including comments.
- Removing a comment is a normal edit — delete the blockquote. Comment bodies are
  not re-parsed to rebuild the document, so nothing else changes.

### External changes

Open files are checked for modification when the window regains focus. A clean tab reloads silently; a tab with unsaved edits asks before reloading, and choosing to keep the local copy suppresses the prompt until the file changes again. A file deleted while open is marked missing rather than recreated.

### Theming and printing

Light, dark and system themes are available from the toolbar; System mode follows OS changes. All colours come from `src/styles/tokens.css`. Printing uses `src/styles/print.css`, which removes application chrome and adds sensible page-break behaviour.

**Print / Export PDF…** (Ctrl+P, or the toolbar's Print button, whose tooltip names both) opens the system
print dialog; that dialog is also how a PDF is produced — choose *Microsoft Print
to PDF* as the printer. The application does not write the PDF itself and does not
claim one was written.

The reading zoom is a screen aid: the print stylesheet forces it back to 100%, so a page zoomed to 200% prints at its normal size. It prints the rendered document, so switch to **Read** or **Split** Mode first:
Edit Mode has no preview, and `print.css` hides the editor, so printing from Edit
Mode yields no document body. Writing a `.pdf` directly, without the dialog, is
deliberately not implemented; see `ROADMAP.md`.

### Export

- **Copy HTML** copies the rendered fragment currently displayed, not a standalone page.
- **Export HTML** writes a self-contained `.html` file: inlined layout and highlighting CSS, KaTeX stylesheet and `woff2` fonts as data URLs, rendered Mermaid SVG, embedded local images and a no-script Content-Security-Policy meta tag. Comment blocks are stripped first (see Comments above). Exports over 25 MB are refused with the projected size instead of writing an unexpectedly large file. The result is reported (bytes, images embedded or left remote, diagrams rendered or failed), and remote images remain remote rather than being silently dropped.

## Architecture

```text
src/
  components/    Viewer, Editor, Toc, SearchBar, Toolbar, CodeBlock, Mermaid,
                 DocumentTabs, WorkspaceModeSelector, Divider, Dialogs
  state/         documents.ts (per-tab reducer), session.ts (versioned persistence)
  hooks/         useDocumentRender, useScrollSpy, useShortcuts, useTheme, useDebounce
  lib/           markdownPipeline.ts, markdownWorker.ts, renderClient.ts,
                 exportHtml.ts, search.ts, comments.ts, slug.ts, assetResolver.ts,
                 encoding.ts
  platform/      index.ts (interface), tauri.ts, fake.ts, choose.ts
  styles/        tokens.css, app.css, viewer.css, editor.css, print.css
src-tauri/src/   lib.rs (commands, window lifecycle), paths.rs, remote.rs, settings.rs
```

Key decisions:

- **Markdown runs in a Web Worker.** `useDocumentRender` debounces the source (150 ms in Split Mode, 500 ms above 1 MB) and drops stale results by request id, so a slow render can never overwrite a newer one or leak into another tab. If the worker cannot start or crashes, rendering degrades to the main thread instead of leaving the preview blank; `tests/unit/renderClient.test.ts` covers that path.
- **Two-stage rendering.** The pipeline emits HAST with placeholders for math and diagrams. Sanitization runs before any KaTeX or Mermaid rendering, and neither library ever receives document-supplied HTML.
- **Bundle discipline.** Only 22 syntax-highlighting grammars are registered (instead of lowlight's common bundle), Mermaid and KaTeX are dynamic imports, and CodeMirror is lazy-loaded because Read Mode never needs it. Initial JS is 614 kB (195 kB gzip).
- **Rust owns durability.** `settings.json` is written atomically in the app data directory, corrupted files are backed up as `settings.corrupt-<timestamp>.json`, and a file whose version this build does not understand is left untouched on disk: the app starts from defaults and does not overwrite it.
- **Encoding fidelity.** Files are read as UTF-8; a BOM is detected and restored on save, and the dominant newline style is preserved per document. Round-trip behaviour is covered by Rust and TypeScript tests.
- **Large documents.** Parsing is chunked above 64 KB (see Performance). Preview stops auto-rendering above 2 MB, Mermaid and KaTeX are disabled above 1 MB, and files over 20 MB are refused.

### Security model

1. Raw HTML is **disabled**. HTML in Markdown is converted to literal text, so neither `rehype-raw` nor any document HTML reaches the DOM.
2. `rehype-sanitize` runs with an explicit allowlist (`buildSanitizeSchema`): GFM elements, task lists, footnotes, `hljs-*` classes and the three app placeholder classes. No `style`, `svg`, `iframe`, `object` or `on*` attributes.
3. URL protocols are limited to `http`, `https`, `mailto` and the Tauri asset protocol; `javascript:`, `vbscript:`, `data:` and `file:` are rejected.
4. KaTeX renders with `trust: false`; Mermaid is initialised with `securityLevel: 'strict'`, and the SVG it produces is checked by the same `isSafeSvg` guard in the live viewer and in exported HTML. Mermaid `click` links are routed through the system browser rather than the webview.
5. External links open in the system browser through the opener plugin; the webview never navigates away.
6. **The webview cannot navigate off-origin.** `src-tauri/src/navigation.rs` registers an `on_navigation` guard that cancels any navigation to a URL other than the bundled app origin (plus `http://localhost:1420` in debug builds only). Without it a rendered anchor could replace the app UI with a foreign page inside the app window — Mermaid `click` directives produce exactly such anchors.
7. CSP (`tauri.conf.json`): `default-src 'self'`, `script-src 'self'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. `style-src 'unsafe-inline'` is required because Mermaid and KaTeX inject style elements.
8. Tauri capabilities are limited to dialogs, clipboard text, opening external URLs and the app's own commands. There are no `fs:`, `shell:` or `http:` plugin permissions; reads and writes go through commands that enforce an extension allowlist — readable: `md`, `markdown`; writable: those plus `html`/`htm` for export — and 64 MB caps.
9. **Remote images are blocked by default.** An `https:` image in a local document is replaced with a placeholder showing its alt text, so opening a file cannot beacon to a third-party server. The preview then offers *Load images* for that document, and the choice applies to that tab only. Export is unaffected: it keeps remote images as references.
10. No analytics or telemetry exist. The only network requests are the explicit **Open URL** action and remote images the user chose to load.

The adversarial corpus in `tests/unit/security.test.ts` covers script tags, event handlers, `javascript:` and entity-encoded variants, SVG/`foreignObject`, `data:`/`file:` sources, inline styles, forms and Mermaid injection attempts, asserting inert output in both the viewer and exported HTML.

## Performance

### Method

`npm run bench` builds deterministic 200 KB and 5 MB fixtures (headings, tables, task lists, code fences, math, Mermaid, blockquotes) and measures the pipeline stages that run off the main thread. **Browser paint and React commit are not measured by this script.**

Measured on: 11th Gen Intel Core i5-11320H, 8 cores, 16 GB RAM, Windows, Node 24.13.0, three runs per fixture, median reported.

| Fixture | Parse | Transform (highlight) | Sanitize | Post-process | Total |
|---|---|---|---|---|---|
| 200 KB (340 headings) | 315 ms | 96 ms | 10 ms | 58 ms | **491 ms** (best 481) |
| 5 MB (8,508 headings) | 14,947 ms | 4,834 ms | 553 ms | 2,708 ms | **23.6 s** (best 22.5 s) |

These fixtures are deliberately dense: roughly 340 code fences, 340 Mermaid blocks and 680 math expressions in 200 KB.

### What the numbers mean

- **The 300 ms target for 200 KB is still not met** — the pipeline takes ~491 ms, down from ~614 ms after three changes: post-processing (resource rewriting, heading ids, statistics) now runs as one traversal instead of four (−~100 ms), only 22 grammars are registered for highlighting instead of lowlight's common bundle, and the editor is lazy-loaded so initial JS dropped from 1,136 kB (376 kB gzip) to 614 kB (195 kB gzip). Parsing alone is ~315 ms, which is micromark's throughput on this machine; closing the remaining gap would need incremental parsing across edits.
- **Micromark is superlinear in block containers.** A 256 KB file of blockquotes takes ~8.7 s unchunked versus ~0.9 s in 32 KB chunks (0.4 s at 64 KB). The pipeline therefore parses documents above 64 KB in 16 KB chunks at blank-line boundaries. Lists and blockquotes are never split (asserted in `tests/unit/chunking.test.ts`), and reference/footnote definitions are copied into every chunk so links still resolve across boundaries. Chunking cut the 5 MB case from 229 s to 24 s.
- **Large documents are gated, not silently slow.** Above 2 MB the preview is paused with a "Render preview" button; above 1 MB highlighting, math and diagrams are replaced by plain placeholders; above 20 MB the file is refused.

### Lighthouse

Lighthouse 12 was run against the production bundle (`npm run preview`) in headless Edge with its default mobile emulation:

| Score | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|
| **97** | 2.0 s | 2.0 s | 60 ms | 0 | 2.0 s |

Lighthouse cannot interact with the application, so this measures the **empty workspace shell**, not a rendered document; the desktop build is not served over a URL at all. The score is a check on bundle weight and startup, and is reported with that boundary in mind.

## Testing

```bash
npm test        # 368 tests (Vitest + React Testing Library, jsdom)
npm run test:rust  # 43 tests (cargo test)
```

Coverage:

- **Markdown pipeline:** GFM tables, task lists, strikethrough, footnotes, nested lists, autolinks, headings and duplicate slugs, math and Mermaid placeholders, highlighting, resource resolution, chunking equivalence and slug uniqueness across chunks.
- **Security:** the adversarial corpus described above, sanitizer schema assertions, Mermaid SVG validation, exported HTML inertness and local-path scrubbing.
- **Search:** match counting, case sensitivity, per-mode matching, skipping diagrams and scripts, highlight/clear behaviour without markup injection.
- **State:** per-tab independence, dirty derivation, close-neighbour selection, restore and persistence guards (corrupt settings, unknown versions, oversized recovery data, quota failures).
- **Integration:** mode switching and layout, unsaved edits surviving every transition, tab independence, save and failed save, search navigation, remote URL validation and fetch errors, keyboard shortcuts, ARIA roles and tab focus movement.

**Still manual:** opening files through the native picker, dragging files in from Explorer, the print dialog output, and visual/design judgement. Everything else listed above is automated, including rendering inside the packaged application.

### Browser and packaged-app smoke tests

Two Playwright scripts exercise the real UI in Edge (the same Chromium engine as WebView2):

```bash
npm run preview          # in one terminal
npm run check:ui         # 30 assertions against http://localhost:4173
```

```bash
npm run tauri:build      # then
npm run check:app        # attaches to the packaged app over CDP and opens a remote document
npm run check:e2e        # full session against the packaged app
npm run check:security   # attack probes against the packaged app
```

`check:ui` loads a document through the clipboard and asserts headings, tables, highlighting, task lists, the code copy button, KaTeX, Mermaid SVG, non-zero preview height, live preview updates after typing, all three mode transitions, search counts, replace-all, the TOC, and zero page errors. It also steps the document zoom with the keyboard and asserts the rendered page grows, the editor does not, Ctrl+0 restores it exactly, and print ignores it. It emulates print media and asserts the print output: chrome hidden, the document at the top of the page, rendered text rather than Markdown source, the light colour scheme, and `break-inside: avoid` on blocks. Finally it checks the zoom controls fit inside the status bar at the 1024px minimum window width. `check:app` launches `mdeditor.exe` with WebView2 remote debugging, verifies that a restored local-file tab renders, opens a real HTTPS Markdown document through the Rust fetch command, asserts the same rendering surface in Split Mode, then closes the tab it opened and restores the previous mode so the user's session is left as it was.

`check:e2e` drives the packaged application through a full editing session: it writes a temporary Markdown file, opens it with `--file`, renders it, types into the editor, replaces text through the find-and-replace UI, saves with Ctrl+S and verifies the bytes on disk, modifies the file from outside and confirms the reload, adds a comment with `Ctrl+Shift+M`, checks the annotation renders and reaches the file, undoes it with Ctrl+Z, copies rendered HTML, and switches to Read Mode. Native dialogs (file picker, print, export destination) are the only part of the flow that cannot be automated.

Every packaged check accepts `MDEDITOR_EXE` to point at an installed copy
(`%LOCALAPPDATA%\Markdown Editor\mdeditor.exe`) instead of the build in this
checkout, which is the binary a user actually runs:

```bash
MDEDITOR_EXE="$LOCALAPPDATA/Markdown Editor/mdeditor.exe" npm run check:e2e
```

`check:ui` needs Edge installed and a running preview server; `check:app`, `check:e2e` and `check:security` need a release build, and `check:app`/`check:security` need network access for the remote document and the remote image. `check:e2e` writes its document to a temporary directory, removes it afterwards, and closes the tab it opened so the restored session is left as it was.

### Manual smoke checklist (packaged build)

1. `npm run tauri:build`, then run `src-tauri/target/release/mdeditor.exe`.
2. Open a `.md` file with the picker; confirm the tab title, status bar path and rendered content.
3. Drag a second file onto the window; confirm a second tab and that switching tabs keeps each scroll position.
4. Edit in Split Mode; confirm the preview updates after typing stops and that bold, tables, task lists and code highlight correctly.
5. Add a `mermaid` fence and a `$x^2$` expression; confirm the diagram and math render, and that an invalid diagram shows the source plus an error card.
6. Press Ctrl+F, search for a word, and step through matches with Enter and Shift+Enter in Read, Edit and Split.
7. Switch modes with Ctrl+1/2/3 across every transition; confirm no edits are lost and the tab keeps its dirty dot.
8. Save with Ctrl+S, close the tab while modified, and confirm the discard prompt appears; cancel and confirm the tab stays.
9. Export HTML and open the file in a browser with the network disabled; confirm styling, math and diagrams render and the console shows no CSP or script errors.
10. Print with Ctrl+P and confirm the print preview contains only the document.
11. Open a URL with a non-HTTPS scheme; confirm it is rejected before any request.
12. Restart the application and confirm the tabs, theme, mode and layout return.

## Verification summary

Everything below was executed on the reference machine (11th Gen Intel Core i5-11320H, 16 GB RAM, Windows, Node 24.13.0, Rust 1.100.0).

The 1.1.1 snapshot (2026-11-22) was 337 Vitest tests, 40 Rust tests and `check:ui` 24/24. The table below is 1.1.2: 368 Vitest tests, 43 Rust tests and `check:ui` 30/30.

| Check | Command | Result |
|---|---|---|
| Type checking | `npm run typecheck` | passed, no diagnostics |
| Linting | `npm run lint` | passed, 0 errors, 0 warnings |
| Frontend production build | `npm run build` | passed; largest lazy chunks are Mermaid (~1.5 MB) and KaTeX fonts (~380 kB), both loaded on demand |
| Unit and integration tests | `npm test` | 368 passed |
| Native tests | `npm run test:rust` | 43 passed |
| File association | double-click a `.md` in Explorer | launches the app with that file; second file forwards to the running window (verified: 1 process, tab added) |
| Browser rendering check | `npm run check:ui` | 30/30 assertions passed against the production bundle, including replace-all, document zoom and the print output |
| Packaged app rendering check | `npm run check:app` | 11/11 assertions passed inside WebView2, including a restored local-file tab and a long document path that must not push the zoom controls off the status bar |
| End-to-end session | `npm run check:e2e` | 20/20: open via `--file`, render, edit, replace, save to disk, external reload, add a comment by keyboard, confirm it renders and is written to the file, undo it, copy HTML, zoom with `Ctrl+=` and reset with `Ctrl+0` in real WebView2 (the brand must not scale, so it is the document and not the window), mode switch |
| Security check | `npm run check:security` | 13/13: Mermaid link cannot navigate the webview, remote images are not fetched until opt-in, hostile Markdown stays inert, only canonical comment blocks are tagged (a comment cannot hide real content or reach the outline), the window still closes |
| Native menu check | `npm run check:menu` | File/Edit/View/Help present in the packaged window (UI Automation); the File submenu offers **Print / Export PDF…** and still has Export HTML; the Edit submenu contains **Add Comment…** and its native accelerator reads `Ctrl+Shift+M`. Item invocation is not automatable from this session; dispatch is covered by the menu-command tests. Last passed 5/5 on 1.1.1; not re-run on this build, because UI Automation hung expanding a submenu and had to be killed. The zoom commands' presence in the View menu is covered by `cargo test menu::`. |
| Desktop release build | `npm run tauri:build` | passed; NSIS and MSI installers produced |
| Packaged app boot | run `src-tauri/target/release/mdeditor.exe` | process stayed alive, React mounted, and `%APPDATA%\com.rea.mdeditor\settings.json` was written through IPC with the expected defaults |
| Benchmark | `npm run bench` | see Performance: 200 KB in ~491 ms of pipeline time, 5 MB in ~24 s |
| Lighthouse (production bundle) | `npx lighthouse http://localhost:4173` | performance 97 on the empty shell (see the caveat in Performance) |

The boot check is what confirms the CSP, the bundled scripts, the platform layer and the Rust command round-trip actually work in WebView2; the rest of the native surface (dialogs, drag-and-drop, printing) is covered by the manual checklist above.

The README describes the current application state; `ROADMAP.md` lists the
remaining work, deliberate limitations and unverified areas.

## Known limitations

- Chunked parsing replicates reference and footnote definitions into every chunk, so a document with many definitions does slightly more parsing work per chunk. Lists and blockquotes are never split.
- Syntax highlighting of very dense documents dominates render time; there is no incremental highlighting across edits yet.
- Export renders Mermaid diagrams with Mermaid's own renderer; a diagram that fails to render keeps its source block and is counted in the export report.
- Editing a remote document and saving writes a local copy through Save As; the remote URL is never written back.
- Session restore reads file contents lazily: only the active tab is loaded at start, others load when selected. A moved or deleted file is marked missing rather than recreated.
- The 200 KB performance target is missed (~491 ms of pipeline time, see above). The 5 MB case is not interactive by design; the preview is opt-in.
- `npm audit` is clean (0 vulnerabilities, rechecked 2026-11-22 across 681 dependencies): an `overrides` entry pins the nested `katex` that `remark-math` pulls in to the app's own patched version, which removed the duplicate advisory. Recheck after dependency updates.
- External changes are detected when the window regains focus, not by a live filesystem watcher, so a change made while the window stays focused is noticed only after switching away and back.
- Replace edits the Markdown source and is disabled in Read Mode; it does not rewrite rendered DOM.
- Toggle items in the View menu do not show a check mark; the toolbar's pressed state reflects the same setting.
- No auto-update or code signing. The installer carries publisher metadata, but Windows will show an unknown-publisher warning until a certificate is configured.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `failed to run 'cargo metadata' ... program not found` | `cargo` is not on `PATH`. Add `%USERPROFILE%\.cargo\bin` and open a new terminal. |
| `link.exe not found` during `cargo build` | Install Visual Studio 2022 Build Tools with the C++ workload and Windows 11 SDK. |
| Blank window in the packaged app | A CSP violation. Open the WebView2 devtools (`Ctrl+Shift+I` in a debug build) and check the console; report the blocked source. |
| Settings not saved | The app data directory may be read-only. A notice above the workspace reports the failure; unsaved buffer content is never discarded. |
| Images missing from a preview | Relative paths resolve against the document's folder. Pasted documents without a known folder show a notice and keep paths unresolved. |
