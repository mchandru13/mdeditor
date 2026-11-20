//! File access with explicit, narrow rules.
//!
//! Every filesystem entry point in the application funnels through this module:
//! the extension allowlist, the size caps and the BOM handling live here so the
//! behaviour is testable without a running Tauri app.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Upper bound on a single document read or write.
pub const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;

const ALLOWED_EXTENSIONS: [&str; 2] = ["md", "markdown"];

/// Extensions the app may write. `html`/`htm` exist only for the export action,
/// which writes a self-contained file chosen through a save dialog.
const WRITABLE_EXTENSIONS: [&str; 4] = ["md", "markdown", "html", "htm"];

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FsError {
    #[error("Only .md and .markdown files are supported")]
    UnsupportedExtension,
    #[error("File does not exist: {0}")]
    NotFound(String),
    #[error("Path is not a file: {0}")]
    NotAFile(String),
    #[error("File is too large: {size} bytes (limit {limit} bytes)")]
    TooLarge { size: u64, limit: u64 },
    #[error("File is not valid UTF-8")]
    NotUtf8,
    #[error("Could not read file: {0}")]
    Io(String),
}

#[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct DocumentContents {
    pub text: String,
    pub bom: bool,
}

/// Validate an incoming path before it is used.
pub fn validate_document_path(path: &Path) -> Result<PathBuf, FsError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some(ext) if ALLOWED_EXTENSIONS.contains(&ext) => {}
        _ => return Err(FsError::UnsupportedExtension),
    }

    let metadata = fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => FsError::NotFound(path.display().to_string()),
        _ => FsError::Io(err.to_string()),
    })?;

    if !metadata.is_file() {
        return Err(FsError::NotAFile(path.display().to_string()));
    }

    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(FsError::TooLarge {
            size: metadata.len(),
            limit: MAX_DOCUMENT_BYTES,
        });
    }

    Ok(path.to_path_buf())
}

/// Read a document, stripping a leading UTF-8 BOM and reporting its presence so
/// that saving can restore the original byte layout.
pub fn read_document(path: &Path) -> Result<DocumentContents, FsError> {
    let path = validate_document_path(path)?;
    let bytes = fs::read(&path).map_err(|err| FsError::Io(err.to_string()))?;

    let (body, bom) = if bytes.starts_with(UTF8_BOM) {
        (&bytes[UTF8_BOM.len()..], true)
    } else {
        (&bytes[..], false)
    };

    let text = std::str::from_utf8(body)
        .map_err(|_| FsError::NotUtf8)?
        .to_string();

    Ok(DocumentContents { text, bom })
}

/// Last-modified time in milliseconds since the Unix epoch.
pub fn modified_time(path: &Path) -> Result<u64, FsError> {
    let metadata = fs::metadata(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => FsError::NotFound(path.display().to_string()),
        _ => FsError::Io(err.to_string()),
    })?;

    let modified = metadata
        .modified()
        .map_err(|err| FsError::Io(err.to_string()))?;

    modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .map_err(|err| FsError::Io(err.to_string()))
}

