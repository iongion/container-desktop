//! `cdc-runtime/src/adapters/` — one test file per source file.
//!
//! No file for `base_urls.rs`: it is three constants, and asserting a constant equals itself proves
//! nothing. What is load-bearing about them — which prefix a [`Root::Surface`] call gets, and that a
//! lifecycle call is given 60s where an ordinary one is untimed — is asserted in `shared.rs`.
//!
//! Every fixture body here is a REAL capture from podman 5.7.0 or Docker 29.7.0 on the machine this
//! was written on.

#[path = "../fakes/mod.rs"]
mod fakes;

mod containers;
mod images;
mod networks;
mod pods;
mod pods_rest;
mod secrets;
mod shared;
mod swarm;
mod swarm_net;
mod system_df;
mod volumes;

use std::sync::{Arc, Mutex};

use cdc_runtime::adapters::shared::EngineApi;
use cdc_runtime::capabilities::http::{Endpoint, HttpError, HttpRequest, HttpResponse};
use cdc_runtime::domain::types::engine::ApiSurface;

use fakes::FakeHttp;

/// What the engine was asked, shared by every helper here.
pub type Log = Arc<Mutex<Vec<HttpRequest>>>;

/// The address every fixture's engine is at, and the header the daemon selects on — both already
/// resolved, as an adapter receives them.
pub const SOCKET: &str = "/run/user/1000/podman/podman.sock";
pub const HOST_HEADER: &str = "d";

/// The connection's own headers: `Host` plus the two content headers `api_headers` sends.
pub fn connection_headers() -> Vec<(String, String)> {
    vec![
        ("Host".to_string(), HOST_HEADER.to_string()),
        ("Accept".to_string(), "application/json".to_string()),
        ("Content-Type".to_string(), "application/json".to_string()),
    ]
}

/// An engine that answers every request the same way, and the log of what it was asked.
pub fn bound(surface: ApiSurface, http: FakeHttp) -> (EngineApi, Arc<Mutex<Vec<HttpRequest>>>) {
    let asked = http.log();
    let api = EngineApi::new(
        Arc::new(http),
        Endpoint::UnixSocket(SOCKET.to_string()),
        connection_headers(),
        surface,
    );
    (api, asked)
}

/// An engine answering `200` with this body, whatever is asked of it.
pub fn serving(surface: ApiSurface, body: &str) -> (EngineApi, Arc<Mutex<Vec<HttpRequest>>>) {
    let body = body.to_string();
    bound(
        surface,
        FakeHttp::scripted(move |_| Ok(fakes::answered(200, &body))),
    )
}

/// An engine answering by PATH, so a call that fans out to two routes can be told apart. The last
/// arm is what an unmatched path gets.
pub fn routed(
    surface: ApiSurface,
    routes: &'static [(&'static str, u16, &'static str)],
) -> (EngineApi, Arc<Mutex<Vec<HttpRequest>>>) {
    bound(
        surface,
        FakeHttp::scripted(move |request: &HttpRequest| {
            for (path, status, body) in routes {
                if request.path.starts_with(path) {
                    return Ok(fakes::answered(*status, body));
                }
            }
            Err(HttpError::Unreachable {
                endpoint: request.endpoint.clone(),
                reason: format!("no fixture for {}", request.path),
            })
        }),
    )
}

/// What the engine was asked, in order.
pub fn asked(log: &Arc<Mutex<Vec<HttpRequest>>>) -> Vec<HttpRequest> {
    log.lock().expect("asked").clone()
}

/// The one request a call is expected to have made.
pub fn only(log: &Arc<Mutex<Vec<HttpRequest>>>) -> HttpRequest {
    let requests = asked(log);
    assert_eq!(requests.len(), 1, "expected exactly one request");
    requests.into_iter().next().expect("one request")
}

/// A response with a reason phrase and a body, which is what a refusal has to carry.
pub fn refused(status: u16, status_text: &str, body: &str) -> HttpResponse {
    HttpResponse {
        status,
        status_text: status_text.to_string(),
        headers: Vec::new(),
        body: body.to_string(),
    }
}
