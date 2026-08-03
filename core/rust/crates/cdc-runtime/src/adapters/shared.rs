//! `adapters/shared.ts` — the two engine seams as a value.
//!
//! A non-2xx is a REFUSAL, not `[]`. Every `isOk` check in the original discards the status and the
//! engine's own sentence; [`AdapterError::Refused`] carries both and `.unwrap_or_default()` gets the
//! original's answer back.

use std::sync::Arc;
use std::time::Duration;

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::base_urls::{DOCKER_PATH_PREFIX, LIBPOD_PATH_PREFIX, LIFECYCLE_TIMEOUT};
use crate::capabilities::http::{
    Endpoint, Http, HttpError, HttpHeader, HttpRequest, HttpResponse, HttpStreamOpen,
};
use crate::domain::types::engine::ApiSurface;

/// `encodeURIComponent`'s set. `NON_ALPHANUMERIC` also escapes the nine marks JavaScript leaves, which
/// would send `ps_args=%2Daux`.
const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

/// Applied exactly where the original applies it: the image adapter does NOT encode an id, and an
/// image is addressed by `name:tag`.
pub fn component(value: &str) -> String {
    utf8_percent_encode(value, COMPONENT).to_string()
}

/// Which REST root a call names — a per-call `baseURL`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Root {
    /// The connection's own base, which is what the driver defaults to.
    Connection,
    /// The root the original names explicitly, keyed on [`ApiSurface`] and never on engine identity.
    Surface,
}

#[derive(Debug, thiserror::Error)]
pub enum AdapterError {
    #[error("the engine could not be reached: {0}")]
    Unreachable(#[from] HttpError),
    /// The engine answered, and said no. The body travels: it is the only part a person can act on.
    #[error("the engine refused {method} {path} with {status} {status_text}: {body}")]
    Refused {
        method: String,
        path: String,
        status: u16,
        status_text: String,
        body: String,
    },
    /// A port defect or an engine version this build has not met — never a state of the machine.
    #[error("the engine's answer to {path} is not a shape this port reads: {source}")]
    Malformed {
        path: String,
        #[source]
        source: serde_json::Error,
    },
}

/// One engine request, before it is bound to a connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiCall {
    method: &'static str,
    root: Root,
    /// Path INCLUDING the query string — never a `params` map, which the server's proxy command
    /// refuses (`machine::proxy` answers `ProxyRequestInvalid`).
    path: String,
    body: Option<String>,
    timeout: Option<Duration>,
    headers: Vec<HttpHeader>,
}

impl ApiCall {
    pub fn get(path: impl Into<String>) -> Self {
        Self::new("GET", path)
    }

    pub fn post(path: impl Into<String>) -> Self {
        Self::new("POST", path)
    }

    pub fn delete(path: impl Into<String>) -> Self {
        Self::new("DELETE", path)
    }

    fn new(method: &'static str, path: impl Into<String>) -> Self {
        Self {
            method,
            root: Root::Connection,
            path: path.into(),
            body: None,
            timeout: None,
            headers: Vec::new(),
        }
    }

    pub fn on_surface(mut self) -> Self {
        self.root = Root::Surface;
        self
    }

    pub fn sending(mut self, body: Value) -> Self {
        self.body = Some(body.to_string());
        self
    }

    /// The lifecycle budget instead of the host's default.
    pub fn slow(mut self) -> Self {
        self.timeout = Some(LIFECYCLE_TIMEOUT);
        self
    }

    pub fn as_octet_stream(mut self) -> Self {
        const OCTET_STREAM: &str = "application/octet-stream";
        self.headers
            .push(("Accept".to_string(), OCTET_STREAM.to_string()));
        self.headers
            .push(("Content-Type".to_string(), OCTET_STREAM.to_string()));
        self
    }
}

/// One connection's engine API, bound.
///
/// The address and headers arrive RESOLVED (`machine::proxy::endpoint` / `api_headers`): an adapter
/// that resolved them again could disagree with the readiness probe.
pub struct EngineApi {
    http: Arc<dyn Http>,
    endpoint: Endpoint,
    headers: Vec<HttpHeader>,
    surface: ApiSurface,
}

