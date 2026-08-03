//! Live WSL verification: an engine inside a distribution, reached from native Windows over
//! `Endpoint::Stdio`. NOT part of the default `cargo test`.
//!
//! **This is the one suite the hermetic tests cannot stand in for**, and the port's own history says
//! why: a rule that rests on what engines do has to be asked of an engine. The stdio transport is
//! tested against `/bin/sh` scripts in `tests/http.rs`, which proves the framing and the process
//! handling and proves nothing at all about `wsl.exe` — whether it passes the argv through unmangled,
//! whether `system dial-stdio` answers HTTP/1.1 the way a socket does, whether the body is chunked.
//!
//! It runs ON Windows, against a real distribution. From the developer's Linux machine that means
//! copying `core/rust` to the `win11` VM and running it there:
//!
//! ```sh
//! rsync -a --delete --exclude target core/rust/ win11:C:/cdc-rust/
//! ssh win11 "cd C:\cdc-rust && cargo test -p cdc-runtime-host-native --features live-wsl \
//!   --test live_wsl -- --nocapture"
//! ```
//!
//! The distribution and the engine inside it are declared by environment, because which distributions
//! exist is a property of the machine and never of this file:
//!
//! ```sh
//! set CDC_LIVE_WSL_DISTRIBUTION=podman-machine-default
//! set CDC_LIVE_WSL_PROGRAM=/usr/sbin/podman
//! set CDC_LIVE_WSL_SOCKET=/run/user/1000/podman/podman.sock
//! set CDC_LIVE_WSL_ENGINE=podman
//! ```
//!
//! With nothing set it SKIPS rather than fails: a machine with no WSL is not a broken machine, and a
//! suite that went red there would be one people learned to ignore.

#![cfg(feature = "live-wsl")]

use cdc_runtime::capabilities::http::{Endpoint, Http, HttpRequest};
use cdc_runtime::domain::types::engine::ContainerEngine;
use cdc_runtime::domain::wsl_args::{WslDialStdio, dial_stdio_args};
use cdc_runtime_host_native::http::TokioHttp;

/// What the engine answers a ping with when it is up — the ORACLE's verdict, and it is the BODY.
const PING_OK: &str = "OK";

/// The distribution to enter, or `None` when this machine has not declared one.
fn declared() -> Option<(String, String, String, ContainerEngine)> {
    let distribution = std::env::var("CDC_LIVE_WSL_DISTRIBUTION").ok()?;
    let program = std::env::var("CDC_LIVE_WSL_PROGRAM").ok()?;
    let socket = std::env::var("CDC_LIVE_WSL_SOCKET").ok()?;
    let engine = match std::env::var("CDC_LIVE_WSL_ENGINE").as_deref() {
        Ok("docker") => ContainerEngine::Docker,
        _ => ContainerEngine::Podman,
    };
    Some((distribution, program, socket, engine))
}

/// The argv exactly as a WSL connection composes it — `WslTransport::resolve_dial_stdio`.
///
/// Built through the same function the transport uses rather than written out here, so this suite
/// cannot pass against a command the product does not send.
fn bridge() -> Option<Endpoint> {
    let (distribution, program, socket, engine) = declared()?;
    let mut argv = vec!["wsl.exe".to_string()];
    argv.extend(dial_stdio_args(&WslDialStdio {
        distribution: &distribution,
        program: &program,
        engine,
        socket_path: &socket,
    }));
    Some(Endpoint::Stdio(argv))
}

#[tokio::test]
async fn a_wsl_engine_answers_a_ping_over_its_own_dial_stdio() {
    let Some(endpoint) = bridge() else {
        eprintln!("SKIPPED: set CDC_LIVE_WSL_DISTRIBUTION / _PROGRAM / _SOCKET");
        return;
    };
    eprintln!("dialling {endpoint:?}");

    let response = TokioHttp
        .request(&HttpRequest::ping(endpoint))
        .await
        .expect("the engine inside the distribution answered");

    eprintln!(
        "status={} server={:?}",
        response.status,
        response
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("server"))
    );
    assert_eq!(response.status, 200);
    assert_eq!(
        response.body.trim(),
        PING_OK,
        "the readiness verdict is the body, not the status"
    );
}

