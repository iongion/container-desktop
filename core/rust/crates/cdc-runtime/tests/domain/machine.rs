//! The connection's startup sequence.
//!
//! What is specified here is the sub-step ORDER a native connection walks, and the failures that end
//! an attempt before it begins. Reconnect, cancellation and the state projection are
//! `machine_reconnect.rs`; the branches a healthy connection never reaches are `machine_edges.rs`.
//!
//! `async` now, because the units perform their own I/O. What used to be a pure `step(now, input)`
//! fed by a harness is an awaited sequence — and the assertions are the same ones, because the
//! BEHAVIOUR did not change, only who runs the commands.

mod availability;
mod edges;
mod forward;
mod liveness;
mod preflight;
mod proxy;
mod reconnect;
mod scope;
mod settings;

use crate::fakes::{FakeCommand, Gate, Heard};
use crate::harness::{
    Harness, PATIENCE, connection, docker, engine_is_healthy, healthy_podman, linux, options,
    podman,
};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::machine::ConnectionContext;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectionPhase, ConnectionStartingStep,
};

#[test]
fn the_projection_carries_what_this_connector_can_do() {
    // The row a client renders its actions from, and it must come from the PROJECTION rather than be
    // assembled by whoever publishes: a connection that answered `None` here would render as a
    // connection that can do nothing, on an engine that can do everything.
    //
    // Asserted before a connect as well, because a capability is a property of the CONNECTOR and not
    // of whether it happens to be up — the offer list is drawn for connections that never ran.
    let harness = healthy_podman(false);

    let capabilities = harness
        .machine
        .runtime_info()
        .capabilities
        .expect("a registered connector answers its table");

    assert!(
        capabilities.extensions.machines,
        "podman native manages machines"
    );
    assert!(capabilities.resources.pods, "and lists pods");
    assert!(
        !capabilities.extensions.swarm,
        "and has no swarm — the podman table, not a default of everything-true"
    );
}

#[test]
fn a_new_machine_is_idle_and_has_asked_nothing() {
    let harness = healthy_podman(false);

    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
    assert_eq!(harness.machine.starting_step(), None);
    assert!(!harness.machine.runtime_info().running);
}

#[tokio::test]
async fn a_native_connect_walks_the_sub_steps_in_the_documented_order() {
    let mut harness = healthy_podman(false);

    let log = harness.connect(1_000).await;

    // No `StartingScope`: a native host has no scope, so the sub-step is skipped entirely rather
    // than entered and left — which is what the app's trace stream shows.
    assert_eq!(
        log.steps(),
        vec![
            None,
            Some(ConnectionStartingStep::Detecting),
            Some(ConnectionStartingStep::CheckingAvailability),
            None,
        ],
        "announce, detect, check, then settle"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.machine.settings().api.connection.uri,
        "/run/podman.sock",
        "the socket the engine reported is adopted"
    );
}

#[tokio::test]
async fn a_listener_is_told_each_line_while_the_attempt_is_still_running() {
    // **The minute nobody was told about.** An attempt sits inside `spawn_service` for 51 to 56
    // seconds against an engine that never comes up, and every line it produced used to arrive in one
    // batch when it was over — so a client rendered the state from before it began for the whole of
    // it. The oracle publishes per line and not at the end: `connectOne` emits its progress and fires
    // its change event before it asks the host for anything.
    //
    // The gate is the whole measurement. Asserting after the attempt returned cannot tell publishing
    // as it happens from publishing at the end, because by then both have published everything.
    let gate = Gate::shut();
    let heard = Heard::default();
    let mut harness = Harness::over(
        options(podman(), true),
        linux(None),
        FakeCommand::answering(engine_is_healthy).gated(gate.clone()),
    );

    let (log, ()) = tokio::join!(harness.connect_watched(0, &heard), async {
        // BOUNDED: an unbounded wait is a mutant that hangs a worker instead of failing it, and the
        // mutant this file is most exposed to is the one that makes `connect` do nothing at all.
        tokio::time::timeout(PATIENCE, gate.reached())
            .await
            .expect("the attempt reached the engine");
        assert_eq!(
            heard.steps(),
            vec![
                None,
                Some(ConnectionStartingStep::Detecting),
                Some(ConnectionStartingStep::StartingApi),
            ],
            "everything the attempt has said so far, while it is still standing in `spawn_service`"
        );
        assert_eq!(
            heard.phases(),
            vec![ConnectionPhase::Starting; 3],
            "and the STATE each line narrated, which is what a reader of the projection sees"
        );
        gate.open();
    });

    assert_eq!(
        heard.lines(),
        log.progress,
        "and the caller is answered with exactly what was published, in the same order"
    );
}

