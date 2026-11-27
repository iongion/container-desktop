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

// A request that got no answer, in words a user can act on: the socket it dialed and the root cause. Never the
// URL reqwest names (`http://d/_ping`): the request travels over the socket and that host is never dialed.
pub(super) fn describe_transport_error(socket: &str, error: reqwest::Error) -> String {
    if error.is_timeout() {
        return format!("{socket} did not answer in time");
    }
    let error = error.without_url();
    let mut cause: &dyn std::error::Error = &error;
    while let Some(next) = cause.source() {
        cause = next;
    }
    format!("{socket} could not be reached: {cause}")
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

#[cfg(all(test, unix))]
mod tests {
    use super::describe_transport_error;
    use std::time::Duration;

    fn socket_path(name: &str) -> String {
        let dir = std::env::temp_dir().join(format!("cd-proxy-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("engine.sock").to_string_lossy().into_owned()
    }

    async fn failed_ping(socket: &str, timeout: Duration) -> reqwest::Error {
        let client = reqwest::Client::builder()
            .unix_socket(socket)
            .build()
            .unwrap();
        client
            .get("http://d/_ping")
            .timeout(timeout)
            .send()
            .await
            .expect_err("nothing answers on this socket")
    }

    #[tokio::test]
    async fn a_missing_socket_names_the_socket_and_why_not_the_placeholder_url() {
        let socket = socket_path("missing");
        let message =
            describe_transport_error(&socket, failed_ping(&socket, Duration::from_secs(2)).await);
        assert_eq!(
            message,
            format!("{socket} could not be reached: No such file or directory (os error 2)")
        );
    }

    #[tokio::test]
    async fn a_socket_that_never_answers_says_so() {
        let socket = socket_path("silent");
        let _ = std::fs::remove_file(&socket);
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let _held = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(5)).await;
            drop(stream);
        });
        let message = describe_transport_error(
            &socket,
            failed_ping(&socket, Duration::from_millis(200)).await,
        );
        assert_eq!(message, format!("{socket} did not answer in time"));
    }
}
