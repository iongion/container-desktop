// Pure HTTP helpers shared by the buffered + streaming proxy commands: default-header assembly, response-body
// parsing, header flattening, and the Linux Flatpak socket remap. No proxy state or request structs here.

use std::collections::HashMap;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde_json::Value;

// Default headers (mirror the Node driver config) with req.headers overlaid — insert() replaces by name, so
// request headers win. Invalid header names/values are skipped rather than failing the whole request.
pub(super) fn build_headers(overrides: Option<&HashMap<String, String>>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(USER_AGENT, HeaderValue::from_static("Container Desktop"));
    if let Some(overrides) = overrides {
        for (key, value) in overrides {
            if let (Ok(name), Ok(header_value)) = (
                HeaderName::from_bytes(key.as_bytes()),
                HeaderValue::from_str(value),
            ) {
                headers.insert(name, header_value);
            }
        }
    }
    headers
}

// Match axios parsing: json/default → parse (fall back to a string Value on non-JSON); arraybuffer → keep the
// body as a utf8-lossy string (the current string-based contract; the log decoder re-encodes downstream).
pub(super) fn parse_body(bytes: &[u8], response_type: &str) -> Value {
    if response_type == "arraybuffer" {
        return Value::String(String::from_utf8_lossy(bytes).into_owned());
    }
    serde_json::from_slice::<Value>(bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned()))
}

pub(super) fn collect_headers(map: &HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (key, value) in map {
        if let Ok(text) = value.to_str() {
            out.insert(key.as_str().to_string(), text.to_string());
        }
    }
    out
}

// Linux Flatpak sandbox → host socket remap (mirrors Api.clients.ts): /run/user/* → /var/run/user/*,
// everything else → /var/run/host/*. No-op outside Flatpak and off Linux.
#[cfg(target_os = "linux")]
pub(super) fn flatpak_remap(path: String) -> String {
    let in_flatpak =
        std::env::var("FLATPAK_ID").is_ok() || std::path::Path::new("/.flatpak-info").exists();
    if !in_flatpak {
        return path;
    }
    if path.starts_with("/run/user") {
        format!("/var{path}")
    } else {
        format!("/var/run/host{path}")
    }
}
#[cfg(not(target_os = "linux"))]
pub(super) fn flatpak_remap(path: String) -> String {
    path
}
