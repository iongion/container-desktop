//! `proxy.ts`, and `resolveConnectionProxy` out of `registryTrust/proxyResolution.ts`.
//!
//! What a connection's engine processes are told about leaving this machine. The whole module is
//! shapes and predicates over a value a user typed, which is why it is here and not in a host: the
//! only impure part is who reads the settings and who spawns the process.
//!
//! **What is deliberately NOT ported, with what drives it.** `validateProxy` answers a settings FORM,
//! and this core has none — a document is read, not edited, and [`normalize`] is what makes an
//! unusable value harmless. `proxyToChromiumRules` configures a Chromium session. `shouldBypass` is
//! the renderer asking whether ITS request should skip the proxy; every request this core makes is to
//! a unix socket, a named pipe or a child's stdin, so there is no host to match a rule against — what
//! this port emits instead is `NO_PROXY`, which is the same list, answered by the engine. And
//! `redactProxyCreds` guards a LOG: the exec port logs a launcher and its args and never an
//! environment (`host-native/command.rs`), so there is nothing here for it to redact yet.
//!
//! **TLS is the proxy story's other half, and it is not this module's** —
//! `EngineConnectorSettings::certificates` is a per-connection list of CAs that the original installs
//! into the ENGINE's `certs.d` (`registryTrust/certsd.ts`), so the trust store is the engine's and the
//! writer is the registry surface this core excludes. This core's own HTTP client has no TLS at all: it
//! dials a socket, a pipe or a bridge, and `capabilities::http` has no TCP endpoint for a caller to
//! produce. The list is carried through the document untouched.

use percent_encoding::{AsciiSet, CONTROLS, utf8_percent_encode};

use crate::domain::types::network::{
    ConnectionProxyMode, ConnectionProxySettings, ProxyConfig, ProxyMode, ProxyProtocol,
};

/// Always bypassed, ahead of whatever the user added.
///
/// An engine's own loopback traffic must not be sent to a proxy, and the user is not asked to
/// remember that.
pub const DEFAULT_BYPASS: [&str; 3] = ["localhost", "127.0.0.1", "::1"];

/// WHATWG's userinfo percent-encode set, which is what `new URL()` applies in the original.
///
/// The engines reading these variables parse them as URLs, so a password holding `@`, `:` or `/`
/// unencoded names a different host or nothing at all. `CONTROLS` covers C0 and DEL, and
/// [`utf8_percent_encode`] encodes every non-ASCII byte on its own.
const USERINFO: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'`')
    .add(b'{')
    .add(b'}')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'=')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'|');

/// A well-formed proxy from whatever the document held, absence included.
///
/// A disabled proxy is rebuilt from nothing rather than carried with its fields intact, which is the
/// original's shape and the safer one: the host and the credentials of a proxy that is off cannot
/// reach an environment by way of a caller that forgot to ask whether it was on.
pub fn normalize(value: Option<&ProxyConfig>) -> ProxyConfig {
    let Some(value) = value.filter(|value| value.mode == ProxyMode::Manual) else {
        return ProxyConfig {
            mode: ProxyMode::Disabled,
            protocol: ProxyProtocol::Http,
            host: String::new(),
            port: 0,
            username: String::new(),
            password: String::new(),
            bypass: bypass_list(&[]),
        };
    };
    ProxyConfig {
        mode: ProxyMode::Manual,
        protocol: value.protocol,
        host: value.host.trim().to_string(),
        port: value.port,
        username: value.username.clone(),
        password: value.password.clone(),
        bypass: bypass_list(&value.bypass),
    }
}

/// Whether this configuration names somewhere to send traffic.
pub fn is_active(config: &ProxyConfig) -> bool {
    active(&normalize(Some(config)))
}

/// The proxy as a URL, or empty when there is no proxy.
///
/// **`socks5` becomes `socks5h`, and that is the variable's meaning rather than a spelling.** These
/// go to Go programs, where `socks5h` asks the proxy to resolve the name — the host that cannot be
/// resolved from here is exactly the host a proxy exists to reach. The original passes
/// `socksRemoteDNS` only on this path for the same reason, and its undici adapter has to undo it
/// because that library rejects the form; nothing in this core does.
pub fn to_url(config: &ProxyConfig) -> String {
    url_of(&normalize(Some(config)))
}

