//! What "the API is up" MEANS ( *What the live run found*; `isApiAvailable` / `isApiRunning`).
//!
//! Until the `Http` capability was wired, `ready` meant "an address was resolved", so a connection
//! whose engine never started reported itself up — the false-ready defect a live run found. These
//! pin the difference an address cannot express: the socket FILE, then the engine's own answer.
//!
//! The three refusals are kept apart on purpose. An unresolved address, a set-but-absent socket and a
//! socket nothing is serving need different fixes — check the settings, check the path, start the
//! engine — and a check that reported one reason for all three would send someone to the wrong place.

use crate::fakes::{FakeCommand, FakeHttp};
use crate::harness::{
    HOME, Harness, PODMAN_SOCKET, connection, engine_is_healthy, engine_socket_bound, linux,
    linux_offering, options, podman, podman_remote, remote_is_healthy, sockets_bound, ssh_scope,
};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::machine::ConnectionContext;
use cdc_runtime::domain::ssh::forward::windows_named_pipe_path;
use cdc_runtime::domain::types::diagnostic::{DiagnosticCode, DiagnosticSeverity};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectionPhase;
use cdc_runtime::runtimes::composition::EngineEnvironment;
use cdc_runtime::runtimes::dialects::container::socktainer_socket;
use cdc_runtime::runtimes::profiles::container::APPLE_SILICON;
use cdc_runtime::runtimes::profiles::docker::{DOCKER_DESKTOP_PIPE, DOCKER_ENGINE_PIPE};

/// A healthy native Podman whose engine answers, or does not, or is not there at all.
fn harness_with(fs: crate::fakes::MemoryFs, http: FakeHttp) -> Harness {
    Harness::with_http(
        options(podman(), false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        fs,
        http,
    )
}

#[tokio::test]
async fn an_engine_that_answers_is_ready() {
    let mut harness = harness_with(engine_socket_bound(), FakeHttp::serving());

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert!(
        harness.machine.availability().api,
        "the engine answered, which is what the api dimension now means"
    );
}

#[tokio::test]
async fn a_bound_socket_with_nothing_listening_is_not_ready() {
    // THE false-ready defect. Every other dimension passes — the OS gate, the program, a resolved
    // address, and the socket file is really there — and nothing is serving on it. Before the probe
    // this reached `ready` and a client believed it.
    let mut harness = harness_with(engine_socket_bound(), FakeHttp::silent());

    harness.connect(0).await;

    assert_eq!(
        harness.machine.phase(),
        ConnectionPhase::Failed,
        "a socket that exists is not an engine that answers"
    );
    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ApiUnreachable
    );
    assert!(
        !harness.machine.availability().api,
        "the report must not claim an api nobody reached"
    );
}

#[tokio::test]
async fn an_absent_socket_names_the_path_rather_than_pinging_it() {
    // `isApiAvailable`'s own words: a set-but-wrong native path is the common failure, and the fix is
    // to correct the path — not to start anything. So it is refused BEFORE the ping, and the refusal
    // carries the path, or the reason would be indistinguishable from a dead engine.
    let mut harness = harness_with(sockets_bound(&[]), FakeHttp::serving());

    harness.connect(0).await;

    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiUnreachable);
    assert_eq!(
        error.params.get("socket").and_then(|it| it.as_str()),
        Some(PODMAN_SOCKET),
        "the path a user has to fix"
    );
    assert!(
        harness.pinged().is_empty(),
        "an address that is not there is not worth a request: {:?}",
        harness.pinged()
    );
}

#[tokio::test]
async fn an_engine_that_answers_unsuccessfully_is_not_ready_and_the_status_is_kept() {
    let mut harness = harness_with(engine_socket_bound(), FakeHttp::answering(500));

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiUnreachable);
    assert_eq!(
        error.params.get("status").and_then(|it| it.as_u64()),
        Some(500),
        "what it answered, so a 500 is not reported as an unreachable socket"
    );
}