#[tokio::test]
async fn a_wsl_engine_answers_a_real_route_with_json() {
    // `/_ping` is two bytes and could survive almost any framing mistake. `/info` is kilobytes, which
    // is what catches a decoder that mishandles a body arriving across several reads — the class of
    // defect that took a live Docker Desktop to find on the named-pipe transport.
    let Some(endpoint) = bridge() else {
        eprintln!("SKIPPED: set CDC_LIVE_WSL_DISTRIBUTION / _PROGRAM / _SOCKET");
        return;
    };

    let mut request = HttpRequest::ping(endpoint);
    request.path = "/v1.40/info".to_string();
    let response = TokioHttp
        .request(&request)
        .await
        .expect("the engine answered");

    assert_eq!(response.status, 200);
    let parsed: serde_json::Value =
        serde_json::from_str(&response.body).expect("a whole JSON document came back");
    eprintln!(
        "info bytes={} keys={}",
        response.body.len(),
        parsed.as_object().map_or(0, |o| o.len())
    );
    assert!(
        parsed.get("host").is_some() || parsed.get("ID").is_some(),
        "podman answers `host`, docker answers `ID`: {}",
        &response.body[..response.body.len().min(200)]
    );
}

#[tokio::test]
async fn a_wsl_engine_holds_an_event_stream_open_down_the_same_bridge() {
    // **The one thing this bridge has never been asked to do.** Every other use of `Endpoint::Stdio`
    // is a request and a whole response: write, read, done. The connection supervisor
    // (`cdc_server::supervise`) holds `/events` open for the LIFE of a connection and reads the END
    // of it as the signal that the engine went away — so on WSL a watch is a child process whose
    // pipes stay open for hours, and everything about that is different from a two-byte `/_ping`.
    //
    // What could go wrong here and nowhere else: `wsl.exe` or `dial-stdio` buffering until the child
    // exits (a stream that delivers nothing until it is over is not a stream), the head not arriving
    // until the first event does, or the child being reaped as idle. Only a real distribution says.
    let Some(endpoint) = bridge() else {
        eprintln!("SKIPPED: set CDC_LIVE_WSL_DISTRIBUTION / _PROGRAM / _SOCKET");
        return;
    };

    let mut request = HttpRequest::ping(endpoint);
    request.path = "/events".to_string();
    // Untimed, exactly as `ConnectionMachine::watch_events` sends it: a finite read timeout here is
    // what silently turns an events-first watch into a reconnect poll loop.
    request.timeout = None;

    let open = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        TokioHttp.stream(&request),
    )
    .await
    .expect("the head arrives without waiting for an event")
    .expect("the engine opened the stream");

    eprintln!(
        "events head status={} headers={:?}",
        open.status, open.headers
    );
    assert_eq!(
        open.status, 200,
        "the head must arrive on its own — an engine that answers only once it has something to say \
         cannot be watched"
    );

    // And it STAYS open with nothing happening, which is the state a watch spends its whole life in.
    // A stream that ends by itself would be read as the engine going away, and the connection would
    // flap into `reconnecting` on a healthy engine.
    let mut body = open.body;
    let idle = tokio::time::timeout(std::time::Duration::from_secs(3), body.next_chunk()).await;
    match idle {
        Err(_) => eprintln!("still open after 3s with no events — correct"),
        Ok(Ok(Some(chunk))) => eprintln!(
            "an event arrived, which is also open: {:.120}",
            String::from_utf8_lossy(&chunk)
        ),
        Ok(other) => panic!(
            "the stream ended on its own; a watch would read that as the engine going away: {other:?}"
        ),
    }
}

#[tokio::test]
async fn a_distribution_that_is_not_there_says_so_rather_than_closing_silently() {
    // The failure this transport actually has, asked of the real `wsl.exe`. It exits having written the
    // reason to stderr and nothing to stdout, and `ChildStdio` is what turns that into the reason a
    // person reads instead of "closed without a reply".
    if declared().is_none() {
        eprintln!("SKIPPED: set CDC_LIVE_WSL_DISTRIBUTION / _PROGRAM / _SOCKET");
        return;
    }
    let endpoint = Endpoint::Stdio(vec![
        "wsl.exe".to_string(),
        "--distribution".to_string(),
        "cdc-no-such-distribution".to_string(),
        "--exec".to_string(),
        "true".to_string(),
    ]);

    let error = TokioHttp
        .request(&HttpRequest::ping(endpoint))
        .await
        .expect_err("there is no such distribution");

    eprintln!("wsl said: {error}");
    let reason = format!("{error}");
    assert!(
        !reason.contains("closed without a reply"),
        "the child's own explanation must reach the caller: {reason}"
    );
}
