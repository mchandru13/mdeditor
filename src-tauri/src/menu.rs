//! Application menu.
//!
//! Items are plain commands with stable ids; the frontend owns the behaviour so
//! that menu actions, toolbar buttons and keyboard shortcuts cannot drift apart.
//! Cut/copy/paste/select-all are predefined items so they act on whatever has
//! focus (a text field or the CodeMirror surface).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

pub const MENU_EVENT: &str = "mdeditor://menu";

/// Builds File / Edit / View / Help. Accelerators match the shortcuts documented
/// in the README; the webview handlers on those keys stay as a fallback.
pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "file.new", "New", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "file.open", "Open…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "file.openUrl", "Open from URL…", true, None::<&str>)?,
            &MenuItem::with_id(app, "file.clipboard", "New from Clipboard", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "file.saveAs",
                "Save As…",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.exportHtml", "Export HTML…", true, None::<&str>)?,
            &MenuItem::with_id(app, "file.print", "Print…", true, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.exit", "Exit", true, None::<&str>)?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "edit.undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "edit.redo", "Redo", true, Some("CmdOrCtrl+Y"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "edit.find", "Find…", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(app, "edit.replace", "Replace…", true, Some("CmdOrCtrl+H"))?,
        ],
    )?;

    let theme = Submenu::with_items(
        app,
        "Theme",
        true,
        &[
            &MenuItem::with_id(app, "view.theme.light", "Light", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.theme.dark", "Dark", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.theme.system", "System", true, None::<&str>)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "view.read", "Read Mode", true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "view.edit", "Edit Mode", true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "view.split", "Split Mode", true, Some("CmdOrCtrl+3"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "view.toc", "Toggle Contents", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.syncScroll", "Toggle Sync Scroll", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.spellCheck", "Toggle Spell Check", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &theme,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "help.shortcuts", "Keyboard Shortcuts", true, None::<&str>)?,
            &MenuItem::with_id(app, "help.about", "About Markdown Editor", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}