#[tokio::test]
async fn an_attempt_announces_itself_before_it_asks_the_host_for_anything() {
    // **`connectOne`'s first act**, ported: it writes `phase: "starting"` into the map every reader
    // reads and emits a line for it BEFORE the try block. Without that line the first thing a client
    // hears is a sub-step — and the sub-steps are all conditional, so a manual connection that skips
    // detection and the availability check would say nothing at all until it settled.
    let manual = connection(
        "podman",
        "podman.native",
        "podman",
        "http://d",
        "mode.manual",
    );
    let mut harness = Harness::new(options(manual, false), linux(None), engine_is_healthy);

    let log = harness.connect(0).await;

    assert_eq!(
        log.steps().first(),
        Some(&None),
        "the attempt is announced, not inferred from whichever sub-step happens to run first"
    );
    assert_eq!(
        log.phases().first(),
        Some(&ConnectionPhase::Starting),
        "and it says what the connection is now doing"
    );
}

#[tokio::test]
async fn every_progress_line_carries_the_connection_and_the_origin() {
    let mut harness = healthy_podman(false);

    let log = harness.connect(4_242).await;

    assert!(
        log.progress.iter().all(|line| {
            line.connection_id == "host.default.podman.native"
                && line.origin == Some(ConnectOrigin::Bootstrap)
        }),
        "a client renders these without joining anything: {:?}",
        log.progress
    );
}

#[tokio::test]
async fn each_sub_step_stamps_its_own_line_so_a_trace_can_say_which_one_was_slow() {
    // **The finding the terminal was built to produce.** One `now` threaded through a whole attempt
    // stamped every line identically, so a trace recorded that a connect took nine seconds and could
    // never say where they went — which is most of what a connect trace is for. Each sub-step reads
    // the clock for itself now, and a clock that moves 250ms per read is the only way to observe that
    // hermetically: a clock standing still cannot tell one read from five.
    let mut harness = healthy_podman(false);
    harness.clock.tick_by(250);

    let log = harness.connect(1_000).await;

    let stamps: Vec<i64> = log.progress.iter().map(|line| line.ts).collect();
    assert_eq!(
        stamps,
        vec![1_000, 1_250, 1_500, 1_750],
        "the announcement, detecting, checking availability, then ready — each at its own instant"
    );
    assert!(
        stamps.windows(2).all(|pair| pair[0] < pair[1]),
        "and strictly increasing, because a later line cannot be stamped earlier: {stamps:?}"
    );
}

#[tokio::test]
async fn mode_manual_asks_the_engine_nothing_at_all() {
    // Manual settings are the user's. Detection would overwrite them with what it found, which is
    // the one thing a manual connection exists to prevent.
    let manual = connection(
        "podman",
        "podman.native",
        "podman",
        "http://d",
        "mode.manual",
    );
    let mut harness = Harness::new(options(manual, false), linux(None), engine_is_healthy);

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing was run: {:?}", log.argv);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    // The api chain reports the FIRST thing wrong, and with detection skipped that is the program:
    // this fixture's manual settings carry no path, and nothing went looking for one. Reporting
    // `API_SOCKET_UNRESOLVED` here would name a downstream symptom of the same omission.
    assert_eq!(
        harness.machine.availability().report.api.code,
        DiagnosticCode::ProgramNotFound
    );
}

#[tokio::test]
async fn start_api_spawns_the_engines_own_service_before_availability_is_checked() {
    let mut harness = healthy_podman(true);

    let log = harness.connect(0).await;

    assert_eq!(
        log.steps(),
        vec![
            None,
            Some(ConnectionStartingStep::Detecting),
            Some(ConnectionStartingStep::StartingApi),
            Some(ConnectionStartingStep::CheckingAvailability),
            None,
        ]
    );
    assert_eq!(
        log.spawned,
        vec!["api:host.default.podman.native".to_string()],
        "the service is qualified with the connection, so a teardown kills its own"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
}

#[tokio::test]
async fn docker_native_has_no_managed_service_so_nothing_is_spawned() {
    // `buildServiceArgs` answers null for Docker: there is no service to launch, and the user starts
    // the host manually. That is not a failure, and the attempt carries on to the availability check.
    let mut harness = Harness::new(options(docker(), true), linux(None), |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/docker\n"),
        [_, "--version"] => CommandExecutionResult::ok("Docker version 27.0.0"),
        _ => CommandExecutionResult::ok(
            r#"[{"Endpoints":{"docker":{"Host":"unix:///var/run/docker.sock"}}}]"#,
        ),
    });

    let log = harness.connect(0).await;

    assert!(
        log.spawned.is_empty(),
        "nothing to launch: {:?}",
        log.spawned
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(
        harness.machine.settings().api.connection.uri,
        "/var/run/docker.sock",
        "the context's endpoint, with its scheme stripped"
    );
}

#[tokio::test]
async fn a_missing_program_fails_the_connection_and_is_not_retried() {
    // A first-time connect failure does not start a back-off cycle; only the drop of a LIVE
    // connection does (`maybeContinueReconnect`).
    let mut harness = Harness::new(
        options(crate::harness::podman(), false),
        linux(None),
        |_| CommandExecutionResult::failed(1, "not found"),
    );

    let log = harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.availability().report.program.code,
        DiagnosticCode::ProgramNotFound
    );
    assert_eq!(
        harness.machine.next_retry_at(),
        None,
        "no retry was scheduled"
    );
    assert_eq!(log.phases().last(), Some(&ConnectionPhase::Failed));
}