/// Write a document atomically, restoring the BOM when the source had one.
///
/// The extension is checked here as well as on read: without it the command is a
/// general-purpose write primitive for anything the user can write, which turns
/// any future script-injection bug into arbitrary file replacement.
pub fn write_document(path: &Path, text: &str, bom: bool) -> Result<(), FsError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some(ext) if WRITABLE_EXTENSIONS.contains(&ext) => {}
        _ => return Err(FsError::UnsupportedExtension),
    }

    if text.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(FsError::TooLarge {
            size: text.len() as u64,
            limit: MAX_DOCUMENT_BYTES,
        });
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(FsError::NotFound(parent.display().to_string()));
        }
    }

    let mut payload = Vec::with_capacity(text.len() + UTF8_BOM.len());
    if bom {
        payload.extend_from_slice(UTF8_BOM);
    }
    payload.extend_from_slice(text.as_bytes());

    let temp_path = path.with_extension(format!(
        "{}.tmp{}",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("md"),
        std::process::id()
    ));

    {
        let mut file = fs::File::create(&temp_path).map_err(|err| FsError::Io(err.to_string()))?;
        file.write_all(&payload)
            .map_err(|err| FsError::Io(err.to_string()))?;
        file.sync_all().map_err(|err| FsError::Io(err.to_string()))?;
    }

    if let Err(err) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(FsError::Io(err.to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, contents: &[u8]) -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(name);
        let mut file = fs::File::create(&path).expect("create");
        file.write_all(contents).expect("write");
        (dir, path)
    }

    #[test]
    fn rejects_unsupported_extensions() {
        let (_dir, path) = temp_file("notes.txt", b"hello");
        assert_eq!(
            read_document(&path).unwrap_err(),
            FsError::UnsupportedExtension
        );
    }

    #[test]
    fn refuses_to_write_outside_the_allowlist() {
        let dir = tempfile::tempdir().expect("temp dir");
        for name in ["run.bat", "payload.ps1", "no-extension", "shell.dll"] {
            let path = dir.path().join(name);
            assert_eq!(
                write_document(&path, "x", false).unwrap_err(),
                FsError::UnsupportedExtension,
                "{name} should not be writable"
            );
            assert!(!path.exists(), "{name} must not be created");
        }
    }

    #[test]
    fn writes_html_for_export_but_not_markdown_only() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("export.html");
        write_document(&path, "<!doctype html><p>x", false).expect("html export");
        assert!(path.exists());

        let md = dir.path().join("notes.MARKDOWN");
        write_document(&md, "# x", false).expect("markdown, case-insensitive");
        assert!(md.exists());
    }

    #[test]
    fn rejects_missing_file() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("gone.md");
        assert!(matches!(
            read_document(&path),
            Err(FsError::NotFound(_))
        ));
    }

    #[test]
    fn detects_and_strips_bom() {
        let (_dir, path) = temp_file("bom.md", b"\xEF\xBB\xBF# Title\r\n");
        let doc = read_document(&path).expect("read");
        assert!(doc.bom);
        assert_eq!(doc.text, "# Title\r\n");
    }

    #[test]
    fn round_trips_crlf_and_bom() {
        let (dir, path) = temp_file("crlf.md", b"\xEF\xBB\xBFone\r\ntwo\r\n");
        let doc = read_document(&path).expect("read");
        write_document(&path, &doc.text, doc.bom).expect("write");
        let bytes = fs::read(&path).expect("bytes");
        assert_eq!(bytes, b"\xEF\xBB\xBFone\r\ntwo\r\n");
        drop(dir);
    }

    #[test]
    fn round_trips_without_bom() {
        let (dir, path) = temp_file("plain.md", b"# hi\n");
        let doc = read_document(&path).expect("read");
        assert!(!doc.bom);
        write_document(&path, &doc.text, doc.bom).expect("write");
        assert_eq!(fs::read(&path).expect("bytes"), b"# hi\n");
        drop(dir);
    }

    #[test]
    fn rejects_invalid_utf8() {
        let (_dir, path) = temp_file("bad.md", &[0xFF, 0xFE, 0x00]);
        assert_eq!(read_document(&path).unwrap_err(), FsError::NotUtf8);
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let (dir, path) = temp_file("clean.md", b"# a\n");
        write_document(&path, "# b\n", false).expect("write");
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left behind");
    }

    #[test]
    fn reports_modification_time() {
        let (_dir, path) = temp_file("stamp.md", b"# a\n");
        let stamp = modified_time(&path).expect("mtime");
        assert!(stamp > 0);
    }

    #[test]
    fn reports_missing_file_for_modification_time() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("gone.md");
        assert!(matches!(modified_time(&path), Err(FsError::NotFound(_))));
    }
}
