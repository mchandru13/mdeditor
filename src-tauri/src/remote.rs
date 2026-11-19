//! Remote document fetching: HTTPS only, bounded redirects, bounded body.

use std::time::Duration;

pub const MAX_BODY_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_REDIRECTS: usize = 5;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const TOTAL_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RemoteError {
    #[error("Only HTTPS URLs are supported")]
    InsecureScheme,
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Unable to reach the server: {0}")]
    Network(String),
    #[error("Request timed out")]
    Timeout,
    #[error("Too many redirects")]
    TooManyRedirects,
    #[error("Server responded with HTTP {0}")]
    HttpStatus(u16),
    #[error("Unsupported content type: {0}")]
    UnsupportedContentType(String),
    #[error("Document is too large: {size} bytes (limit {limit} bytes)")]
    TooLarge { size: usize, limit: usize },
    #[error("Response was not valid UTF-8")]
    NotUtf8,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDocument {
    pub text: String,
    pub final_url: String,
}

/// Reject anything that is not an absolute HTTPS URL.
pub fn validate_url(input: &str) -> Result<url::Url, RemoteError> {
    let parsed = url::Url::parse(input.trim()).map_err(|err| RemoteError::InvalidUrl(err.to_string()))?;

    if parsed.scheme() != "https" {
        return Err(RemoteError::InsecureScheme);
    }

    if parsed.host_str().is_none() {
        return Err(RemoteError::InvalidUrl("URL has no host".to_string()));
    }

    Ok(parsed)
}

pub fn build_client() -> Result<reqwest::Client, RemoteError> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .user_agent("mdeditor/1.0")
        .build()
        .map_err(|err| RemoteError::Network(err.to_string()))
}

fn content_type_is_markdown(content_type: Option<&str>, url: &url::Url) -> bool {
    let path_is_markdown = {
        let path = url.path().to_ascii_lowercase();
        path.ends_with(".md") || path.ends_with(".markdown")
    };

    match content_type {
        None => path_is_markdown,
        Some(value) => {
            let mime = value.split(';').next().unwrap_or(value).trim().to_ascii_lowercase();
            mime.starts_with("text/") || mime == "application/octet-stream" || mime == "application/x-markdown"
        }
    }
}

pub async fn fetch_document(client: &reqwest::Client, input: &str) -> Result<RemoteDocument, RemoteError> {
    let url = validate_url(input)?;

    let response = client.get(url.clone()).send().await.map_err(|err| {
        if err.is_timeout() {
            RemoteError::Timeout
        } else if err.is_redirect() {
            RemoteError::TooManyRedirects
        } else {
            RemoteError::Network(err.to_string())
        }
    })?;

    let status = response.status();
    if !status.is_success() {
        return Err(RemoteError::HttpStatus(status.as_u16()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);

    if !content_type_is_markdown(content_type.as_deref(), response.url()) {
        return Err(RemoteError::UnsupportedContentType(
            content_type.unwrap_or_else(|| "unknown".to_string()),
        ));
    }

    if let Some(length) = response.content_length() {
        if length > MAX_BODY_BYTES as u64 {
            return Err(RemoteError::TooLarge {
                size: length as usize,
                limit: MAX_BODY_BYTES,
            });
        }
    }

    let final_url = response.url().to_string();
    let mut response = response;
    let mut body: Vec<u8> = Vec::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|err| RemoteError::Network(err.to_string()))?
    {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(RemoteError::TooLarge {
                size: body.len() + chunk.len(),
                limit: MAX_BODY_BYTES,
            });
        }
        body.extend_from_slice(&chunk);
    }

    let text = String::from_utf8(body).map_err(|_| RemoteError::NotUtf8)?;

    Ok(RemoteDocument { text, final_url })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_https() {
        assert!(validate_url("https://example.com/readme.md").is_ok());
    }

    #[test]
    fn rejects_http() {
        assert_eq!(
            validate_url("http://example.com/readme.md").unwrap_err(),
            RemoteError::InsecureScheme
        );
    }

    #[test]
    fn rejects_other_schemes() {
        for url in [
            "file:///C:/secret.md",
            "data:text/markdown;base64,IyBoaQ==",
            "javascript:alert(1)",
            "ftp://example.com/a.md",
        ] {
            assert!(validate_url(url).is_err(), "{url} should be rejected");
        }
    }

    #[test]
    fn rejects_relative_urls() {
        assert!(validate_url("readme.md").is_err());
    }

    #[test]
    fn accepts_text_content_types() {
        let url = url::Url::parse("https://example.com/doc").expect("url");
        assert!(content_type_is_markdown(Some("text/markdown; charset=utf-8"), &url));
        assert!(content_type_is_markdown(Some("text/plain"), &url));
    }

    #[test]
    fn rejects_binary_content_types() {
        let url = url::Url::parse("https://example.com/doc").expect("url");
        assert!(!content_type_is_markdown(Some("application/pdf"), &url));
        assert!(!content_type_is_markdown(Some("image/png"), &url));
    }

    #[test]
    fn falls_back_to_extension_without_content_type() {
        let md = url::Url::parse("https://example.com/a.md").expect("url");
        let html = url::Url::parse("https://example.com/a.html").expect("url");
        assert!(content_type_is_markdown(None, &md));
        assert!(!content_type_is_markdown(None, &html));
    }

    #[test]
    fn serializes_camel_case_keys_for_the_webview() {
        let document = RemoteDocument {
            text: "# hi".to_string(),
            final_url: "https://example.com/a.md".to_string(),
        };

        let json = serde_json::to_string(&document).expect("serialize");
        assert!(json.contains("\"finalUrl\""), "{json}");
        assert!(!json.contains("final_url"), "{json}");
    }

    #[test]
    fn deserializes_camel_case_payloads() {
        let document: RemoteDocument =
            serde_json::from_str(r#"{"text":"x","finalUrl":"https://e.test/a.md"}"#).expect("parse");
        assert_eq!(document.final_url, "https://e.test/a.md");
    }
}
