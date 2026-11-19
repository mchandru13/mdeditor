mod menu;
mod paths;
mod remote;
mod settings;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

/// Result of parsing `--url` and `--file` at startup.
struct StartupArgs {
    url: Option<String>,
    file: Option<String>,
}

fn parse_arg(flag: &str) -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == flag {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
            return Some(value.to_string());
        }
    }
    None
}

#[tauri::command]
fn startup_url(state: State<'_, StartupArgs>) -> Option<String> {
    state.url.clone()
}

#[tauri::command]
fn startup_file(state: State<'_, StartupArgs>) -> Option<String> {
    state.file.clone()
}

#[tauri::command]
fn read_document(path: String) -> Result<paths::DocumentContents, String> {
    paths::read_document(&PathBuf::from(path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_document(path: String, text: String, bom: bool) -> Result<(), String> {
    paths::write_document(&PathBuf::from(path), &text, bom).map_err(|err| err.to_string())
}

/// Last-modified time in milliseconds since the Unix epoch, used to detect
/// changes made to an open file by another program.
#[tauri::command]
fn modified_time(path: String) -> Result<u64, String> {
    paths::modified_time(&PathBuf::from(path)).map_err(|err| err.to_string())
}

#[tauri::command]
async fn fetch_remote(url: String) -> Result<remote::RemoteDocument, String> {
    let client = remote::build_client().map_err(|err| err.to_string())?;
    remote::fetch_document(&client, &url)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn allow_asset_dir(app: AppHandle, dir: String) -> Result<(), String> {
    let path = PathBuf::from(dir);
    if !path.is_dir() {
        return Err(format!("Not a directory: {}", path.display()));
    }
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;

    match settings::load_raw(&dir) {
        Ok(settings::LoadOutcome::Loaded(raw)) => Ok(Some(raw)),
        Ok(settings::LoadOutcome::Recovered { backup }) => {
            eprintln!("settings were corrupt; backup kept at {}", backup.display());
            Ok(None)
        }
        Ok(settings::LoadOutcome::Missing) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    settings::save_atomic(&dir, &json).map_err(|err| err.to_string())
}

/// Called only after the frontend has resolved unsaved changes.
#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    window.destroy().map_err(|err| err.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup = StartupArgs {
        url: parse_arg("--url"),
        file: parse_arg("--file"),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(startup)
        .invoke_handler(tauri::generate_handler![
            startup_url,
            startup_file,
            read_document,
            write_document,
            modified_time,
            fetch_remote,
            allow_asset_dir,
            load_settings,
            save_settings,
            close_window
        ])
        .setup(|app| {
            // Windows are created from config before this hook runs, so the menu
            // must be attached to the main window explicitly; `set_menu` alone
            // only applies to windows created later.
            let menu = menu::build(app.handle())?;
            if let Some(window) = app.get_webview_window("main") {
                window.set_menu(menu)?;
            } else {
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            // The frontend performs the action so menu, toolbar and shortcuts
            // share one implementation.
            let _ = app.emit(menu::MENU_EVENT, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.emit("mdeditor://close-requested", ());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
