// What a request must satisfy before the webview sees it, checked in this order: a loopback Host and an Origin that
// is absent or loopback (the MCP spec's guard against DNS rebinding), the bearer token, `POST /mcp` only, a protocol
// version this server speaks, and a declared body within the cap. Pure, so every rule is tested without a socket.

use std::net::IpAddr;

use hyper::header::{AsHeaderName, HeaderMap, AUTHORIZATION, CONTENT_LENGTH, HOST, ORIGIN};
use hyper::{Method, StatusCode};

use super::token::Token;

pub const MCP_PATH: &str = "/mcp";
pub const PROTOCOL_VERSION_HEADER: &str = "mcp-protocol-version";
pub const MAX_BODY_BYTES: usize = 1024 * 1024;
/// Keep in step with MCP_PROTOCOL_VERSIONS in src/packages/mcp-server/src/core/protocol.ts.
pub const SUPPORTED_PROTOCOL_VERSIONS: [&str; 4] =
    ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

#[derive(Debug, PartialEq, Eq)]
pub struct Rejection {
    pub status: StatusCode,
    pub message: String,
}

impl Rejection {
    pub fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Rejection {
            status,
            message: message.into(),
        }
    }

    pub fn too_large() -> Self {
        Rejection::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            format!("Payload too large: the limit is {MAX_BODY_BYTES} bytes"),
        )
    }
}

fn reject(status: StatusCode, message: impl Into<String>) -> Result<(), Rejection> {
    Err(Rejection::new(status, message))
}

/// The host part of `host[:port]` or `[v6]:port`.
fn host_name(authority: &str) -> &str {
    if let Some(bracketed) = authority.strip_prefix('[') {
        return bracketed.split(']').next().unwrap_or_default();
    }
    match authority.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') && port.bytes().all(|b| b.is_ascii_digit()) => {
            host
        }
        _ => authority,
    }
}

fn is_loopback_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("localhost")
        || name.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// A header's value: None when absent, Err when it is not visible ASCII (which no rule accepts).
fn header(headers: &HeaderMap, name: impl AsHeaderName) -> Option<Result<&str, ()>> {
    headers
        .get(name)
        .map(|value| value.to_str().map_err(|_| ()))
}

fn host_is_loopback(headers: &HeaderMap) -> bool {
    matches!(header(headers, HOST), Some(Ok(host)) if is_loopback_name(host_name(host.trim())))
}

// An origin is `scheme://host[:port]`. Only a web page sends one, and only a loopback page may reach this server.
fn origin_is_allowed(headers: &HeaderMap) -> bool {
    match header(headers, ORIGIN) {
        None => true,
        Some(Ok(origin)) => {
            let authority = origin
                .strip_prefix("http://")
                .or_else(|| origin.strip_prefix("https://"));
            authority.is_some_and(|authority| {
                !authority.contains('/') && is_loopback_name(host_name(authority))
            })
        }
        Some(Err(())) => false,
    }
}

fn bearer_matches(headers: &HeaderMap, token: &Token) -> bool {
    let Some(Ok(value)) = header(headers, AUTHORIZATION) else {
        return false;
    };
    match value.trim().split_once(' ') {
        Some((scheme, presented)) => {
            scheme.eq_ignore_ascii_case("bearer") && token.matches(presented.trim())
        }
        None => false,
    }
}

// An absent header is the handshake's (or an older client's); a present one must name a revision spoken here. A
// client on a newer revision gets a plain 400, never a JSON-RPC error, and falls back to the initialize handshake.
fn version_is_supported(headers: &HeaderMap) -> bool {
    match header(headers, PROTOCOL_VERSION_HEADER) {
        None => true,
        Some(Ok(version)) => SUPPORTED_PROTOCOL_VERSIONS.contains(&version.trim()),
        Some(Err(())) => false,
    }
}

fn declared_length_fits(headers: &HeaderMap) -> bool {
    match header(headers, CONTENT_LENGTH) {
        Some(Ok(length)) => length
            .trim()
            .parse::<u64>()
            .map_or(true, |n| n <= MAX_BODY_BYTES as u64),
        _ => true,
    }
}

