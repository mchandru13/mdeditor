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
    Command { id: "file.print", label: "Print…", accelerator: Some("CmdOrCtrl+P") },
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
    Command { id: "help.shortcuts", label: "Keyboard Shortcuts", accelerator: None },
    Command { id: "help.about", label: "About Markdown Editor", accelerator: None },
];

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
    let file_items = items(app, &[&COMMANDS[0..12]])?;
    let file = Submenu::with_items(app, "File", true, &refs(&file_items))?;

    // Cut/copy/paste/select-all are OS items: they act on whatever has focus, so
    // they sit between Undo/Redo and Find, as they always have.
    let mut edit_items = items(app, &[&COMMANDS[12..14]])?;
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.push(Box::new(PredefinedMenuItem::cut(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::copy(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::paste(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::select_all(app, None)?));
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.extend(items(app, &[&COMMANDS[14..16]])?);
    edit_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    edit_items.extend(items(app, &[&COMMANDS[16..20]])?);
    let edit = Submenu::with_items(app, "Edit", true, &refs(&edit_items))?;

    let theme_items = items(app, &[&COMMANDS[20..23]])?;
    let theme = Submenu::with_items(app, "Theme", true, &refs(&theme_items))?;

    let mut view_items = items(app, &[&COMMANDS[23..29]])?;
    view_items.push(Box::new(PredefinedMenuItem::separator(app)?));
    view_items.push(Box::new(theme));
    let view = Submenu::with_items(app, "View", true, &refs(&view_items))?;

    let help_items = items(app, &[&COMMANDS[29..31]])?;
    let help = Submenu::with_items(app, "Help", true, &refs(&help_items))?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}

#[cfg(test)]
mod tests {
    //! Assertions about the menu description, runnable without a window.
    use super::*;

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
