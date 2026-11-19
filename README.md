# Markdown Editor

A local-first Markdown viewer and editor for Windows, built with Tauri 2, Rust, React and TypeScript. It opens Markdown files in tabs, renders GitHub-flavoured Markdown with syntax highlighting, KaTeX math and Mermaid diagrams, and offers three workspace modes: **Read**, **Edit** and **Split**.

The frontend is framework-independent of Tauri: every native capability goes through a single platform interface (`src/platform/`), which the tests replace with an in-memory implementation. The same interface lets `npm run dev` run in a plain browser with no native features, which is useful for UI work and for the performance audit.

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

Windows bundles are generated for **NSIS** (`.exe`) and **WiX** (`.msi`). The application executable is `src-tauri/target/release/mdeditor.exe`. Icons live in `src-tauri/icons/` and are generated from `app-icon.png` with `npx tauri icon app-icon.png`.

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

## Using the application

### Opening documents

- **Open** (Ctrl+O) uses the native file picker and accepts `.md` and `.markdown`.
- **Drag and drop** a file onto the window. Other extensions are rejected with a message.
- **From clipboard** creates a new unsaved document from clipboard text.
- **Open URL** fetches a remote document. Only `https:` is accepted; the request is made in Rust with a 10 s connect timeout, a 30 s total timeout, at most 5 redirects and a 10 MB response cap.
- Opening a file that is already open focuses its existing tab.
- The last session is restored on start: tab order, paths, mode, theme, panel sizes and scroll positions. Untitled or modified documents keep up to 256 KB of recovery text each, for at most 20 documents.

### Workspace modes

| Mode | Shortcut | Behaviour |
|---|---|---|
| Read | Ctrl+1 | Rendered document, table of contents, search, reading statistics |
| Edit | Ctrl+2 | CodeMirror 6 source editor with line numbers and Markdown highlighting |
| Split | Ctrl+3 | Editor and preview side by side, draggable divider, 150 ms render debounce, optional synchronised scrolling |

Switching modes never reloads from disk, never discards edits and never creates a new document. Unsaved changes are preserved for every tab and shown as a dot on the tab.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl+1 / Ctrl+2 / Ctrl+3 | Read / Edit / Split |
| Ctrl+F | Search in the current document |
| Enter / Shift+Enter | Next / previous match (while search is open) |
| Ctrl+S | Save |
| Ctrl+Shift+S | Save As |
| Ctrl+O | Open file |
| Ctrl+W | Close tab |
| Escape | Dismiss search or the URL dialog |

Shortcuts are suppressed while a modal dialog has focus. In Edit Mode, `Ctrl+F` opens the application search rather than CodeMirror's own panel, which is deliberately not installed.

### Search

Search is application-owned. In Read and Split modes it matches rendered text nodes and highlights them with the CSS Custom Highlight API (falling back to `<mark>` elements). In Edit Mode it searches the Markdown source and selects matches in the editor. Matching stops at 5,000 results; the count then reads `5000+` while navigation continues to work.

### Theming and printing

Light, dark and system themes are available from the toolbar; System mode follows OS changes. All colours come from `src/styles/tokens.css`. Printing uses `src/styles/print.css`, which removes application chrome and adds sensible page-break behaviour. The print dialog is opened; the application does not claim a PDF was written.

### Export

- **Copy HTML** copies the rendered fragment currently displayed, not a standalone page.
- **Export HTML** writes a self-contained `.html` file: inlined layout and highlighting CSS, KaTeX stylesheet and `woff2` fonts as data URLs, rendered Mermaid SVG, embedded local images and a no-script Content-Security-Policy meta tag. Exports over 25 MB are refused with the projected size instead of writing an unexpectedly large file. The result is reported (bytes, images embedded or left remote, diagrams rendered or failed), and remote images remain remote rather than being silently dropped.

## Architecture

