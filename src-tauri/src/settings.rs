//! Versioned settings storage: a single JSON document, written atomically, with
//! corruption recovery. The frontend owns the schema; Rust owns durability.

use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SETTINGS_FILE: &str = "settings.json";
pub const MAX_SETTINGS_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum SettingsError {
    #[error("Settings are too large: {size} bytes (limit {limit} bytes)")]
    TooLarge { size: u64, limit: u64 },
    #[error("Settings storage is unavailable: {0}")]
    Unavailable(String),
    #[error("Could not write settings: {0}")]
    Io(String),
}

#[derive(Debug, PartialEq, Eq)]
pub enum LoadOutcome {
    /// No settings file exists yet.
    Missing,
    /// Settings loaded and parsed as JSON.
    Loaded(String),
    /// Settings existed but were unreadable or not JSON; a backup was kept.
    Recovered { backup: PathBuf },
}

pub fn settings_path(dir: &Path) -> PathBuf {
    dir.join(SETTINGS_FILE)
}

fn backup_path(dir: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    dir.join(format!("settings.corrupt-{stamp}.json"))
}

pub fn load_raw(dir: &Path) -> Result<LoadOutcome, SettingsError> {
    let path = settings_path(dir);

    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(LoadOutcome::Missing),
        Err(err) => return Err(SettingsError::Unavailable(err.to_string())),
    };

    if metadata.len() > MAX_SETTINGS_BYTES {
        return Err(SettingsError::TooLarge {
            size: metadata.len(),
            limit: MAX_SETTINGS_BYTES,
        });
    }

    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(err) => return Err(SettingsError::Unavailable(err.to_string())),
    };

    if serde_json::from_str::<serde_json::Value>(&raw).is_err() {
        let backup = backup_path(dir);
        fs::copy(&path, &backup).map_err(|err| SettingsError::Unavailable(err.to_string()))?;
        let _ = fs::remove_file(&path);
        return Ok(LoadOutcome::Recovered { backup });
    }

    Ok(LoadOutcome::Loaded(raw))
}

pub fn save_atomic(dir: &Path, json: &str) -> Result<(), SettingsError> {
    let size = json.len() as u64;
    if size > MAX_SETTINGS_BYTES {
        return Err(SettingsError::TooLarge {
            size,
            limit: MAX_SETTINGS_BYTES,
        });
    }

    if serde_json::from_str::<serde_json::Value>(json).is_err() {
        return Err(SettingsError::Io("refusing to write invalid JSON".to_string()));
    }

    fs::create_dir_all(dir).map_err(|err| SettingsError::Unavailable(err.to_string()))?;

    let path = settings_path(dir);
    let temp = dir.join(format!("{SETTINGS_FILE}.tmp{}", std::process::id()));

    {
        let mut file = fs::File::create(&temp).map_err(|err| SettingsError::Io(err.to_string()))?;
        file.write_all(json.as_bytes())
            .map_err(|err| SettingsError::Io(err.to_string()))?;
        file.sync_all().map_err(|err| SettingsError::Io(err.to_string()))?;
    }

    if let Err(err) = fs::rename(&temp, &path) {
        let _ = fs::remove_file(&temp);
        return Err(SettingsError::Io(err.to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_directory_reports_missing_settings() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert_eq!(load_raw(dir.path()).expect("load"), LoadOutcome::Missing);
    }

    #[test]
    fn saves_and_loads_round_trip() {
        let dir = tempfile::tempdir().expect("temp dir");
        save_atomic(dir.path(), r#"{"version":1}"#).expect("save");
        match load_raw(dir.path()).expect("load") {
            LoadOutcome::Loaded(raw) => assert_eq!(raw, r#"{"version":1}"#),
            other => panic!("unexpected outcome: {other:?}"),
        }
    }

    #[test]
    fn corrupted_settings_are_backed_up_and_removed() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::write(settings_path(dir.path()), "{not json").expect("write corrupt");

        match load_raw(dir.path()).expect("load") {
            LoadOutcome::Recovered { backup } => {
                assert!(backup.exists());
                assert_eq!(fs::read_to_string(backup).expect("backup"), "{not json");
            }
            other => panic!("unexpected outcome: {other:?}"),
        }

        assert_eq!(load_raw(dir.path()).expect("load"), LoadOutcome::Missing);
    }

    #[test]
    fn refuses_invalid_json_on_write() {
        let dir = tempfile::tempdir().expect("temp dir");
        assert!(save_atomic(dir.path(), "not json").is_err());
        assert!(!settings_path(dir.path()).exists());
    }

    #[test]
    fn refuses_oversized_payloads() {
        let dir = tempfile::tempdir().expect("temp dir");
        let huge = "a".repeat(MAX_SETTINGS_BYTES as usize + 1);
        assert!(matches!(
            save_atomic(dir.path(), &huge),
            Err(SettingsError::TooLarge { .. })
        ));
        assert!(!settings_path(dir.path()).exists());
    }

    #[test]
    fn creates_the_directory_on_first_save() {
        let dir = tempfile::tempdir().expect("temp dir");
        let nested = dir.path().join("nested").join("data");
        save_atomic(&nested, r#"{"version":1}"#).expect("save");
        assert!(settings_path(&nested).exists());
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        save_atomic(dir.path(), r#"{"version":1}"#).expect("save");
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }
}
