# Markdown Editor {version}

A local-first Markdown viewer and editor for Windows. This build was produced by
GitHub Actions from the `v{version}` tag.

## Download

| File | Use |
|---|---|
| `Markdown Editor_{version}_x64-setup.exe` | **Install this.** Per-user, no admin prompt. |
| `Markdown Editor_{version}_x64_en-US.msi` | For managed deployment (Group Policy, Intune). |

## What it does

- **Read / Edit / Split** modes, with the split pane scrolling in step
- **Tabs**, each remembering its own mode, cursor and scroll position
- **GitHub-flavoured Markdown**: tables, task lists, footnotes, strikethrough, autolinks
- **KaTeX** math and **Mermaid** diagrams, rendered locally
- **Search and replace** with match count, case and whole-word options
- **Outline** panel, **export to standalone HTML**, **print**
- **Light / dark / follow-system** themes
- Restores open tabs and preferences on start
- Local files only: no telemetry, no accounts, no plugins, no remote assets in local documents

## Requirements

- Windows 10 or 11, x64 (ARM64 runs this build under emulation)
- **WebView2 Runtime**: preinstalled on Windows 11 and updated Windows 10. If missing, the installer downloads Microsoft's bootstrapper (~2 MB) and needs a network connection.
- No administrator rights, no VC++ redistributable, no .NET or Java. About 13 MB of disk, into `%LOCALAPPDATA%\Markdown Editor`.

## Two things that look like problems but are not

1. **SmartScreen** warns that the publisher is unknown, because the build is unsigned. Choose *More info → Run anyway*. Removing that needs a code-signing certificate, not a code change.
2. **`.md` may not switch to this app automatically.** The installer registers the association, but Windows will not let an installer silently take over a file type another program already claims. Use *Open with → Markdown Editor → Always use this app* once.

## Verification

Every tagged build runs the full test suite before packaging. For the checks
covered and, more importantly, the ones that are not automated, see
[ROADMAP.md](https://github.com/mchandru13/mdeditor/blob/master/ROADMAP.md).
