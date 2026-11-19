# mdeditor — implementation plan

Companion to `prompt.txt`. This file is the execution order, the load-bearing
contracts, and the cut lines. It is a working document, not a deliverable.

## Environment

- Node 24.13.0 / npm 11.21.1, git 2.56.0, WebView2 157
- rustc/cargo 1.100.0, target `x86_64-pc-windows-msvc`
- VS 2022 Build Tools: VC.Tools.x86.x64 + Windows11SDK.22621 (link.exe)
- Session is **not** elevated; `cargo`/`rustup` live in `%USERPROFILE%\.cargo\bin`
  and must be referenced by absolute path when PATH is stale.

## Contracts (fixed before code, because everything depends on them)

### 1. Document model — `src/state/documents.ts`

```ts
type DocId = string;                      // uuid, stable for tab lifetime
type DocOrigin =
  | { kind: 'file'; path: string; dir: string }
  | { kind: 'remote'; url: string; finalUrl: string; baseUrl: string }
  | { kind: 'pasted'; baseDir: string | null };

interface DocState {
  id: DocId;
  title: string;
  origin: DocOrigin | null;               // null = untitled scratch document
  source: string;                         // authoritative, never derived
  savedSource: string | null;             // last disk/remote content, for dirty check
  dirty: boolean;                         // === (savedSource === null ? source !== '' : source !== savedSource)
  encoding: { bom: boolean; eol: '\n' | '\r\n' };   // restored on save
  status: 'clean' | 'loading' | 'missing' | 'error';
  error?: string;
  scroll: { editor: number; preview: number };
}
```

Invariants:
- `source` is only ever mutated by user edits and file loads. Rendering never writes it.
- `dirty` is computed, never stored independently, so it cannot desync.
- Mode is global (single selector), not per document. Per-tab state is source,
  scroll, TOC and search only.
- `savedSource` is kept separate from `source` so a failed save leaves the buffer intact.

### 2. Platform boundary — `src/platform/index.ts`

Every native call goes through one interface. Tests inject `createFakePlatform()`;
the app injects `createTauriPlatform()`. Components never import `@tauri-apps/*`.

```ts
interface Platform {
  openFileDialog(): Promise<string | null>;
  saveFileDialog(defaultPath?: string): Promise<string | null>;
  readFile(path: string): Promise<{ text: string; bom: boolean }>;
  writeFile(path: string, text: string, bom: boolean): Promise<void>;
  fetchRemote(url: string): Promise<{ text: string; finalUrl: string }>;
  allowAssetDir(dir: string): Promise<void>;
  assetUrl(path: string): string;
  copyText(text: string): Promise<void>;
  readClipboard(): Promise<string>;
  openExternal(url: string): Promise<void>;
  loadSettings(): Promise<unknown>;
  saveSettings(json: string): Promise<void>;
  onDragDrop(cb: (paths: string[]) => void): () => void;
  onCloseRequested(cb: () => void): void;
  confirmDiscard(names: string[]): Promise<boolean>;
  print(): void;
}
```

### 3. Pipeline worker protocol — `src/lib/markdownWorker.ts`

Main thread owns state; the worker owns parsing. Messages:

```ts
{ id: number, type: 'render', source: string, baseUrl: string | null }
→ { id: number, type: 'rendered', blocks: RenderedBlock[] }
→ { id: number, type: 'error', message: string }
```

`RenderedBlock` is *data*, not JSX: `{ kind: 'hast', node: Root }` is avoided —
the worker returns a serialized HAST **string** plus extracted headings and
placeholders, and the main thread converts with `hast-util-to-jsx-runtime`.
Stale results are dropped by `id` comparison, which is also what makes
"typing never blocks on render" true.

Sanitization happens in the worker (it is pure and expensive). The main thread
never accepts an HTML string from any source.

### 4. Export — `src/lib/exportHtml.ts`

Input: sanitized HAST + collected assets. Output: `{ html: string; report }`.
Report fields are the truth for the README: bytes, images embedded, images
remote, diagrams rendered, diagrams failed.

## Milestones and gates

| # | Scope | Gate |
|---|---|---|
| 1 | Scaffold: Tauri 2 + Vite + React + TS, CSP, capabilities, scripts, git | `typecheck`, `lint`, `build`, `tauri:build` |
| 2 | Pipeline: parse → placeholders → sanitize → JSX, worker, slug, highlight, KaTeX/Mermaid components, security corpus | pipeline + security tests |
| 3 | State: documents reducer, tabs, dirty, Read/Edit/Split, shortcuts, close guards | mode/tab tests |
| 4 | Navigation, search, theming | nav/search tests |
| 5 | Files, persistence, export, print | persistence/export tests, `cargo test` |
| 6 | Perf fixtures, benchmarks, Lighthouse, README | full check + measurements |

## Cut lines (if a gate fails and cannot be fixed quickly)

1. Drop the `--url` CLI arg, keep the dialog. (Small loss, same capability.)
2. Drop streaming/chunked rendering above 1 MB; keep the 2 MB preview-off policy.
3. Drop KaTeX font embedding in export; keep the CSS and report "fonts not embedded".
4. Drop the scroll-spy fallback path; require `IntersectionObserver` (available in WebView2).

Never cut: sanitizer schema, close guards, dirty tracking, per-tab isolation,
CSP, or the security test corpus.

## Known risks

- `rehype-sanitize` schema drift vs. highlight.js class names — pin schema in one module, test it.
- Mermaid is heavy (~1 MB); must stay dynamically imported or the bundle gate fails.
- CodeMirror + jsdom: verify tests drive the editor through the state API, not DOM layout.
- MSVC install may need elevation it cannot get from this session; fallback is
  to report the blocker rather than claim a Tauri build.