```text
src/
  components/    Viewer, Editor, Toc, SearchBar, Toolbar, CodeBlock, Mermaid,
                 DocumentTabs, WorkspaceModeSelector, Divider, Dialogs
  state/         documents.ts (per-tab reducer), session.ts (versioned persistence)
  hooks/         useDocumentRender, useScrollSpy, useShortcuts, useTheme, useDebounce
  lib/           markdownPipeline.ts, markdownWorker.ts, renderClient.ts,
                 exportHtml.ts, search.ts, slug.ts, assetResolver.ts, encoding.ts
  platform/      index.ts (interface), tauri.ts, fake.ts, choose.ts
  styles/        tokens.css, app.css, viewer.css, editor.css, print.css
src-tauri/src/   lib.rs (commands, window lifecycle), paths.rs, remote.rs, settings.rs
```

Key decisions:

- **Markdown runs in a Web Worker.** `useDocumentRender` debounces the source (150 ms in Split Mode, 500 ms above 1 MB) and drops stale results by request id, so a slow render can never overwrite a newer one or leak into another tab.
- **Two-stage rendering.** The pipeline emits HAST with placeholders for math and diagrams. Sanitization runs before any KaTeX or Mermaid rendering, and neither library ever receives document-supplied HTML.
- **Rust owns durability.** `settings.json` is written atomically in the app data directory, corrupted files are backed up as `settings.corrupt-<timestamp>.json`, and invalid or future versions are ignored rather than overwritten.
- **Encoding fidelity.** Files are read as UTF-8; a BOM is detected and restored on save, and the dominant newline style is preserved per document. Round-trip behaviour is covered by Rust and TypeScript tests.
- **Large documents.** Parsing is chunked above 64 KB (see Performance). Preview stops auto-rendering above 2 MB, Mermaid and KaTeX are disabled above 1 MB, and files over 20 MB are refused.

### Security model

1. Raw HTML is **disabled**. HTML in Markdown is converted to literal text, so neither `rehype-raw` nor any document HTML reaches the DOM.
2. `rehype-sanitize` runs with an explicit allowlist (`buildSanitizeSchema`): GFM elements, task lists, footnotes, `hljs-*` classes and the three app placeholder classes. No `style`, `svg`, `iframe`, `object` or `on*` attributes.
3. URL protocols are limited to `http`, `https`, `mailto` and the Tauri asset protocol; `javascript:`, `vbscript:`, `data:` and `file:` are rejected.
4. KaTeX renders with `trust: false`; Mermaid is initialised with `securityLevel: 'strict'` and its SVG is validated before being inlined into an export.
5. External links open in the system browser through the opener plugin; the webview never navigates away.
6. CSP (`tauri.conf.json`): `default-src 'self'`, `script-src 'self'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`. `style-src 'unsafe-inline'` is required because Mermaid and KaTeX inject style elements.
7. Tauri capabilities are limited to dialogs, clipboard text, opening external URLs and the app's own commands. There are no `fs:`, `shell:` or `http:` plugin permissions; reads and writes go through commands that enforce an extension allowlist and 64 MB caps.
8. No analytics, telemetry or background network requests exist. Remote fetching happens only through the explicit URL action.

The adversarial corpus in `tests/unit/security.test.ts` covers script tags, event handlers, `javascript:` and entity-encoded variants, SVG/`foreignObject`, `data:`/`file:` sources, inline styles, forms and Mermaid injection attempts, asserting inert output in both the viewer and exported HTML.

## Performance

### Method

`npm run bench` builds deterministic 200 KB and 5 MB fixtures (headings, tables, task lists, code fences, math, Mermaid, blockquotes) and measures the pipeline stages that run off the main thread. Parsing, transform and sanitization are reported separately; **browser paint and React commit are not measured by this script**.

Measured on: 11th Gen Intel Core i5-11320H, 8 cores, 16 GB RAM, Windows, Node 24.13.0, three runs per fixture, median reported.

| Fixture | Parse | Transform | Sanitize | Total |
|---|---|---|---|---|
| 200 KB (340 headings) | 333 ms | 116 ms | 13 ms | **614–626 ms** |
| 5 MB (8,508 headings) | 16,159 ms | 5,299 ms | 606 ms | **30.4 s** |

