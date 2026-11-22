//! Application menu.
//!
//! Items are plain commands with stable ids; the frontend owns the behaviour so
//! that menu actions, toolbar buttons and keyboard shortcuts cannot drift apart.
//! Cut/copy/paste/select-all are predefined items so they act on whatever has
//! focus (a text field or the CodeMirror surface).
//!
//! The command list lives in `COMMANDS` rather than inline so it can be asserted
//! in a test without a window: a menu item whose label or accelerator silently
//! changed is otherwise only noticed by a user.

use std::ops::Range;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const MENU_EVENT: &str = "mdeditor://menu";

/// One app-owned menu entry.
pub struct Command {
    pub id: &'static str,
    pub label: &'static str,
    pub accelerator: Option<&'static str>,
}

/// Marks a separator in [`COMMANDS`].
const SEPARATOR: &str = "-";

/// Every app command, in menu order. `SEPARATOR` entries become separators.
///
/// The ids here are the contract with `App.tsx`; `tests/unit/menu.test.ts`
/// compares the two lists and fails if either side gains or loses one.
pub const COMMANDS: &[Command] = &[
    Command { id: "file.new", label: "New", accelerator: Some("CmdOrCtrl+N") },
    Command { id: "file.open", label: "Open…", accelerator: Some("CmdOrCtrl+O") },
    Command { id: "file.openUrl", label: "Open from URL…", accelerator: None },
    Command { id: "file.clipboard", label: "New from Clipboard", accelerator: None },
    Command { id: SEPARATOR, label: SEPARATOR, accelerator: None },
    Command { id: "file.save", label: "Save", accelerator: Some("CmdOrCtrl+S") },
    Command { id: "file.saveAs", label: "Save As…", accelerator: Some("CmdOrCtrl+Shift+S") },
    Command { id: SEPARATOR, label: SEPARATOR, accelerator: None },
    Command { id: "file.exportHtml", label: "Export HTML…", accelerator: None },
    Command { id: "file.print", label: "Print / Export PDF…", accelerator: Some("CmdOrCtrl+P") },
    Command { id: SEPARATOR, label: SEPARATOR, accelerator: None },
    Command { id: "file.exit", label: "Exit", accelerator: None },
    Command { id: "edit.undo", label: "Undo", accelerator: Some("CmdOrCtrl+Z") },
    Command { id: "edit.redo", label: "Redo", accelerator: Some("CmdOrCtrl+Y") },
    Command { id: "edit.find", label: "Find…", accelerator: Some("CmdOrCtrl+F") },
    Command { id: "edit.replace", label: "Replace…", accelerator: Some("CmdOrCtrl+H") },
    Command { id: "edit.comment", label: "Add Comment…", accelerator: Some("CmdOrCtrl+Shift+M") },
    Command { id: "edit.comment.edit", label: "Edit Comment…", accelerator: None },
    Command { id: "edit.comment.remove", label: "Remove Comment", accelerator: None },
    Command { id: "edit.comment.removeAll", label: "Remove All Comments", accelerator: None },
    Command { id: "view.theme.light", label: "Light", accelerator: None },
    Command { id: "view.theme.dark", label: "Dark", accelerator: None },
    Command { id: "view.theme.system", label: "System", accelerator: None },
    Command { id: "view.read", label: "Read Mode", accelerator: Some("CmdOrCtrl+1") },
    Command { id: "view.edit", label: "Edit Mode", accelerator: Some("CmdOrCtrl+2") },
    Command { id: "view.split", label: "Split Mode", accelerator: Some("CmdOrCtrl+3") },
    Command { id: "view.toc", label: "Toggle Contents", accelerator: None },
    Command { id: "view.syncScroll", label: "Toggle Sync Scroll", accelerator: None },
    Command { id: "view.spellCheck", label: "Toggle Spell Check", accelerator: None },
    Command { id: "view.zoomIn", label: "Zoom In", accelerator: None },
    Command { id: "view.zoomOut", label: "Zoom Out", accelerator: None },
    Command { id: "view.zoomReset", label: "Actual Size", accelerator: None },
    Command { id: "help.shortcuts", label: "Keyboard Shortcuts", accelerator: None },
    Command { id: "help.about", label: "About Markdown Editor", accelerator: None },
];