impl EngineApi {
    pub fn new(
        http: Arc<dyn Http>,
        endpoint: Endpoint,
        headers: Vec<HttpHeader>,
        surface: ApiSurface,
    ) -> Self {
        Self {
            http,
            endpoint,
            headers,
            surface,
        }
    }

    pub fn surface(&self) -> ApiSurface {
        self.surface
    }

    /// Docker itself, or Apple through socktainer.
    pub fn uses_docker_api(&self) -> bool {
        self.surface == ApiSurface::Docker
    }

    pub fn surface_prefix(&self) -> &'static str {
        if self.uses_docker_api() {
            DOCKER_PATH_PREFIX
        } else {
            LIBPOD_PATH_PREFIX
        }
    }

    /// One request, one whole answer.
    pub async fn send(&self, call: &ApiCall) -> Result<HttpResponse, AdapterError> {
        let request = self.request(call);
        let response = self.http.request(&request).await?;
        if !response.ok() {
            return Err(AdapterError::Refused {
                method: call.method.to_string(),
                path: request.path,
                status: response.status,
                status_text: response.status_text,
                body: response.body,
            });
        }
        Ok(response)
    }

    /// The same, read as JSON.
    pub async fn read<T: DeserializeOwned>(&self, call: &ApiCall) -> Result<T, AdapterError> {
        let response = self.send(call).await?;
        serde_json::from_str(&response.body).map_err(|source| AdapterError::Malformed {
            path: self.path_of(call),
            source,
        })
    }

    /// One request whose body arrives over time.
    pub async fn open(&self, call: &ApiCall) -> Result<HttpStreamOpen, AdapterError> {
        let request = self.request(call);
        let stream = self.http.stream(&request).await?;
        if !(200..300).contains(&stream.status) {
            return Err(AdapterError::Refused {
                method: call.method.to_string(),
                path: request.path,
                status: stream.status,
                status_text: stream.status_text,
                // Reading a refused stream's body would be reading the caller's stream.
                body: String::new(),
            });
        }
        Ok(stream)
    }

    /// One request read whole, as BYTES — the only way to read a binary body here.
    ///
    /// [`Http::request`] answers a `String` built with `from_utf8_lossy`, and a log frame's 8-byte
    /// header ends in a big-endian length: a 172-byte payload puts `0xac` on the wire (measured,
    /// podman 5.7.0) and lossy decoding makes the framing unrecoverable. Unbounded, because the caller
    /// chose `tail`; never hand it a `follow`.
    pub async fn drain(&self, call: &ApiCall) -> Result<Vec<u8>, AdapterError> {
        let mut stream = self.open(call).await?;
        let mut collected = Vec::new();
        while let Some(chunk) = stream.body.next_chunk().await? {
            collected.extend_from_slice(&chunk);
        }
        Ok(collected)
    }

    fn request(&self, call: &ApiCall) -> HttpRequest {
        HttpRequest {
            endpoint: self.endpoint.clone(),
            method: call.method.to_string(),
            path: self.path_of(call),
            headers: self.headers_for(call),
            body: call.body.clone(),
            timeout: call.timeout,
        }
    }

    fn path_of(&self, call: &ApiCall) -> String {
        match call.root {
            Root::Connection => call.path.clone(),
            Root::Surface => format!("{}{}", self.surface_prefix(), call.path),
        }
    }

    /// The connection's headers, then the call's own, so a call that names its own `Content-Type`
    /// keeps it.
    fn headers_for(&self, call: &ApiCall) -> Vec<HttpHeader> {
        let mut headers = self.headers.clone();
        for (name, value) in &call.headers {
            match headers
                .iter_mut()
                .find(|(existing, _)| existing.eq_ignore_ascii_case(name))
            {
                Some(existing) => existing.1 = value.clone(),
                None => headers.push((name.clone(), value.clone())),
            }
        }
        headers
    }
}