These fixtures are deliberately dense: roughly 340 code fences, 340 Mermaid blocks and 680 math expressions in 200 KB.

### What the numbers mean

- **The 300 ms target for 200 KB is not met.** The pipeline alone takes ~614 ms on this machine. The remaining cost after parsing is syntax highlighting of hundreds of code blocks. This is reported rather than worked around by removing features.
- **Micromark is superlinear in block containers.** A 256 KB file of blockquotes takes ~8.7 s unchunked versus ~0.9 s in 32 KB chunks (0.4 s at 64 KB). The pipeline therefore parses documents above 64 KB in 16 KB chunks at blank-line boundaries. The trade-off: a list or blockquote that spans a chunk boundary renders as two adjacent blocks. Chunking cut the 5 MB case from 229 s to 30 s and the 200 KB case from 3.4 s to 0.61 s.
- **Large documents are gated, not silently slow.** Above 2 MB the preview is paused with a "Render preview" button; above 1 MB highlighting, math and diagrams are replaced by plain placeholders; above 20 MB the file is refused.
- **Lighthouse was not run.** It audits a URL, and the desktop application is not served over one. Running it against `npm run preview` would measure the browser fallback shell with no document loaded, which says nothing about the desktop build, so no score is claimed.

## Testing

```bash
npm test        # 145 tests (Vitest + React Testing Library, jsdom)
npm run test:rust  # 21 tests (cargo test)
```

Coverage:

- **Markdown pipeline:** GFM tables, task lists, strikethrough, footnotes, nested lists, autolinks, headings and duplicate slugs, math and Mermaid placeholders, highlighting, resource resolution, chunking equivalence and slug uniqueness across chunks.
- **Security:** the adversarial corpus described above, sanitizer schema assertions, Mermaid SVG validation, exported HTML inertness and local-path scrubbing.
- **Search:** match counting, case sensitivity, per-mode matching, skipping diagrams and scripts, highlight/clear behaviour without markup injection.
- **State:** per-tab independence, dirty derivation, close-neighbour selection, restore and persistence guards (corrupt settings, unknown versions, oversized recovery data, quota failures).
- **Integration:** mode switching and layout, unsaved edits surviving every transition, tab independence, save and failed save, search navigation, remote URL validation and fetch errors, keyboard shortcuts, ARIA roles and tab focus movement.

**Not covered by automation:** the native window, real file dialogs and drag-and-drop, WebView2 rendering, Mermaid/KaTeX visual output, and printing. These are verified manually against the packaged build. CodeMirror is replaced by a controlled textarea in the integration tests; the real editor is exercised only in the browser.

## Known limitations

- Chunked parsing can split a list or blockquote that spans a chunk boundary in documents above 64 KB.
- Syntax highlighting of very dense documents dominates render time; there is no incremental highlighting across edits yet.
- Export renders Mermaid diagrams with Mermaid's own renderer; a diagram that fails to render keeps its source block and is counted in the export report.
- Editing a remote document and saving writes a local copy through Save As; the remote URL is never written back.
- Session restore reads file contents lazily: only the active tab is loaded at start, others load when selected. A moved or deleted file is marked missing rather than recreated.
- The 200 KB performance target is missed (see above). The 5 MB case is not interactive by design; the preview is opt-in.
- No auto-update, code signing or installer branding beyond the generated icon.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `failed to run 'cargo metadata' ... program not found` | `cargo` is not on `PATH`. Add `%USERPROFILE%\.cargo\bin` and open a new terminal. |
| `link.exe not found` during `cargo build` | Install Visual Studio 2022 Build Tools with the C++ workload and Windows 11 SDK. |
| Blank window in the packaged app | A CSP violation. Open the WebView2 devtools (`Ctrl+Shift+I` in a debug build) and check the console; report the blocked source. |
| Settings not saved | The app data directory may be read-only. The status bar reports the failure; unsaved buffer content is never discarded. |
| Images missing from a preview | Relative paths resolve against the document's folder. Pasted documents without a known folder show a notice and keep paths unresolved. |