/// Slices of [`COMMANDS`] rendered as each menu group. Edit is split because the
/// OS-owned clipboard items sit in the middle of it.
///
/// Named rather than written inline: a wrong literal drops menu entries with no
/// error at all, so `every_command_belongs_to_exactly_one_group` walks these and
/// fails instead.
const FILE: Range<usize> = 0..12;
const EDIT_UNDO: Range<usize> = 12..14;
const EDIT_FIND: Range<usize> = 14..16;
const EDIT_COMMENTS: Range<usize> = 16..20;
const THEMES: Range<usize> = 20..23;
const VIEW: Range<usize> = 23..32;
const HELP: Range<usize> = 32..34;

/// Every group above, in menu order. Test-only: `build` uses the constants
/// directly, and an unused constant would warn in every normal build.
#[cfg(test)]
const GROUPS: [Range<usize>; 7] = [FILE, EDIT_UNDO, EDIT_FIND, EDIT_COMMENTS, THEMES, VIEW, HELP];

/// Items, separators and all, for one submenu.
fn items<R: Runtime>(
    app: &AppHandle<R>,
    ranges: &[&[Command]],
) -> tauri::Result<Vec<Box<dyn tauri::menu::IsMenuItem<R>>>> {
    let mut out: Vec<Box<dyn tauri::menu::IsMenuItem<R>>> = Vec::new();
    for range in ranges {
        for command in *range {
            if command.id == SEPARATOR {
                out.push(Box::new(PredefinedMenuItem::separator(app)?));
            } else {
                out.push(Box::new(MenuItem::with_id(
                    app,
                    command.id,
                    command.label,
                    true,
                    command.accelerator,
                )?));
            }
        }
    }
    Ok(out)
}

/// Borrows boxed items for `Submenu::with_items`.
fn refs<R: Runtime>(
    items: &[Box<dyn tauri::menu::IsMenuItem<R>>],
) -> Vec<&dyn tauri::menu::IsMenuItem<R>> {
    items.iter().map(|item| item.as_ref()).collect()
}

