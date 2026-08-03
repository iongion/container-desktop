//! Several connections at once, none of them primary.
//!
//! The claim under test is independence: one connection failing must not move another, and there must
//! be no shared "current" for them to fight over. **Independence is now also a claim about WAITING**:
//! moving one machine must not stop a reader of the table, or a connection nobody asked about would
//! be held up for the minute a failing attempt takes. That is asserted here at the table, and again
//! end to end in `cdc-server`'s `tests/server.rs`, where a connect really does stop in the middle.

use std::sync::Arc;

use crate::fakes::{FakeClock, FakeCommand, FakeHttp, Gate, MemoryFs};
use crate::harness::PATIENCE;
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::active_connections::ActiveConnections;
use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectionPhase, ConnectionStartingStep,
};
use serde_json::json;

fn connection(id: &str, engine: &str, host: &str, program: &str, base_url: &str) -> Connection {
    serde_json::from_value(json!({
      "id": id,
      "name": id,
      "label": "Native",
      "engine": engine,
      "host": host,
      "settings": {
        "api": { "baseURL": base_url, "connection": { "uri": "", "relay": "" } },
        "program": { "name": program, "path": "", "version": "" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses")
}

/// A machine whose engine answers `respond`. Each carries its OWN capability, because two connections
/// sharing one would make "the failure did not move the healthy connection" unprovable.
fn machine(
    connection: Connection,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> ConnectionMachine {
    ConnectionMachine::new(
        ConnectOptions {
            connection,
            start_api: false,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Linux,
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(FakeCommand::answering(respond)),
            // The engine's socket is bound: these two connections are both meant to be able to
            // come up, and the readiness probe refuses an absent native socket by name.
            fs: Arc::new(MemoryFs::seeded("/run/podman.sock", "")),
            http: Arc::new(FakeHttp::serving()),
            clock: Arc::new(FakeClock::default()),
        },
    )
}

/// The same machine, stopped where a real one spends its minute.
///
/// `start_api` and the gate are one knob for the reason `cdc-server`'s builder gives: the gate stands
/// inside `spawn_service`, so a machine that gates a connect is exactly a machine whose connect starts
/// the engine's own service. A gate nothing reaches is a knob that lies.
fn gated(connection: Connection, gate: Gate) -> ConnectionMachine {
    ConnectionMachine::new(
        ConnectOptions {
            connection,
            start_api: true,
            skip_availability_check: false,
            origin: None,
        },
        ConnectionContext {
            os: OperatingSystem::Linux,
            ..ConnectionContext::default()
        },
        ConnectionCapabilities {
            command: Arc::new(FakeCommand::answering(healthy_podman).gated(gate)),
            fs: Arc::new(MemoryFs::seeded("/run/podman.sock", "")),
            http: Arc::new(FakeHttp::serving()),
            clock: Arc::new(FakeClock::default()),
        },
    )
}

fn healthy_podman(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#),
    }
}

fn podman() -> Connection {
    connection(
        "host.default.podman.native",
        "podman",
        "podman.native",
        "podman",
        "http://d",
    )
}

/// The second connection, named once: every test that needs a connection OTHER than podman's needs
/// the same one, or "the failure did not move the healthy connection" is about two different pairs.
fn docker() -> Connection {
    connection(
        "host.default.docker.native",
        "docker",
        "docker.native",
        "docker",
        "http://localhost",
    )
}

#[tokio::test]
async fn two_connections_run_independently_and_neither_is_special() {
    let registry = ActiveConnections::new();
    registry.insert(machine(podman(), healthy_podman));
    // Docker is not installed on this machine.
    registry.insert(machine(docker(), |_| {
        CommandExecutionResult::failed(1, "not found")
    }));

    assert_eq!(registry.len(), 2, "both machines are registered, not one");
    assert!(!registry.is_empty());
    assert_eq!(
        registry
            .reading("host.default.podman.native")
            .await
            .expect("podman is reachable by id")
            .connection()
            .id,
        "host.default.podman.native",
        "a lookup returns the machine that was asked for"
    );
    assert!(registry.reading("host.default.lima.native").await.is_none());

    for id in ["host.default.podman.native", "host.default.docker.native"] {
        registry
            .hold(id)
            .await
            .expect("registered")
            .connect(ConnectOrigin::Bootstrap, None)
            .await;
    }

    let infos = registry.runtime_infos();
    assert_eq!(
        infos.iter().map(|it| it.id.as_str()).collect::<Vec<_>>(),
        vec!["host.default.docker.native", "host.default.podman.native"],
        "ordered by id, so a snapshot of several connections is stable and diffable"
    );
    assert_eq!(
        infos
            .iter()
            .map(|it| (it.phase, it.running))
            .collect::<Vec<_>>(),
        vec![
            (ConnectionPhase::Failed, false),
            (ConnectionPhase::Ready, true)
        ],
        "the failure did not move the healthy connection"
    );
    assert_eq!(
        infos[0].error.as_ref().map(|it| it.code.clone()),
        Some(DiagnosticCode::ProgramNotFound)
    );
    assert_eq!(
        infos[1].uri.as_deref(),
        Some("/run/podman.sock"),
        "each machine holds its OWN resolved settings — there is no shared current host"
    );
    // The cheap read of the same thing, and it must agree: a caller deciding which connections to
    // watch reads this one, so a disagreement between them is a connection nobody watches.
    assert_eq!(
        registry.phases(),
        vec![
            (
                "host.default.docker.native".to_string(),
                ConnectionPhase::Failed,
                true,
            ),
            (
                "host.default.podman.native".to_string(),
                ConnectionPhase::Ready,
                true,
            ),
        ]
    );
}

#[tokio::test]
async fn a_machine_is_keyed_by_its_connection_id() {
    let registry = ActiveConnections::new();
    registry.insert(machine(podman(), healthy_podman));

    // Re-registering the same connection replaces it rather than accumulating a second machine.
    registry.insert(machine(podman(), healthy_podman));

    assert_eq!(registry.len(), 1);
    assert_eq!(registry.ids(), vec!["host.default.podman.native"]);
    assert!(registry.remove("host.default.podman.native"));
    assert!(
        !registry.remove("host.default.podman.native"),
        "and forgetting one that was already forgotten says so rather than pretending"
    );
    assert!(registry.is_empty());
    assert!(
        registry
            .reading("host.default.podman.native")
            .await
            .is_none()
    );
    assert!(registry.seen("host.default.podman.native").is_none());
}

#[tokio::test]
async fn moving_one_machine_leaves_every_other_one_reachable() {
    // **Independence, said about WAITING.** A connect needs its machine for as long as `spawn_service`
    // polls — 51 to 56 seconds, measured against a real engine that never came up — and one lock over
    // the table would have made that every other connection's problem too: the watcher pinging a
    // healthy engine, and a client forwarding to it, would both be stopped by a connection they have
    // nothing to do with. A lock per machine is what makes them separate.
    let registry = ActiveConnections::new();
    registry.insert(machine(podman(), healthy_podman));
    registry.insert(machine(docker(), healthy_podman));

    let held = registry
        .hold("host.default.podman.native")
        .await
        .expect("registered");

    assert!(
        tokio::time::timeout(PATIENCE, registry.reading("host.default.docker.native"))
            .await
            .is_ok_and(|machine| machine.is_some()),
        "the other connection's machine is reachable while this one is held"
    );
    assert!(
        registry.seen("host.default.podman.native").is_some(),
        "and so is what the held one last said about itself, which is what a snapshot reads"
    );
    drop(held);
}

#[tokio::test]
async fn a_reader_sees_the_attempt_move_while_the_attempt_is_still_running() {
    // **The minute a client used to spend looking at the state before the attempt.** An attempt sits
    // inside `spawn_service` for 51 to 56 seconds against an engine that never comes up, and until
    // this it published nothing until it was over: a connection that was `reconnecting` went on
    // rendering `retry in 0.9s` for the whole of it, which reads as stuck rather than as working. The
    // lock split made that MORE visible, not less — a client attaching mid-attempt is served at once
    // now, and what it was served was that same standing-still projection.
    //
    // The oracle publishes exactly here: `connectOne` writes `phase: "starting"` into the map every
    // reader reads and emits its progress BEFORE the attempt, not after it.
    let gate = Gate::shut();
    let registry = ActiveConnections::new();
    registry.insert(gated(podman(), gate.clone()));
    let mut held = registry
        .hold("host.default.podman.native")
        .await
        .expect("registered");

    tokio::join!(held.connect(ConnectOrigin::Bootstrap, None), async {
        // Standing INSIDE the attempt, which is the whole measurement: an assertion made before it
        // starts or after it ends passes against a machine that publishes nothing at all. BOUNDED,
        // because an unbounded wait is a mutant that hangs a worker instead of failing it — and the
        // mutant here is the one that makes `connect` do nothing, which never reaches this gate.
        tokio::time::timeout(PATIENCE, gate.reached())
            .await
            .expect("the attempt reached the engine");
        assert_eq!(
            registry
                .seen("host.default.podman.native")
                .map(|it| it.phase),
            Some(ConnectionPhase::Starting),
            "a reader sees what the connection is DOING, not what it was doing before it began"
        );
        // And WHICH sub-step, which is the half a phase cannot carry. `starting` is true of all four
        // of them and of the 51 seconds this gate stands for, so a client that has only the phase can
        // say a connection is busy and never what it is busy WITH. The sub-step used to live only in
        // the progress lines — which is exactly what a client attaching mid-attempt did not hear.
        assert_eq!(
            registry
                .seen("host.default.podman.native")
                .and_then(|it| it.starting_step),
            Some(ConnectionStartingStep::StartingApi),
            "and this gate stands inside `spawn_service`, which is sub-step 3 of 4"
        );
        gate.open();
    });

    assert_eq!(
        registry
            .seen("host.default.podman.native")
            .map(|it| it.phase),
        Some(ConnectionPhase::Ready),
        "and the line that settles it is published as it happens too, not when the machine goes back"
    );
    assert_eq!(
        registry
            .seen("host.default.podman.native")
            .and_then(|it| it.starting_step),
        None,
        "a settled connection is in no sub-step, and a stale one would outlive the phase it belongs to"
    );
    drop(held);
}

#[tokio::test]
async fn what_a_reader_sees_is_what_the_machine_last_published() {
    // **The projection is the whole of what a reader reads**, so the rule that keeps it honest is
    // `Held` republishing on the way out: a caller that moved a machine and forgot to say so would
    // leave a snapshot asserting a phase the connection had left, and nothing would report it — a
    // stale value is not an error.
    //
    // **`disconnect` is what pins that rule now, and it has to be.** A connect publishes as it goes,
    // so it would reach the same projection without the guard ever dropping and prove nothing about
    // `Drop` at all. Every OTHER mutation — this one, and `dropped` — still says nothing until the
    // machine goes back, which is why the guard is the thing that cannot be forgotten.
    let registry = ActiveConnections::new();
    registry.insert(machine(podman(), healthy_podman));

    let before = registry
        .seen("host.default.podman.native")
        .expect("a machine that has just been put in has already published");
    assert_eq!(before.phase, ConnectionPhase::Idle);

    let mut held = registry
        .hold("host.default.podman.native")
        .await
        .expect("registered");
    assert_eq!(
        held.phase(),
        ConnectionPhase::Idle,
        "the MACHINE's own state, read through the guard — the projection is a copy of it, not it"
    );
    held.connect(ConnectOrigin::Bootstrap, None).await;
    assert_eq!(
        held.phase(),
        ConnectionPhase::Ready,
        "the machine has moved, and so has what a reader sees — an attempt publishes as it goes"
    );
    assert_eq!(
        registry
            .seen("host.default.podman.native")
            .map(|it| it.phase),
        Some(ConnectionPhase::Ready),
        "without the guard having been given back at all"
    );

    held.disconnect().await;
    assert_eq!(
        registry
            .seen("host.default.podman.native")
            .map(|it| it.phase),
        Some(ConnectionPhase::Ready),
        "a mutation that is not an attempt says nothing while it is held: THIS is the staleness left"
    );
    drop(held);

    let after = registry
        .seen("host.default.podman.native")
        .expect("still registered");
    assert_eq!(
        after.phase,
        ConnectionPhase::Idle,
        "giving the machine back is what republished it"
    );
    assert_eq!(
        registry.runtime_infos().first().map(|it| it.phase),
        Some(ConnectionPhase::Idle),
        "and the snapshot reads the same projection, not the machine"
    );
}
