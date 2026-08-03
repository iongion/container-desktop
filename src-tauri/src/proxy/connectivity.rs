// Proxy connectivity test — the analog of ProxyService.TestConnectivity: GET a URL (optionally through the
// configured manual proxy) and report reachability + latency. Self-contained: its own payload/config/result
// types and proxy-URL helpers, used by nothing else in the proxy module.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Default)]
pub struct ProxyTestPayload {
    #[serde(default)]
    proxy: ProxyTestConfig,
    url: Option<String>,
    #[serde(rename = "timeoutMs")]
    timeout_ms: Option<u64>,
}

#[derive(Deserialize, Default)]
struct ProxyTestConfig {
    mode: Option<String>,
    protocol: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    #[serde(default)]
    bypass: Vec<String>,
}

#[derive(Serialize)]
pub struct ProxyConnectivityResult {
    ok: bool,
    url: String,
    status: Option<u16>,
    #[serde(rename = "elapsedMs")]
    elapsed_ms: u128,
    #[serde(rename = "proxyActive")]
    proxy_active: bool,
    error: Option<String>,
}

#[tauri::command]
pub async fn proxy_test_connectivity(
    payload: ProxyTestPayload,
) -> Result<ProxyConnectivityResult, ()> {
    let started_at = Instant::now();
    let url = payload.url.unwrap_or_else(|| "http://example.com/".into());
    let proxy_active = proxy_test_active(&payload.proxy);
    let result = async {
        let mut builder = reqwest::Client::builder()
            .timeout(Duration::from_millis(payload.timeout_ms.unwrap_or(10000)));
        if proxy_active {
            builder = builder.proxy(proxy_for_test(&payload.proxy)?);
        }
        let response = builder
            .build()
            .map_err(|e| e.to_string())?
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok::<u16, String>(response.status().as_u16())
    }
    .await;
    Ok(match result {
        Ok(status) => ProxyConnectivityResult {
            ok: status < 500,
            url,
            status: Some(status),
            elapsed_ms: started_at.elapsed().as_millis(),
            proxy_active,
            error: None,
        },
        Err(error) => ProxyConnectivityResult {
            ok: false,
            url,
            status: None,
            elapsed_ms: started_at.elapsed().as_millis(),
            proxy_active,
            error: Some(error),
        },
    })
}

fn proxy_test_active(config: &ProxyTestConfig) -> bool {
    config.mode.as_deref() == Some("manual")
        && config
            .host
            .as_deref()
            .is_some_and(|host| !host.trim().is_empty())
        && config.port.unwrap_or(0) > 0
}

fn host_for_proxy_url(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') && !host.ends_with(']') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn proxy_url_for_test(config: &ProxyTestConfig) -> Result<String, String> {
    let protocol = config.protocol.as_deref().unwrap_or("http");
    let scheme = if protocol == "socks5" {
        "socks5"
    } else {
        protocol
    };
    let host = host_for_proxy_url(config.host.as_deref().unwrap_or_default());
    let port = config.port.unwrap_or(0);
    let mut url =
        reqwest::Url::parse(&format!("{scheme}://{host}:{port}")).map_err(|e| e.to_string())?;
    if let Some(username) = config.username.as_deref().filter(|value| !value.is_empty()) {
        url.set_username(username)
            .map_err(|_| "invalid proxy username".to_string())?;
    }
    if let Some(password) = config.password.as_deref().filter(|value| !value.is_empty()) {
        url.set_password(Some(password))
            .map_err(|_| "invalid proxy password".to_string())?;
    }
    Ok(url.to_string())
}

fn proxy_for_test(config: &ProxyTestConfig) -> Result<reqwest::Proxy, String> {
    let mut proxy = reqwest::Proxy::all(proxy_url_for_test(config)?).map_err(|e| e.to_string())?;
    if !config.bypass.is_empty() {
        proxy = proxy.no_proxy(reqwest::NoProxy::from_string(&config.bypass.join(",")));
    }
    Ok(proxy)
}
