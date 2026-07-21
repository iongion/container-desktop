// Native AI provider transport. The webview names a provider and an endpoint; the key itself is resolved here
// from the OS keychain and attached here, so the secret never enters the webview's JavaScript realm.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::{self, JoinHandle};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

// Auth headers are owned by this module; a webview-supplied header may never set one of them.
const RESERVED_AUTH_HEADERS: [&str; 4] = ["authorization", "proxy-authorization", "x-api-key", "api-key"];

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AuthSettings {
    pub scheme: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(rename = "headerName", default)]
    pub header_name: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct CredentialRef {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "providerKind")]
    pub provider_kind: String,
    pub origin: String,
    pub auth: AuthSettings,
}

// Header names a custom-header scheme may never set, mirroring FORBIDDEN_CUSTOM_AUTH_HEADERS in
// src/packages/platform/src/providerTransport/fetchProviderTransport.ts.
const FORBIDDEN_CUSTOM_AUTH_HEADERS: [&str; 7] = [
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "set-cookie",
    "transfer-encoding",
];

// The request URL is renderer-supplied, so it is pinned to the origin the provider was configured with before
// any secret is attached. Mirrors assertBoundEndpoint in fetchProviderTransport.ts.
fn validate_origin(raw_url: &str, origin: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|_| "AI: invalid provider endpoint".to_string())?;
    let scheme = url.scheme();
    if (scheme != "http" && scheme != "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("AI: invalid provider endpoint".to_string());
    }
    if url.origin().ascii_serialization() != origin {
        return Err("AI: provider request does not match the configured endpoint".to_string());
    }
    Ok(url)
}

fn auth_headers(credential: &CredentialRef, secret: Option<&str>) -> Result<Vec<(String, String)>, String> {
    if credential.auth.scheme == "none" {
        return Ok(Vec::new());
    }
    let secret = secret.ok_or_else(|| "AI: no credential stored for this provider".to_string())?;
    match credential.auth.scheme.as_str() {
        "bearer" => Ok(vec![if credential.provider_kind == "anthropic" {
            ("x-api-key".to_string(), secret.to_string())
        } else {
            ("authorization".to_string(), format!("Bearer {secret}"))
        }]),
        "basic" => {
            use base64::Engine as _;
            let raw = format!("{}:{}", credential.auth.username.as_deref().unwrap_or(""), secret);
            let encoded = base64::engine::general_purpose::STANDARD.encode(raw.as_bytes());
            Ok(vec![("authorization".to_string(), format!("Basic {encoded}"))])
        }
        "header" => {
            let name = credential.auth.header_name.as_deref().unwrap_or("").trim().to_string();
            if name.is_empty() || FORBIDDEN_CUSTOM_AUTH_HEADERS.contains(&name.to_lowercase().as_str()) {
                return Err("AI: invalid custom provider auth header".to_string());
            }
            Ok(vec![(name, secret.to_string())])
        }
        _ => Err("AI: unsupported provider auth scheme".to_string()),
    }
}

#[derive(Deserialize)]
pub(crate) struct ProviderRequestPayload {
    pub credential: CredentialRef,
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<Vec<u8>>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderResponseHandle {
    pub stream_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
}

#[derive(Default)]
pub struct ProviderTransportState {
    client: Mutex<Option<reqwest::Client>>,
    streams: Mutex<HashMap<String, JoinHandle<()>>>,
    counter: AtomicU64,
}

impl ProviderTransportState {
    // One pooled client for every provider call. Redirects are disabled: reqwest follows them by default, and a
    // redirect would replay the resolved key to whatever host the redirect names.
    fn client(&self) -> Result<reqwest::Client, String> {
        if let Some(client) = self.client.lock().unwrap().as_ref() {
            return Ok(client.clone());
        }
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| e.to_string())?;
        *self.client.lock().unwrap() = Some(client.clone());
        Ok(client)
    }

    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("ai-{n}")
    }
    fn register(&self, id: String, handle: JoinHandle<()>) {
        self.streams.lock().unwrap().insert(id, handle);
    }
    fn remove_and_abort(&self, id: &str) {
        if let Some(handle) = self.streams.lock().unwrap().remove(id) {
            handle.abort();
        }
    }
}

// Control events cross the Channel as JSON; body chunks cross as InvokeResponseBody::Raw. The body is opaque
// bytes, so a utf8 conversion would corrupt any codepoint split across a chunk boundary.
#[derive(Serialize)]
struct StreamEvent {
    #[serde(rename = "streamId")]
    stream_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
}

impl StreamEvent {
    fn end(stream_id: &str) -> InvokeResponseBody {
        Self { stream_id: stream_id.into(), event_type: "end".into(), payload: None }.into_ipc()
    }
    fn error(stream_id: &str, message: String) -> InvokeResponseBody {
        Self {
            stream_id: stream_id.into(),
            event_type: "error".into(),
            payload: Some(serde_json::json!({ "message": message })),
        }
        .into_ipc()
    }
    fn into_ipc(self) -> InvokeResponseBody {
        InvokeResponseBody::Json(serde_json::to_string(&self).unwrap_or_else(|_| "{}".to_string()))
    }
}

