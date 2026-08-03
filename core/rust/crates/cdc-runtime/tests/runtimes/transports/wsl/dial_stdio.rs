//! `WslTransport::resolve_dial_stdio` — the command that reaches an engine inside a distribution.
//!
//! Split from the parent file at the 620-line cap. The subject is one function, and it is the one that
//! makes a WSL connection reachable at all: the uri the transport imposes is a pipe only a relay would
//! answer, and this port has no relay.

use super::{WSL_LAUNCHER, ubuntu, windows, wsl_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::runtimes::composition::Transport;
use cdc_runtime::runtimes::transports::wsl::WslTransport;

#[tokio::test]
async fn the_bridge_is_the_engines_own_dial_stdio_run_through_wsl() {
    // **The whole of how a Windows client reaches an engine in a distribution.** The imposed pipe above
    // is an address that only means something if a relay binds it; this is the command that reaches the
    // engine with no relay at all, and it is what `api.connection.dialStdioCommand` carries.
    //
    // Asserted WHOLE, launcher included: the argv is handed to `Endpoint::Stdio` and spawned verbatim,
    // so `argv[0]` must be the program to run and not something a later layer is expected to prepend.
    let (host, _) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;
    let settings = wsl_settings("Ubuntu");

    assert_eq!(
        WslTransport
            .resolve_dial_stdio(&host, &settings, "unix:///run/user/1000/podman/podman.sock")
            .await,
        vec![
            WSL_LAUNCHER,
            "--distribution",
            "Ubuntu",
            "--exec",
            // The PATH, not the bare name, and it is the guest's: a WSL connection detects its program
            // with `findScopeProgram`, which runs INSIDE the distribution. This follows `wsl.ts`'s own
            // `program.path || program.name` — the same rule `scope_command` uses two functions away, so
            // the bridge enters the distribution the same way everything else does. (The original's
            // Tauri binding spells it `program.name || engine` in `proxy-request.ts`; that is a webview
            // that does not hold the detected path, not a different rule.)
            "/usr/bin/podman",
            "--url",
            "unix:///run/user/1000/podman/podman.sock",
            "system",
            "dial-stdio",
        ],
        "the scheme is normalized off the relay and put back by wsl_args, exactly once"
    );
}

#[tokio::test]
async fn a_distribution_whose_engine_bound_nothing_offers_no_bridge() {
    // No socket means no `--url` to point at, and a bridge without one would silently reach whatever
    // the distribution's default happens to be — which is a different engine from the one this
    // connection resolved. An empty argv is refused by `proxy::endpoint`, so the connection reports
    // `API_SOCKET_UNRESOLVED` instead, which is the honest reason.
    let (host, _) = windows(ubuntu(), |_| CommandExecutionResult::ok("")).await;
    let settings = wsl_settings("Ubuntu");

    assert!(
        WslTransport
            .resolve_dial_stdio(&host, &settings, "")
            .await
            .is_empty(),
        "nothing was resolved to point a bridge at"
    );
}

#[tokio::test]
async fn a_connection_with_no_distribution_offers_no_bridge() {
    // `--distribution ""` enters the DEFAULT distribution, which is whichever one WSL happens to have
    // marked — so a scope that never resolved would reach an engine nobody selected.
    let (host, _) = windows(None, |_| CommandExecutionResult::ok("")).await;
    let settings = wsl_settings("");

    assert!(
        WslTransport
            .resolve_dial_stdio(&host, &settings, "/run/podman.sock")
            .await
            .is_empty(),
        "an unresolved scope names no distribution to enter"
    );
}
