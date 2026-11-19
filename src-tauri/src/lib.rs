mod paths;
mod remote;
mod settings;

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

/// Result of parsing `--url` at startup.
struct StartupArgs {
    url: Option<String>,
}

fn parse_url_arg() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--url" {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix("--url=") {
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
fn read_document(path: String) -> Result<paths::DocumentContents, String> {
    paths::read_document(&PathBuf::from(path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_document(path: String, text: String, bom: bool) -> Result<(), String> {
    paths::write_document(&PathBuf::from(path), &text, bom).map_err(|err| err.to_string())
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
        url: parse_url_arg(),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(startup)
        .invoke_handler(tauri::generate_handler![
            startup_url,
            read_document,
            write_document,
            fetch_remote,
            allow_asset_dir,
            load_settings,
            save_settings,
            close_window
        ])
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
