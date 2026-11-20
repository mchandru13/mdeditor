//! Navigation guard.
//!
//! The webview is a document viewer for untrusted input. Nothing in the app
//! intends to navigate the main webview away from its own origin, but a
//! rendered SVG can contain an anchor, and Mermaid `click` directives produce
//! exactly that. An anchor that escapes the app origin replaces the UI with a
//! foreign page inside the app window; this guard makes that impossible at the
//! engine level rather than relying on every renderer to sanitize links.
//!
//! Allowed: the bundled app origin, and the Vite dev server when running under
//! `tauri dev`. Everything else is cancelled. External links are still opened in
//! the system browser, but by the opener plugin on an explicit click, never by
//! navigating this window.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime, Url,
};

/// Returns true when `url` is one of the app's own origins.
fn is_allowed(url: &Url, dev: bool) -> bool {
    let scheme = url.scheme();

    // Windows and Linux serve the bundle from http(s)://tauri.localhost,
    // macOS from tauri://localhost.
    if matches!(
        (scheme, url.host_str()),
        ("http" | "https", Some("tauri.localhost")) | ("tauri", Some("localhost"))
    ) {
        return true;
    }

    // `tauri dev` loads http://localhost:1420. Only debug builds allow it, so a
    // release binary cannot be pointed at a local server.
    if dev && scheme == "http" && url.host_str() == Some("localhost") && url.port() == Some(1420) {
        return true;
    }

    false
}

fn is_app_origin(url: &Url) -> bool {
    is_allowed(url, cfg!(debug_assertions))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let allowed = is_app_origin(url);
            if !allowed {
                eprintln!("blocked navigation to {url}");
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::is_allowed;
    use tauri::Url;

    fn url(value: &str) -> Url {
        Url::parse(value).expect("url")
    }

    #[test]
    fn allows_the_bundled_app_origin() {
        assert!(is_allowed(&url("http://tauri.localhost/"), false));
        assert!(is_allowed(&url("https://tauri.localhost/index.html"), false));
        assert!(is_allowed(&url("tauri://localhost/index.html"), false));
    }

    #[test]
    fn blocks_remote_pages() {
        assert!(!is_allowed(&url("https://example.com/escape"), false));
        assert!(!is_allowed(&url("http://127.0.0.1:4455/pwn"), false));
        assert!(!is_allowed(&url("http://localhost:1420/"), false));
    }

    #[test]
    fn allows_the_dev_server_only_in_dev() {
        assert!(is_allowed(&url("http://localhost:1420/"), true));
        assert!(!is_allowed(&url("http://localhost:9999/"), true));
        assert!(!is_allowed(&url("https://localhost:1420/"), true));
    }

    #[test]
    fn blocks_other_schemes() {
        assert!(!is_allowed(&url("file:///C:/Windows/win.ini"), false));
        assert!(!is_allowed(&url("javascript:alert(1)"), false));
        assert!(!is_allowed(&url("about:blank"), false));
    }

    #[test]
    fn blocks_lookalike_hosts() {
        assert!(!is_allowed(&url("https://tauri.localhost.example.com/"), false));
        assert!(!is_allowed(&url("https://evil.test/tauri.localhost"), false));
    }
}