/// Issue the provider request with the key resolved here, and stream the raw response body back over the
/// Channel. The secret is read from the OS keychain in this process and is never returned to the webview.
#[tauri::command]
pub async fn provider_transport_request(
    payload: ProviderRequestPayload,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, ProviderTransportState>,
) -> Result<ProviderResponseHandle, String> {
    let url = validate_origin(&payload.url, &payload.credential.origin)?;
    let secret = if payload.credential.auth.scheme == "none" {
        None
    } else {
        crate::keychain::keychain_get(payload.credential.provider_id.clone()).await?
    };
    let auth = auth_headers(&payload.credential, secret.as_deref())?;

    let method =
        reqwest::Method::from_bytes(payload.method.as_bytes()).map_err(|_| "AI: invalid method".to_string())?;
    let mut builder = state.client()?.request(method, url);
    for (name, value) in payload.headers.iter() {
        if RESERVED_AUTH_HEADERS.contains(&name.to_lowercase().as_str()) {
            continue;
        }
        builder = builder.header(name, value);
    }
    for (name, value) in auth {
        builder = builder.header(name, value);
    }
    if let Some(body) = payload.body {
        builder = builder.body(body);
    }

    let response = tokio::time::timeout(Duration::from_millis(payload.timeout_ms), builder.send())
        .await
        .map_err(|_| "AI: provider request timed out".to_string())?
        .map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|value| (k.as_str().to_string(), value.to_string())))
        .collect::<HashMap<String, String>>();
    let stream_id = state.next_id();

    let sid = stream_id.clone();
    let handle = async_runtime::spawn(async move {
        let mut stream = response.bytes_stream();
        loop {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    let _ = channel.send(InvokeResponseBody::Raw(chunk.to_vec()));
                }
                Some(Err(err)) => {
                    let _ = channel.send(StreamEvent::error(&sid, err.to_string()));
                    return;
                }
                None => {
                    let _ = channel.send(StreamEvent::end(&sid));
                    return;
                }
            }
        }
    });
    state.register(stream_id.clone(), handle);
    Ok(ProviderResponseHandle { stream_id, status, status_text, headers })
}

/// Teardown from the webview's abort or stream cancel.
#[tauri::command]
pub fn provider_transport_destroy(stream_id: String, state: State<'_, ProviderTransportState>) {
    state.remove_and_abort(&stream_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn credential(scheme: &str, kind: &str) -> CredentialRef {
        CredentialRef {
            provider_id: "openai".into(),
            provider_kind: kind.into(),
            origin: "https://api.openai.com".into(),
            auth: AuthSettings { scheme: scheme.into(), username: None, header_name: None },
        }
    }

    #[test]
    fn rejects_a_url_whose_origin_is_not_the_bound_endpoint() {
        let err = validate_origin("https://attacker.example/v1/messages", "https://api.openai.com").unwrap_err();
        assert!(err.contains("does not match"), "unexpected error: {err}");
    }

    #[test]
    fn rejects_a_non_http_scheme_and_embedded_credentials() {
        assert!(validate_origin("file:///etc/passwd", "file://").is_err());
        assert!(validate_origin("https://user:pass@api.openai.com/v1", "https://api.openai.com").is_err());
    }

    #[test]
    fn accepts_a_url_on_the_bound_origin() {
        let url = validate_origin("https://api.openai.com/v1/chat", "https://api.openai.com").unwrap();
        assert_eq!(url.path(), "/v1/chat");
    }

    #[test]
    fn keyless_providers_get_no_auth_header_and_need_no_secret() {
        let headers = auth_headers(&credential("none", "local"), None).unwrap();
        assert!(headers.is_empty());
    }

    #[test]
    fn anthropic_bearer_uses_x_api_key_and_others_use_authorization() {
        let anthropic = auth_headers(&credential("bearer", "anthropic"), Some("sk-a")).unwrap();
        assert_eq!(anthropic, vec![("x-api-key".to_string(), "sk-a".to_string())]);

        let openai = auth_headers(&credential("bearer", "openai"), Some("sk-o")).unwrap();
        assert_eq!(openai, vec![("authorization".to_string(), "Bearer sk-o".to_string())]);
    }

    #[test]
    fn basic_scheme_base64_encodes_username_and_secret() {
        let mut cred = credential("basic", "openai-compatible");
        cred.auth.username = Some("alice".into());
        let headers = auth_headers(&cred, Some("hunter2")).unwrap();
        assert_eq!(headers, vec![("authorization".to_string(), "Basic YWxpY2U6aHVudGVyMg==".to_string())]);
    }

    #[test]
    fn custom_header_scheme_refuses_a_forbidden_header_name() {
        let mut cred = credential("header", "openai-compatible");
        cred.auth.header_name = Some("Host".into());
        assert!(auth_headers(&cred, Some("secret")).is_err());
    }

    #[test]
    fn a_scheme_that_needs_a_secret_fails_without_one() {
        assert!(auth_headers(&credential("bearer", "openai"), None).is_err());
    }
}