/// Builds File / Edit / View / Help. Accelerators match the shortcuts documented
/// in the README; the webview handlers on those keys stay as a fallback.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file_items = items(app, &[&COMMANDS[FILE]])?;
    let file = Submenu::with_items(app, "File", true, &refs(&file_items))?;

    // Cut/copy/paste/select-all are OS items: they act on whatever has focus, so
    // they sit between Undo/Redo and Find, as they always have.
    let mut edit_items = items(app, &[&COMMANDS[EDIT_UNDO]])?;
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.push(Box::new(PredefinedMenuItem::cut(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::copy(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::paste(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::select_all(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.extend(items(app, &[&COMMANDS[EDIT_FIND]])?);
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.extend(items(app, &[&COMMANDS[EDIT_COMMENTS]])?);
    let edit = Submenu::with_items(app, "Edit", true, &refs(&edit_items))?;

    let theme_items = items(app, &[&COMMANDS[THEMES]])?;
    let theme = Submenu::with_items(app, "Theme", true, &refs(&theme_items))?;

    let mut view_items = items(app, &[&COMMANDS[VIEW]])?;
    view_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    view_items.push(Box::new(theme));
    let view = Submenu::with_items(app, "View", true, &refs(&view_items))?;

    let help_items = items(app, &[&COMMANDS[HELP]])?;
    let help = Submenu::with_items(app, "Help", true, &refs(&help_items))?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}

#[cfg(test)]
mod tests {
    //! Assertions about the menu description, runnable without a window.
    use super::*;

    #[test]
    fn print_names_the_pdf_export_it_provides() {
        // `window.print()` is the only PDF path there is (the system dialog's
        // "Microsoft Print to PDF"). The label is where a user looks for it, and
        // a label is cheap to change silently — so pin it.
        let print = COMMANDS
            .iter()
            .find(|command| command.id == "file.print")
            .expect("file.print is declared");
        assert_eq!(
            print.label, "Print / Export PDF…",
            "the menu is the only place Export PDF is discoverable"
        );
        assert_eq!(
            print.accelerator,
            Some("CmdOrCtrl+P"),
            "the accelerator must not change with the label"
        );
    }

    #[test]
    fn every_command_has_a_namespaced_id_and_a_label() {
        for command in COMMANDS {
            if command.id == SEPARATOR {
                continue;
            }
            assert!(command.id.contains('.'), "{} is not a namespaced id", command.id);
            assert!(!command.label.is_empty(), "{} has no label", command.id);
        }
    }

    #[test]
    fn ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for command in COMMANDS {
            if command.id == SEPARATOR {
                continue;
            }
            assert!(seen.insert(command.id), "duplicate menu id: {}", command.id);
        }
    }

    #[test]
    fn every_command_belongs_to_exactly_one_group() {
        // A range literal that is one entry short, or one too long, does not
        // fail to compile: `build` silently drops a menu item or panics at
        // runtime in the windowed app. Walking the groups turns that into a
        // test failure, in order, including separators.
        let covered: Vec<&str> = GROUPS
            .iter()
            .flat_map(|group| COMMANDS[group.clone()].iter())
            .map(|command| command.id)
            .collect();
        let declared: Vec<&str> = COMMANDS.iter().map(|command| command.id).collect();
        assert_eq!(
            covered, declared,
            "the menu ranges no longer cover every command in order"
        );
    }

    #[test]
    fn groups_stay_in_their_own_namespace() {
        // The concatenation test alone accepts a consistent shift: with
        // `VIEW = 23..33` and `HELP = 33..34` every command is still covered
        // exactly once, but `help.shortcuts` appears in the View menu. Checking
        // each group's namespace catches that.
        let groups = [
            (FILE, "file."),
            (EDIT_UNDO, "edit."),
            (EDIT_FIND, "edit."),
            (EDIT_COMMENTS, "edit."),
            (THEMES, "view.theme."),
            (VIEW, "view."),
            (HELP, "help."),
        ];
        for (range, prefix) in groups {
            for command in &COMMANDS[range] {
                if command.id == SEPARATOR {
                    continue;
                }
                assert!(
                    command.id.starts_with(prefix),
                    "{} does not belong in the {} group",
                    command.id,
                    prefix
                );
            }
        }
    }

    #[test]
    fn zoom_lives_in_the_view_menu() {
        // The frontend handles these ids; `tests/unit/menu.test.ts` fails if one
        // side loses the other.
        let zoom: Vec<&str> = COMMANDS[VIEW]
            .iter()
            .filter(|command| command.id.starts_with("view.zoom"))
            .map(|command| command.id)
            .collect();
        assert_eq!(zoom, ["view.zoomIn", "view.zoomOut", "view.zoomReset"]);
    }

    #[test]
    fn add_comment_keeps_its_label_and_native_accelerator() {
        let comment = COMMANDS
            .iter()
            .find(|command| command.id == "edit.comment")
            .expect("edit.comment is declared");
        assert_eq!(comment.label, "Add Comment…");
        // Ctrl+Shift+M, not Ctrl+Alt+M: on layouts where Ctrl+Alt is AltGr the
        // OS turns Ctrl+Alt+M into a character ("ṁ" was observed), so it never
        // reaches either the accelerator or the webview handler.
        assert_eq!(
            comment.accelerator,
            Some("CmdOrCtrl+Shift+M"),
            "the accelerator must avoid AltGr combinations"
        );
    }
}
