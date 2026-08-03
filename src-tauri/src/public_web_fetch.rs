// Native address-pinned public web fetch for the AI web-search tool. The webview names a URL and the set of
// addresses its SSRF guard already validated public; this module independently RE-validates each address is public
// (defense in depth — the JS guard stays authoritative), pins the connection to one of them (keeping the URL's
// Host header + TLS SNI), follows NO redirect (the guard walks them), and streams the body back over a Channel.
// No credential/keychain access ever happens on this path — that is the provider_transport module's job.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::async_runtime::{self, JoinHandle};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

#[derive(Deserialize)]
pub(crate) struct PublicFetchPayload {
    pub url: String,
    pub addresses: Vec<String>,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublicFetchHandle {
    pub stream_id: String,
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
}

#[derive(Default)]
pub struct PublicWebFetchState {
    streams: Mutex<HashMap<String, JoinHandle<()>>>,
    counter: AtomicU64,
}

impl PublicWebFetchState {
    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("web-{n}")
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

// Control events cross the Channel as JSON; body chunks cross as InvokeResponseBody::Raw. Mirrors
// provider_transport::StreamEvent exactly — the body is opaque bytes, so a utf8 conversion would corrupt any
// codepoint split across a chunk boundary.
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
        Self {
            stream_id: stream_id.into(),
            event_type: "end".into(),
            payload: None,
        }
        .into_ipc()
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

// Build a reqwest client pinned to the caller's PUBLIC addresses only. No redirects (the JS guard walks them),
// no re-resolution: reqwest connects to the pinned SocketAddr while keeping the URL's Host + TLS SNI.
fn build_pinned_client(
    payload: &PublicFetchPayload,
) -> Result<(reqwest::Client, reqwest::Url, reqwest::Method), String> {
    let url = reqwest::Url::parse(&payload.url).map_err(|_| "AI: invalid URL".to_string())?;
    let scheme = url.scheme();
    if (scheme != "http" && scheme != "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("AI: invalid URL".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "AI: invalid URL".to_string())?
        .to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let method = reqwest::Method::from_bytes(payload.method.as_bytes())
        .map_err(|_| "AI: invalid method".to_string())?;

    // Independent SSRF re-check: keep ONLY addresses this process classifies public.
    let pinned: Vec<SocketAddr> = payload
        .addresses
        .iter()
        .filter(|a| is_public_address(a))
        .filter_map(|a| a.split('%').next().unwrap_or(a).parse::<IpAddr>().ok())
        .map(|ip| SocketAddr::new(ip, port))
        .collect();
    if pinned.is_empty() {
        return Err("AI: no validated public address available".to_string());
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(&host, &pinned)
        .build()
        .map_err(|e| e.to_string())?;
    Ok((client, url, method))
}

/// Issue the pinned request and stream the raw response body back over the Channel. No credential is attached and
/// no redirect is followed — the JS SSRF guard owns URL validation, redirect-walking, the size cap and timeout.
#[tauri::command]
pub async fn public_web_fetch_request(
    payload: PublicFetchPayload,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, PublicWebFetchState>,
) -> Result<PublicFetchHandle, String> {
    let (client, url, method) = build_pinned_client(&payload)?;
    let mut builder = client.request(method, url);
    for (name, value) in payload.headers.iter() {
        builder = builder.header(name, value);
    }
    let response = builder.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|value| (k.as_str().to_string(), value.to_string()))
        })
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
    Ok(PublicFetchHandle {
        stream_id,
        status,
        status_text,
        headers,
    })
}

/// Teardown from the webview's abort or stream cancel.
#[tauri::command]
pub fn public_web_fetch_destroy(stream_id: String, state: State<'_, PublicWebFetchState>) {
    state.remove_and_abort(&stream_id);
}

// Ordinary-public-unicast only, mirroring isBlockedAddress in adapters/webSearch.ts (ipaddr.js range != unicast)
// plus the documented bypass ranges (0.0.0.0, CGNAT, IPv4-mapped-private, benchmarking, reserved).
pub(crate) fn is_public_address(addr: &str) -> bool {
    let host = addr.trim().trim_start_matches('[').trim_end_matches(']');
    let host = host.split('%').next().unwrap_or(host); // drop a zone id
    let ip: IpAddr = match host.parse() {
        Ok(ip) => ip,
        Err(_) => return false,
    };
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => is_public_v4(v4), // judge a mapped v4 by its embedded address
            None => is_public_v6(v6),
        },
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    if ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
    {
        return false;
    }
    let o = ip.octets();
    if o[0] == 0 {
        return false; // 0.0.0.0/8 "this network"
    }
    if o[0] == 100 && (o[1] & 0xc0) == 64 {
        return false; // CGNAT 100.64.0.0/10
    }
    if o[0] == 192 && o[1] == 0 && o[2] == 0 {
        return false; // 192.0.0.0/24 IETF protocol assignments
    }
    if o[0] == 198 && (o[1] == 18 || o[1] == 19) {
        return false; // 198.18.0.0/15 benchmarking
    }
    if o[0] >= 240 {
        return false; // 240.0.0.0/4 reserved
    }
    true
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
        return false;
    }
    let s = ip.segments();
    if (s[0] & 0xfe00) == 0xfc00 {
        return false; // unique-local fc00::/7
    }
    if (s[0] & 0xffc0) == 0xfe80 {
        return false; // link-local fe80::/10
    }
    if s[0] == 0x2001 && s[1] == 0x0db8 {
        return false; // documentation 2001:db8::/32
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{build_pinned_client, is_public_address, PublicFetchPayload};
    use std::collections::HashMap;

    fn payload(url: &str, addrs: &[&str]) -> PublicFetchPayload {
        PublicFetchPayload {
            url: url.into(),
            addresses: addrs.iter().map(|a| a.to_string()).collect(),
            method: "GET".into(),
            headers: HashMap::new(),
        }
    }

    #[test]
    fn refuses_when_no_address_is_public() {
        let err = build_pinned_client(&payload("https://example.com", &["10.0.0.1", "127.0.0.1"]))
            .unwrap_err();
        assert!(
            err.contains("no validated public address"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn refuses_a_non_http_url() {
        let err = build_pinned_client(&payload("file:///etc/passwd", &["1.1.1.1"])).unwrap_err();
        assert!(err.contains("invalid"), "unexpected: {err}");
    }

    #[test]
    fn pins_only_the_public_addresses() {
        // Mixed list: the private one is dropped, the public one is pinned. build succeeds.
        assert!(
            build_pinned_client(&payload("https://example.com", &["10.0.0.1", "1.1.1.1"])).is_ok()
        );
    }

    #[test]
    fn accepts_ordinary_public_addresses() {
        assert!(is_public_address("1.1.1.1"));
        assert!(is_public_address("140.82.121.4"));
        assert!(is_public_address("2606:4700:4700::1111"));
    }

    #[test]
    fn rejects_non_public_and_bypass_ranges() {
        for a in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254", // cloud metadata (link-local)
            "0.0.0.0",         // unspecified (activitypub-federation bypass)
            "100.64.0.1",      // CGNAT 100.64/10
            "198.18.0.1",      // benchmarking
            "240.0.0.1",       // reserved 240/4
            "::1",             // v6 loopback
            "::ffff:10.0.0.1", // IPv4-mapped private
            "fc00::1",         // unique-local
            "fe80::1",         // v6 link-local
            "2001:db8::1",     // documentation
            "not-an-ip",
        ] {
            assert!(!is_public_address(a), "should reject {a}");
        }
    }
}