fn url_of(config: &ProxyConfig) -> String {
    if !active(config) {
        return String::new();
    }
    let scheme = match config.protocol {
        ProxyProtocol::Http => "http",
        ProxyProtocol::Https => "https",
        ProxyProtocol::Socks5 => "socks5h",
    };
    let mut userinfo = String::new();
    if !config.username.is_empty() {
        userinfo.push_str(&encoded(&config.username));
    }
    if !config.password.is_empty() {
        userinfo.push(':');
        userinfo.push_str(&encoded(&config.password));
    }
    if !userinfo.is_empty() {
        userinfo.push('@');
    }
    format!(
        "{scheme}://{userinfo}{}:{}",
        bracketed(&config.host),
        config.port
    )
}

/// What a process is told, or nothing at all.
///
/// Both cases of every name: a Go engine reads the lower-case ones, its libraries the upper-case
/// ones, and there is no agreement between them to rely on. An INACTIVE proxy answers with no
/// variables rather than empty ones — an empty `HTTP_PROXY` is itself a setting, and clients disagree
/// about which one.
pub fn to_env(config: &ProxyConfig) -> Vec<(String, String)> {
    let config = normalize(Some(config));
    if !active(&config) {
        return Vec::new();
    }
    let url = url_of(&config);
    // Commas, where a browser's bypass list is semicolons. Same list, two consumers.
    let no_proxy = config.bypass.join(",");
    [
        ("HTTP_PROXY", &url),
        ("HTTPS_PROXY", &url),
        ("ALL_PROXY", &url),
        ("NO_PROXY", &no_proxy),
        ("http_proxy", &url),
        ("https_proxy", &url),
        ("all_proxy", &url),
        ("no_proxy", &no_proxy),
    ]
    .into_iter()
    .map(|(name, value)| (name.to_string(), value.to_string()))
    .collect()
}

/// The proxy in force for one connection — `off`, its own, or the global one.
///
/// A connection that says nothing inherits, which is what makes the global setting mean anything at
/// all. `override` with no config of its own is still an override: it names no proxy, so there is
/// none, and falling back to the global one would make the two indistinguishable.
pub fn resolve_connection(
    global: Option<&ProxyConfig>,
    per: Option<&ConnectionProxySettings>,
) -> ProxyConfig {
    match per.map(|per| per.mode) {
        Some(ConnectionProxyMode::Off) => normalize(None),
        Some(ConnectionProxyMode::Override) => normalize(per.and_then(|per| per.config.as_ref())),
        _ => normalize(global),
    }
}

/// The same question, asked of a value [`normalize`] has already been through.
///
/// **Every public entry point normalizes first, exactly as the original's do**, and the reason is a
/// defect this module's own tests hit within minutes of being written: a `ProxyConfig` straight out of
/// the document carries the user's bypass list without the loopback defaults, so an environment built
/// from it sends an engine's own local traffic to the proxy.
fn active(config: &ProxyConfig) -> bool {
    config.mode == ProxyMode::Manual && !config.host.is_empty() && config.port > 0
}

/// The defaults, then whatever the user added, each entry once and in the order it was given.
fn bypass_list(raw: &[String]) -> Vec<String> {
    let mut list: Vec<String> = Vec::with_capacity(DEFAULT_BYPASS.len() + raw.len());
    for entry in DEFAULT_BYPASS
        .iter()
        .map(|entry| (*entry).to_string())
        .chain(raw.iter().map(|entry| entry.trim().to_string()))
    {
        if !entry.is_empty() && !list.contains(&entry) {
            list.push(entry);
        }
    }
    list
}

fn encoded(value: &str) -> String {
    utf8_percent_encode(value, USERINFO).to_string()
}

/// An IPv6 literal needs brackets to be a URL authority, and a host that already has them keeps them.
fn bracketed(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        return format!("[{host}]");
    }
    host.to_string()
}