#[tokio::test]
async fn a_socket_the_engine_will_not_report_fails_with_an_unresolved_api() {
    // The program is there and the version reads, but `system info` says nothing usable. The engine
    // exists and cannot be reached, which is a different fault from "not installed".
    let mut harness = Harness::new(
        options(crate::harness::podman(), false),
        linux(None),
        |argv| match argv {
            ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
            [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
            _ => CommandExecutionResult::ok("{}"),
        },
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert!(
        harness.machine.availability().program,
        "the program WAS found — this is not a missing engine"
    );
    assert_eq!(
        harness.machine.availability().report.api.code,
        DiagnosticCode::ApiSocketUnresolved
    );
}

#[tokio::test]
async fn an_engine_the_operating_system_cannot_run_fails_before_any_command() {
    // The OS gate is first for a reason: there is no point probing an engine that cannot run here,
    // and probing anyway would report "not installed" for something that could never be installed.
    let mut harness = Harness::new(
        options(crate::harness::podman(), false),
        ConnectionContext {
            os: OperatingSystem::WindowsNt,
            ..ConnectionContext::default()
        },
        engine_is_healthy,
    );

    let log = harness.connect(0).await;

    assert!(log.argv.is_empty(), "nothing ran: {:?}", log.argv);
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.availability().report.api.code,
        DiagnosticCode::EngineNotAvailableOnOs
    );
}

#[tokio::test]
async fn a_pair_that_was_never_a_connector_names_both_halves_of_what_was_asked_for() {
    // This used to assert `ComposeError::Unimplemented` and the FILE an unported connector was
    // waiting for. Both Apple arms landed, that variant became unconstructible and was deleted, so
    // the subject is now the failure that is still reachable: a settings file naming an engine
    // beside a host no release ever paired it with.
    //
    // `podman` on `docker.native` is the shape of it — a pair a hand-edited settings file, or a
    // downgrade to a release that dropped a connector, can genuinely produce.
    let impossible = connection(
        "podman",
        "docker.native",
        "podman",
        "http://d",
        "mode.automatic",
    );
    let mut harness = Harness::new(options(impossible, false), linux(None), engine_is_healthy);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let report = &harness.machine.availability().report.api;
    assert_eq!(report.code, DiagnosticCode::HostNotSupported);
    assert_eq!(
        (
            report
                .params
                .get("engine")
                .and_then(serde_json::Value::as_str),
            report
                .params
                .get("host")
                .and_then(serde_json::Value::as_str),
        ),
        (Some("podman"), Some("docker.native")),
        "BOTH halves, because either one alone resolves to something that exists"
    );
}

#[tokio::test]
async fn a_settled_connection_accepts_a_fresh_attempt() {
    // Two attempts cannot overlap — `&mut self` is what guarantees `ensureConnected`'s idempotency
    // here, so what a second `connect` means is always "do it again", never "you are already busy".
    let mut harness = healthy_podman(false);
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    let again = harness.connect(1).await;

    assert!(!again.progress.is_empty());
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
}

#[tokio::test]
async fn a_connection_says_whether_anything_is_watching_it_and_an_attempt_re_arms_it() {
    // The state the protocol could not express: a connection that is up and working while NOTHING
    // will notice when it stops. Apple's `container` is the measured case — socktainer routes
    // `/events` and then writes nothing — so the watcher stands down, and until now the only record
    // of that was a log line.
    let mut harness = healthy_podman(false);
    assert_eq!(
        harness.machine.runtime_info().watched,
        None,
        "an idle connection has nothing watching it and nothing to watch; `false` would read as the \
         permanent state this reports"
    );

    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert_eq!(harness.machine.runtime_info().watched, Some(true));

    harness.machine.stood_down();
    assert_eq!(harness.machine.runtime_info().watched, Some(false));

    // **Re-armed per attempt, because giving up is about the ENGINE and not the connection.** A
    // restarted daemon, or a connection re-pointed at another context, may serve events perfectly
    // well; carrying the refusal across would leave it unwatched for the life of the process.
    harness.connect(0).await;
    assert_eq!(harness.machine.runtime_info().watched, Some(true));
}