pub fn check_request(
    method: &Method,
    path: &str,
    headers: &HeaderMap,
    token: &Token,
) -> Result<(), Rejection> {
    if !host_is_loopback(headers) {
        return reject(
            StatusCode::FORBIDDEN,
            "Forbidden: the Host header must name a loopback address",
        );
    }
    if !origin_is_allowed(headers) {
        return reject(
            StatusCode::FORBIDDEN,
            "Forbidden: a web page may call this server only from a loopback origin",
        );
    }
    if !bearer_matches(headers, token) {
        return reject(
            StatusCode::UNAUTHORIZED,
            "Unauthorized: send `Authorization: Bearer <token>`, with the token from Container Desktop's MCP settings",
        );
    }
    if path != MCP_PATH {
        return reject(
            StatusCode::NOT_FOUND,
            format!("Not found: the MCP endpoint is {MCP_PATH}"),
        );
    }
    if method != Method::POST {
        return reject(
            StatusCode::METHOD_NOT_ALLOWED,
            "Method not allowed: this server takes POST and answers in JSON",
        );
    }
    if !version_is_supported(headers) {
        let supported = SUPPORTED_PROTOCOL_VERSIONS.join(", ");
        return reject(
            StatusCode::BAD_REQUEST,
            format!(
                "Bad request: unsupported MCP-Protocol-Version; this server speaks {supported}"
            ),
        );
    }
    if !declared_length_fits(headers) {
        return Err(Rejection::too_large());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use hyper::header::{HeaderName, HeaderValue};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    // A request that passes every rule, with `changes` applied: a value replaces the header, an empty one removes it.
    fn headers(changes: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        map.insert(HOST, HeaderValue::from_static("127.0.0.1:17627"));
        map.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {TOKEN}")).unwrap(),
        );
        for (name, value) in changes {
            let name = HeaderName::from_bytes(name.as_bytes()).unwrap();
            if value.is_empty() {
                map.remove(name);
            } else {
                map.insert(name, HeaderValue::from_str(value).unwrap());
            }
        }
        map
    }

    fn status_of(method: Method, path: &str, changes: &[(&str, &str)]) -> StatusCode {
        let token = Token::parse(TOKEN).unwrap();
        match check_request(&method, path, &headers(changes), &token) {
            Ok(()) => StatusCode::OK,
            Err(rejection) => rejection.status,
        }
    }

    fn post(changes: &[(&str, &str)]) -> StatusCode {
        status_of(Method::POST, "/mcp", changes)
    }

    #[test]
    fn mcp_admits_a_loopback_post_with_the_token() {
        assert_eq!(post(&[]), StatusCode::OK);
    }

    #[test]
    fn mcp_admits_every_loopback_host_spelling() {
        for host in [
            "127.0.0.1",
            "localhost:17627",
            "LOCALHOST",
            "[::1]:17627",
            "::1",
            "127.1.2.3:80",
        ] {
            assert_eq!(post(&[("host", host)]), StatusCode::OK, "host {host}");
        }
    }

    #[test]
    fn mcp_refuses_a_host_that_is_not_loopback_or_is_missing() {
        for host in [
            "evil.example",
            "evil.example:1",
            "192.168.1.5:1",
            "localhost.evil.example",
            "[::2]:1",
            "",
        ] {
            assert_eq!(
                post(&[("host", host)]),
                StatusCode::FORBIDDEN,
                "host {host:?}"
            );
        }
    }

    #[test]
    fn mcp_takes_an_absent_or_loopback_origin_only() {
        for origin in [
            "http://localhost:3000",
            "http://127.0.0.1",
            "https://[::1]:8443",
        ] {
            assert_eq!(
                post(&[("origin", origin)]),
                StatusCode::OK,
                "origin {origin}"
            );
        }
        for origin in [
            "http://evil.example",
            "null",
            "tauri://localhost",
            "http://localhost.evil.example",
        ] {
            assert_eq!(
                post(&[("origin", origin)]),
                StatusCode::FORBIDDEN,
                "origin {origin}"
            );
        }
        assert_eq!(
            post(&[("origin", "http://127.0.0.1/path")]),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn mcp_answers_401_without_the_right_bearer_token() {
        let wrong = format!("Bearer {}", "f".repeat(64));
        for authorization in [
            wrong.as_str(),
            "Bearer",
            "Basic dXNlcjpwYXNz",
            TOKEN,
            "Bearer 0123",
            "",
        ] {
            assert_eq!(
                post(&[("authorization", authorization)]),
                StatusCode::UNAUTHORIZED,
                "{authorization:?}"
            );
        }
        assert_eq!(
            post(&[("authorization", &format!("bearer {TOKEN}"))]),
            StatusCode::OK
        );
    }

    #[test]
    fn mcp_serves_post_on_its_path_only() {
        assert_eq!(
            status_of(Method::GET, "/mcp", &[]),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(
            status_of(Method::DELETE, "/mcp", &[]),
            StatusCode::METHOD_NOT_ALLOWED
        );
        assert_eq!(status_of(Method::POST, "/", &[]), StatusCode::NOT_FOUND);
        assert_eq!(status_of(Method::POST, "/mcp/", &[]), StatusCode::NOT_FOUND);
        assert_eq!(
            status_of(Method::GET, "/.well-known/oauth-protected-resource", &[]),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn mcp_refuses_an_unsupported_protocol_version_with_a_plain_400() {
        for version in SUPPORTED_PROTOCOL_VERSIONS {
            assert_eq!(
                post(&[("mcp-protocol-version", version)]),
                StatusCode::OK,
                "version {version}"
            );
        }
        let token = Token::parse(TOKEN).unwrap();
        let newer = headers(&[("MCP-Protocol-Version", "2026-07-28")]);
        let rejection = check_request(&Method::POST, "/mcp", &newer, &token).unwrap_err();
        assert_eq!(rejection.status, StatusCode::BAD_REQUEST);
        assert!(
            rejection.message.contains("2025-11-25"),
            "{}",
            rejection.message
        );
        assert!(
            !rejection.message.contains("jsonrpc"),
            "a plain-text body, never JSON-RPC"
        );
    }

    #[test]
    fn mcp_refuses_a_declared_body_over_the_cap() {
        let over = (MAX_BODY_BYTES + 1).to_string();
        let at = MAX_BODY_BYTES.to_string();
        assert_eq!(
            post(&[("content-length", &over)]),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(post(&[("content-length", &at)]), StatusCode::OK);
    }

    #[test]
    fn mcp_checks_host_and_origin_before_the_token() {
        assert_eq!(
            post(&[("origin", "http://evil.example"), ("authorization", "")]),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            post(&[("host", "evil.example"), ("authorization", "")]),
            StatusCode::FORBIDDEN
        );
    }
}
