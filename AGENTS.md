# AGENTS.md

Behavioural guidelines for agents working in this repository, adapted from
[Karpathy-inspired guidelines](https://github.com/multica-ai/andrej-karpathy-skills)
(MIT) and grounded in this codebase's actual failure modes.

**Tradeoff:** these bias toward caution over speed. A typo fix does not need the
full ritual; a change to the Markdown pipeline or the Rust commands does.

---

## 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State assumptions explicitly. If an instruction has two readings, say which one
  you picked and why, rather than silently choosing.
- If a simpler approach exists, say so before building the complicated one.
- If something is unclear, stop and ask. This repo has a written spec
  (`docs/spec/prompt.txt`) and a `ROADMAP.md`; ambiguity usually means one of
  them already answers it.
- Do not add "flexibility" or config that was not asked for. Every option is a
  thing to test forever.

## 2. Simplicity first

**Minimum code that solves the problem.**

- No abstraction for a single call site.
- No new dependency when ~40 lines of the existing stack will do. Every
  dependency is also a security and upgrade surface.
- No error handling for states that cannot occur. Where a failure *can* occur,
  fail with a message a user could act on.
- If you write 200 lines and 50 would do, rewrite it before asking for review.

**The test:** would a senior engineer call this overcomplicated? Then simplify.

## 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

- Don't reformat, rename or "improve" code adjacent to your change.
- Don't refactor working code as a side effect. Propose it separately.
- Match the surrounding style, even where you'd do it differently. This codebase
  favours explicit names, comments that explain *why*, and no comment that just
  restates the line.
- Remove imports, variables and tests **your** change orphaned. Leave
  pre-existing dead code alone and mention it.
- Never delete or weaken a test to make a change pass. If a test encoded a bug,
  fix the code and change the test with a note explaining why the old expectation
  was wrong.

**The test:** every changed line traces back to the request.

## 4. Goal-driven execution, with evidence

**Define success criteria, then loop until you have proof.**

| Instead of | Do this |
|---|---|
| "Add validation" | Write the failing case as a test, then make it pass |
| "Fix the icon" | Extract the icon from the built `.exe` and look at it |
| "It should be secure" | Write a payload, run it against the packaged app, read the DOM |
| "The build works" | Run the installer and launch the result |

For multi-step work, state the plan with its verification step:

```
1. change X  → verify: npm test
2. build     → verify: extract the artifact and inspect it
3. ship      → verify: gh run watch exits 0
```

**Never report something as verified that you did not run.** In this repo that
distinction has repeatedly mattered: a config file claimed a CSP the app did not
enforce, an installer claimed a file association it never wrote, and a rebuild
silently kept the old icon. Prefer "I checked X and saw Y" over "this should
work". When you cannot verify something, say so and say what it would take.

---

## Project map

| Path | Responsibility |
|---|---|
| `src/lib/markdownPipeline.ts` | parse → placeholders → sanitize → post-process. **Order is load-bearing.** |
| `src/lib/renderClient.ts`, `markdownWorker.ts` | worker boundary plus degrade-to-inline fallback |
| `src/platform/` | the only module that imports `@tauri-apps/*`; tests swap in `fake.ts` |
| `src/state/` | documents reducer and versioned session persistence |
| `src/App.tsx` | orchestration, menu dispatch, preferences |
| `src-tauri/src/paths.rs` | every filesystem entry point: extension allowlist, size caps, BOM |
| `src-tauri/src/remote.rs` | HTTPS-only fetch, redirect/body/timeout bounds |
| `src-tauri/src/navigation.rs` | cancels every off-origin navigation |
| `src-tauri/src/menu.rs` | native menu ids that `App.tsx` dispatches |
| `design/icon-master.svg` | source of truth for the app icon |
| `docs/spec/prompt.txt` | the specification the app was built against |

## Invariants that must not be weakened

1. **Raw HTML never reaches the DOM.** Markdown HTML nodes become literal text.
   Nothing after the sanitize step may accept an HTML string from the document.
2. **Math and diagrams are placeholders**, rendered by React components from
   source text. KaTeX is `trust: false`; Mermaid is `securityLevel: 'strict'` and
   its SVG passes `isSafeSvg` in both the viewer and the export.
3. **The document cannot reach the network by itself.** Remote images are
   replaced with inert text until the user opts in per document. Fetching happens
   only through the explicit URL action.
4. **Writes stay inside the extension allowlist** (`md`, `markdown`, plus
   `html`/`htm` for export). Reads and writes both check it.
5. **Navigation never leaves the app origin.** The guard is engine-level; do not
   replace it with a React click handler.
6. **Tauri capabilities stay minimal.** There are no `fs:`, `shell:` or `http:`
   plugin permissions. Add a command before adding a plugin.

Changing anything above requires updating `README.md` §Security and
`tests/unit/security.test.ts`.

## Verification

Run what the change touches; run more when unsure.

```bash
npm test                 # 285 Vitest tests
npm run test:rust        # 36 cargo tests
npm run typecheck && npm run lint && npm run build
npm run check:ui         # needs `npm run preview` on :4173 and Edge
npm run check:app        # packaged app over CDP; needs a release build
npm run check:e2e        # full session against the packaged app
npm run check:security   # attack probes against the packaged app
```

Notes that save time:

- `npm run tauri:build` is ~8 minutes; the LTO link dominates. Run it in the
  background and do not poll it.
- `check:app` occasionally fails on a 403 from `raw.githubusercontent.com`. That
  is GitHub throttling the remote test document, not a regression — re-run before
  investigating.
- The CI workflow runs the fast suites only. A green CI does **not** mean the
  packaged checks ran.

## Build and release gotchas

- **The installer must notify the shell after changing the association.** Windows caches file-type icons by icon *path and index*, both of which are identical across versions (`…\mdeditor.exe,0`), so an upgrade that changes only the artwork keeps showing the cached old bitmap. `src-tauri/nsis/hooks.nsh` calls `SHChangeNotify(SHCNE_ASSOCCHANGED)` after install and uninstall for this reason. Removing that hook reintroduces a bug that no amount of rebuilding will reveal — the exe has the right icon while Explorer draws the old one.
- **Version lives in three files** and they must agree: `package.json`,
  `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`. The release workflow
  refuses to publish when they disagree with the tag.
- **Releasing is a tag.** `git tag -a v1.0.x && git push origin v1.0.x` builds
  and publishes; a manual workflow run only builds artifacts. Do not bump a
  version without publishing, or say so if you do.
- **Cargo skips the Windows resource step** when no Rust source changed, so a new
  icon can appear in `src-tauri/icons/` while the `.exe` keeps the old one. Force
  it by changing the version or removing `src-tauri/target/release/build/mdeditor-*`,
  then confirm by extracting the icon from the binary.
- **The icon is generated**, not hand-painted: edit `design/icon-master.svg`,
  then `npm run icon`. Judge changes at 16 px on light *and* dark backgrounds,
  not at 1024 px.
- `npm run` spawns child processes; killing the wrapper can orphan `vite` or the
  app. Kill the listening PID instead.

## Documentation duties

- `README.md` describes the current behaviour. `ROADMAP.md` holds what is
  deliberately out of scope and what is not automated. Keep both true; a stale
  claim is a bug in this project.
- When you fix a security issue, add the payload that would have caught it to
  `npm run check:security` or `tests/unit/security.test.ts`.
- Record verification results with the command that produced them.