#[tokio::test]
async fn the_address_pinged_is_the_one_detection_resolved() {
    // Not the one the connection was configured with: detection replaces it, and pinging the stale
    // address would report the engine down whenever the two disagree.
    let mut harness = harness_with(engine_socket_bound(), FakeHttp::serving());

    harness.connect(0).await;

    let pinged = harness.pinged();
    assert_eq!(pinged.len(), 1, "one request per attempt: {pinged:?}");
    assert_eq!(
        pinged[0].endpoint,
        Endpoint::UnixSocket(PODMAN_SOCKET.to_string())
    );
    assert_eq!(pinged[0].path, "/_ping");
    assert_eq!(pinged[0].method, "GET");
}

#[tokio::test]
async fn a_connection_whose_check_is_skipped_asks_the_engine_nothing() {
    // `skipAvailabilityCheck` skips the whole dimension, so there is no verdict to reach and no
    // request to make. A probe here would be a connection attempt doing I/O the caller opted out of.
    let mut harness = Harness::with_http(
        cdc_runtime::domain::types::connection::ConnectOptions {
            skip_availability_check: true,
            ..options(podman(), false)
        },
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert!(
        harness.pinged().is_empty(),
        "nothing was asked: {:?}",
        harness.pinged()
    );
}

#[tokio::test]
async fn a_scoped_connection_is_not_asked_for_a_local_socket_file() {
    // The socket lives in the GUEST; what is local is the forward the transport just opened, and the
    // filesystem check would refuse a perfectly good remote connection. `isApiAvailable` guards this
    // with the same `!isScoped()`. The ping still happens — that is the point of the forward.
    let mut harness = Harness::with_http(
        options(podman_remote("engine"), false),
        linux_offering(vec![ssh_scope("engine")]),
        FakeCommand::answering(remote_is_healthy),
        sockets_bound(&[]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.phase(),
        ConnectionPhase::Ready,
        "a remote engine is not refused for a file that was never meant to be here"
    );
    assert_eq!(
        harness.pinged().len(),
        1,
        "the forward is what gets pinged: {:?}",
        harness.pinged()
    );
}

/// Docker Desktop on Windows: the connector that EXISTS there and is UNSCOPED.
///
/// `DockerVendorProfile` is `availableUnless(Linux)` and composes with `NativeTransport`
/// (`profiles/docker.rs`, `registry.rs`), which makes it the only fixture that can reach the Windows
/// branch of the local-socket check — a podman-native or docker-native host is refused by its own
/// `availableOn(Linux)` gate long before.
fn docker_desktop_on_windows(fs: crate::fakes::MemoryFs, http: FakeHttp) -> Harness {
    Harness::with_http(
        options(
            connection(
                "docker",
                "docker.virtualized.vendor",
                "docker",
                "http://d",
                "mode.automatic",
            ),
            false,
        ),
        ConnectionContext {
            os: OperatingSystem::WindowsNt,
            ..linux(None)
        },
        // The WINDOWS cascade, not the POSIX one: an unscoped Windows lookup is
        // `ProgramLookup::WindowsLocal`, which asks PowerShell's `gcm` and then the uninstall
        // registry — `which` is never run there at all (`domain/program.rs`).
        FakeCommand::answering(|argv| match argv {
            [_, "-Command", script] if script.contains("gcm") => {
                CommandExecutionResult::ok("C:\\Docker\\docker.exe\n")
            }
            [_, "--version"] => CommandExecutionResult::ok("Docker version 27.0.0"),
            // On Windows the engine is never asked for its context, so nothing else should run.
            _ => CommandExecutionResult::ok(""),
        }),
        fs,
        http,
    )
}

#[tokio::test]
async fn a_windows_pipe_nobody_serves_is_refused_before_the_engine_is_asked() {
    // This replaces the pin that RECORDED the gap. `isApiAvailable` had `// TODO: Check named pipe`
    // and skipped the presence check on Windows entirely, so a Windows connection reached the engine
    // no matter what — and the TODO could not have been closed the obvious way, because a presence
    // check on a pipe used to mean OPENING it (`fs.existsSync` is false for EVERY named pipe, and
    // `Path::exists` consumes an instance to answer). Enumeration made the question safe to ask, so
    // now it is asked, and a Windows address gets the same precise refusal a POSIX socket always did.
    //
    // The filesystem is empty, so `probe_uri` finds no modern pipe and falls back to the legacy one.
    let mut harness = docker_desktop_on_windows(sockets_bound(&[]), nothing_may_be_dialled());

    harness.connect(0).await;

    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiUnreachable);
    assert_eq!(
        error.params.get("socket").and_then(|it| it.as_str()),
        Some(windows_named_pipe_path(DOCKER_ENGINE_PIPE).as_str()),
        "the pipe a user has to start, named as precisely as a missing socket path is"
    );
}

#[tokio::test]
async fn a_windows_connection_reaches_the_pipe_that_is_actually_served() {
    // The other half, and it also pins a branch that could never fire before: `probe_uri` PREFERS
    // `dockerDesktopLinuxEngine` and falls back to `docker_engine`, and that preference is decided by
    // the same presence check. In the oracle it is always false for a pipe, so the fallback was always
    // taken — invisible in production only because Docker Desktop publishes both.
    let mut harness = docker_desktop_on_windows(
        sockets_bound(&[&windows_named_pipe_path(DOCKER_DESKTOP_PIPE)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    let pinged = harness.pinged();
    assert_eq!(pinged.len(), 1, "one request per attempt: {pinged:?}");
    assert_eq!(
        pinged[0].endpoint,
        Endpoint::NamedPipe(windows_named_pipe_path(DOCKER_DESKTOP_PIPE)),
        "the pipe that is served, not the legacy one it would fall back to"
    );
}

#[tokio::test]
async fn a_pipe_uri_carrying_its_scheme_is_dialled_as_a_pipe_path() {
    // `DOCKER_HOST=npipe:////./pipe/custom` reaches `api.connection.uri` untouched, because
    // `normalize_unix_socket_path` keeps an `npipe://` whole on purpose. `api_endpoint` used to wrap
    // whatever it was handed, so the endpoint carried the scheme — and no `CreateFileW` accepts that.
    // Deciding by the ADDRESS instead of by the OS is what canonicalises it.
    const CUSTOM: &str = "custom-engine";
    let mut harness = Harness::with_http(
        options(
            connection(
                "docker",
                "docker.virtualized.vendor",
                "docker",
                "http://d",
                "mode.automatic",
            ),
            false,
        ),
        ConnectionContext {
            os: OperatingSystem::WindowsNt,
            environment: EngineEnvironment {
                docker_host: Some(format!("npipe:////./pipe/{CUSTOM}")),
                ..EngineEnvironment::default()
            },
            ..linux(None)
        },
        FakeCommand::answering(|argv| match argv {
            [_, "-Command", script] if script.contains("gcm") => {
                CommandExecutionResult::ok("C:\\Docker\\docker.exe\n")
            }
            [_, "--version"] => CommandExecutionResult::ok("Docker version 27.0.0"),
            _ => CommandExecutionResult::ok(""),
        }),
        sockets_bound(&[&windows_named_pipe_path(CUSTOM)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    let pinged = harness.pinged();
    assert_eq!(pinged.len(), 1, "the engine was asked: {pinged:?}");
    assert_eq!(
        pinged[0].endpoint,
        Endpoint::NamedPipe(windows_named_pipe_path(CUSTOM)),
        "the scheme is settings vocabulary; a pipe is `\\\\.\\pipe\\NAME` and nothing else"
    );
}

#[tokio::test]
async fn a_pipe_that_answers_nothing_is_what_the_availability_check_refuses() {
    // `DockerVendorProfile::probe_uri`'s own promise: "an install that has neither leaves the
    // availability check to refuse an address that answers nothing". Before the readiness probe that
    // promise could not be kept — the address was resolved, so the connection reported `ready`.
    let mut harness = docker_desktop_on_windows(sockets_bound(&[]), FakeHttp::silent());

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ApiUnreachable
    );
}

#[tokio::test]
async fn an_engine_that_answers_something_other_than_ok_is_not_ready() {
    // `result.success = response?.data === "OK"` is the oracle's whole test, so a `200` carrying
    // anything else is NOT readiness: something is answering on the engine's address that is not the
    // engine. The body is reported, exactly as `details = response?.data` does.
    let mut harness = harness_with(
        engine_socket_bound(),
        FakeHttp::scripted(|_| Ok(crate::fakes::answered(200, "<html>proxy error</html>"))),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiUnreachable);
    assert_eq!(
        error.params.get("body").and_then(|it| it.as_str()),
        Some("<html>proxy error</html>"),
        "what answered, so a proxy is not reported as a dead socket"
    );
}

/// A MANUAL connection carrying `path` and `uri` verbatim — manual so detection replaces neither.
fn manual_connection(path: &str, uri: &str) -> cdc_runtime::domain::types::connection::Connection {
    serde_json::from_value(serde_json::json!({
      "id": "host.manual.podman.native",
      "name": "podman-manual",
      "label": "Manual",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://127.0.0.1:2375", "connection": { "uri": uri, "relay": "" } },
        "program": { "name": "podman", "path": path, "version": "5.6.2" },
        "rootfull": false,
        "mode": "mode.manual"
      }
    }))
    .expect("connection fixture parses")
}

#[tokio::test]
async fn an_address_this_core_cannot_resolve_locally_is_refused_and_never_dialled() {
    // A uri carrying a scheme `normalize_unix_socket_path` does not speak resolves to NOTHING, and the
    // refusal is the point. The only way to turn what is left into an address would be to read a host
    // out of the base URL — `http://127.0.0.1:2375` here — and open a network connection to it. That is
    // outbound reach no caller asked for, so the address is refused and no request is ever built.
    let mut harness = Harness::with_http(
        options(
            manual_connection("/usr/bin/podman", "tcp://127.0.0.1:2375"),
            false,
        ),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        FakeHttp::scripted(|request| {
            panic!("an unresolvable address must not be dialled: {request:?}")
        }),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ApiSocketUnresolved,
        "unresolved, which is a settings problem — not a dead engine and not a host to reach"
    );
    assert!(harness.pinged().is_empty(), "nothing was dialled");
}

#[tokio::test]
async fn a_connection_with_no_base_url_is_refused_before_its_address_is_judged() {
    // `isApiAvailable`'s FIRST refusal, and the last one this port was missing. The base URL is not
    // cosmetic — it selects the `Host` header the daemon expects — so a connection without one cannot
    // form a request even over a socket that is bound and serving, which is exactly the fixture here.
    // Reporting `API_SOCKET_UNRESOLVED` would send a user to check an address that is perfectly fine.
    let mut connection = manual_connection("/usr/bin/podman", PODMAN_SOCKET);
    connection.settings.api.base_url = String::new();
    let mut harness = Harness::with_http(
        options(connection, false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        nothing_may_be_dialled(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ApiBaseUrlNotSet,
        "the setting that is missing, not the address that is not"
    );
    assert!(harness.pinged().is_empty());
}

/// An engine that must never be asked anything, because the question was already answered.
fn nothing_may_be_dialled() -> FakeHttp {
    FakeHttp::scripted(|request| {
        panic!("the engine was asked despite an earlier dimension failing: {request:?}")
    })
}

#[tokio::test]
async fn a_host_gate_that_fails_asks_the_engine_nothing() {
    // The three dimensions the probe rests on are a CONJUNCTION, and this is the half of the proof
    // that `host_ok` is one of them: `podman.native` is `availableOn(Linux)`, so on Windows the gate
    // refuses while the program and the address are both perfectly good. A probe here would report an
    // engine as unreachable when the truth is that this connector cannot run on this machine at all.
    let mut harness = Harness::with_http(
        options(
            manual_connection("C:\\podman.exe", "/run/podman.sock"),
            false,
        ),
        ConnectionContext {
            os: OperatingSystem::WindowsNt,
            ..linux(None)
        },
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        nothing_may_be_dialled(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::EngineNotAvailableOnOs,
        "the gate's own reason, not the api's"
    );
    assert!(harness.pinged().is_empty());
}

/// Apple: the one engine reached through a BRIDGE.
///
/// `container` has no REST API of its own — socktainer serves the Docker surface in front of it — so
/// whether socktainer is installed is a fact the api report has to be able to state. Native Apple is
/// UNSCOPED and macOS-only, and `AppleNativeProfile` gates on the ARCHITECTURE as well as the OS.
fn apple_with(command: FakeCommand, fs: crate::fakes::MemoryFs, http: FakeHttp) -> Harness {
    Harness::with_http(
        options(
            connection(
                "container",
                "container.native",
                "container",
                "http://d",
                "mode.automatic",
            ),
            false,
        ),
        ConnectionContext {
            os: OperatingSystem::Darwin,
            arch: APPLE_SILICON.to_string(),
            ..linux(None)
        },
        command,
        fs,
        http,
    )
}

/// A Mac with `container` installed and NO socktainer: every lookup of it fails, in both cascades.
///
/// **SETTLED ON A REAL MAC, and it was the first branch of the two this comment used to offer**: the
/// banner is real and the shared parse rule was wrong for Apple in both trees. `container --version`
/// prints `container CLI version 1.1.0 (build: release, commit: unspeci)`, whose extra word made the
/// third-token rule read the word "version" as the version. `parse_program_version` reads what follows
/// `version` now, and the fixture carries the real string rather than the guess it was written with.
fn socktainer_missing(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", "container"] => CommandExecutionResult::ok("/opt/homebrew/bin/container\n"),
        [_, "--version"] => CommandExecutionResult::ok(
            "container CLI version 1.1.0 (build: release, commit: unspeci)",
        ),
        _ => CommandExecutionResult::failed(1, "not found"),
    }
}

/// Where the bridge is, and which build it answers with.
const SOCKTAINER_PATH: &str = "/opt/homebrew/bin/socktainer";
const SOCKTAINER_VERSION: &str = "0.3.1";

/// The same Mac with the bridge in place, answering its OWN version.
///
/// The `--version` leg is not decoration: `socktainer_missing`'s catch-all answers EVERY `--version`
/// with the container CLI's banner, so a socktainer located through this fixture used to be handed
/// the ENGINE's string — and `parse_program_version` reads its third token, which there is the word
/// "version". A fixture that gives two programs one version cannot show that they are reported apart.
fn socktainer_present(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", "socktainer"] => CommandExecutionResult::ok(format!("{SOCKTAINER_PATH}\n")),
        [SOCKTAINER_PATH, "--version"] => {
            CommandExecutionResult::ok(format!("socktainer version {SOCKTAINER_VERSION}"))
        }
        _ => socktainer_missing(argv),
    }
}

/// The bridge is there and will not say which build it is.
///
/// `findProgramVersion` records the empty string when the probe FAILS — empty, not absent — which is
/// the case the original renders as "socktainer (version unknown)".
fn socktainer_present_without_a_version(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        [SOCKTAINER_PATH, "--version"] => CommandExecutionResult::failed(1, "unknown flag"),
        _ => socktainer_present(argv),
    }
}

#[tokio::test]
async fn a_missing_bridge_is_named_rather_than_the_socket_whose_absence_it_explains() {
    // Apple's address is a CONVENTION (`~/.socktainer/container.sock`), so it resolves whether or not
    // anything serves it. With no socktainer nothing binds it, and the probe refuses with
    // API_UNREACHABLE naming that path — a path a user cannot fix, because it only appears once
    // socktainer runs. The oracle appends "socktainer not found — install it" to that same line; a code
    // cannot be appended, so the cause REPLACES the symptom.
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_missing),
        sockets_bound(&[]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::ApiBridgeNotFound);
    assert_eq!(
        error.params.get("program").and_then(|it| it.as_str()),
        Some("socktainer"),
        "what to install, which is the whole actionable content of the original's sentence"
    );
    assert_eq!(
        harness.machine.availability().report.api.severity,
        DiagnosticSeverity::Err,
        "the reason a dimension failed is an error, not a note"
    );
}

#[tokio::test]
async fn a_bridge_nobody_located_on_a_connection_that_answered_is_a_note_not_a_failure() {
    // The engine answered THROUGH the bridge, so the api dimension passed and the connection is up —
    // only the lookup came back empty (socktainer installed outside the cascade's reach). Reporting
    // `err` beside `api: true` in the same struct would contradict it.
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_missing),
        sockets_bound(&[&socktainer_socket(HOME)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert!(harness.machine.availability().api);
    let report = &harness.machine.availability().report.api;
    assert_eq!(report.code, DiagnosticCode::ApiBridgeNotFound);
    assert_eq!(report.severity, DiagnosticSeverity::Warn);
}

#[tokio::test]
async fn a_bridge_that_is_installed_leaves_the_api_verdict_exactly_as_the_probe_left_it() {
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_present),
        sockets_bound(&[&socktainer_socket(HOME)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    let report = &harness.machine.availability().report.api;
    assert_eq!(
        report.code,
        DiagnosticCode::NotChecked,
        "a bridge that explains no failure must not become one"
    );
    assert_eq!(report.severity, DiagnosticSeverity::Ok);
}

#[tokio::test]
async fn a_bridge_that_is_installed_is_named_with_the_version_it_answers() {
    // The half `describeApiBridge` used to drop. The original reports a bridge that IS there as well
    // as one that is not — `"API is running · socktainer 0.3.1"` — and nothing had to be added to hold
    // it: a report entry is a code, a severity and typed PARAMS, so the verdict and the build were
    // never competing for one slot: presence AND version, both reported.
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_present),
        sockets_bound(&[&socktainer_socket(HOME)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    let report = &harness.machine.availability().report.api;
    assert_eq!(
        report.params.get("bridge").and_then(|it| it.as_str()),
        Some("socktainer"),
        "what this connection is reached THROUGH"
    );
    assert_eq!(
        report
            .params
            .get("bridge_version")
            .and_then(|it| it.as_str()),
        Some(SOCKTAINER_VERSION),
        "the build, which is what a bridge that lags its engine is diagnosed from"
    );
}

#[tokio::test]
async fn a_bridge_that_is_present_rides_along_with_the_reason_the_api_failed() {
    // socktainer is INSTALLED and is not RUNNING, so nothing binds the socket it would serve. The
    // original appends its note to whatever `report.api` already says, so both facts survive on one
    // line; a code cannot be appended to another, but a param can be added to any of them. The refusal
    // keeps its own code and the address it was about, and gains the bridge that was in place while it
    // failed — which is the whole content of "the bridge is there and the engine still will not answer".
    let socket = socktainer_socket(HOME);
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_present),
        sockets_bound(&[]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(
        error.code,
        DiagnosticCode::ApiUnreachable,
        "a bridge that is present explains nothing, so it must not replace the refusal"
    );
    assert_eq!(
        error.params.get("socket").and_then(|it| it.as_str()),
        Some(socket.as_str()),
        "the reason keeps the address it was about"
    );
    assert_eq!(
        error
            .params
            .get("bridge_version")
            .and_then(|it| it.as_str()),
        Some(SOCKTAINER_VERSION),
        "and carries the build that was in place, all the way through `settle`"
    );
}

#[tokio::test]
async fn a_bridge_whose_version_cannot_be_read_is_named_without_one() {
    // `findProgramVersion` records the EMPTY string when its probe fails, and the original reads that
    // as unknown (`program.version ? … : "socktainer (version unknown)"`). So it is left out rather
    // than written as `""` — a report that has just finished removing two spellings of nothing does
    // not get to invent a third.
    let mut harness = apple_with(
        FakeCommand::answering(socktainer_present_without_a_version),
        sockets_bound(&[&socktainer_socket(HOME)]),
        FakeHttp::serving(),
    );

    harness.connect(0).await;

    let report = &harness.machine.availability().report.api;
    assert_eq!(
        report.params.get("bridge").and_then(|it| it.as_str()),
        Some("socktainer"),
        "it is still there, which is the half that WAS readable"
    );
    assert!(
        !report.params.contains_key("bridge_version"),
        "absent, not empty: {:?}",
        report.params
    );
}

#[tokio::test]
async fn an_engine_that_speaks_rest_itself_is_reached_through_no_bridge() {
    // Podman and Docker answer `None`, so the fold has nothing to record and must leave the entry
    // exactly as the probe left it rather than annotate it with a bridge nobody goes through.
    let mut harness = harness_with(engine_socket_bound(), FakeHttp::serving());

    harness.connect(0).await;

    let report = &harness.machine.availability().report.api;
    assert!(
        !report.params.contains_key("bridge"),
        "there is no bridge to name: {:?}",
        report.params
    );
}

#[tokio::test]
async fn a_program_that_was_not_found_asks_the_engine_nothing() {
    // The other half: `program_found` is load-bearing too. The address is resolved and bound, and no
    // engine binary was located — so there is nothing that could be serving on it, and the reason a
    // user needs is the missing program rather than a socket that looks broken.
    let mut harness = Harness::with_http(
        options(manual_connection("", "/run/podman.sock"), false),
        linux(None),
        FakeCommand::answering(engine_is_healthy),
        engine_socket_bound(),
        nothing_may_be_dialled(),
    );

    harness.connect(0).await;

    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::ProgramNotFound
    );
    assert!(harness.pinged().is_empty());
}
