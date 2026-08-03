//! Driving a connection against the REAL capabilities.
//!
//! The claim is the one that cannot be made in the pure domain: a user who disconnects mid-`starting`
//! leaves no child process behind. So this spawns an actual process, abandons the attempt while the
//! service is still being waited on, and looks in `/proc` for the pid afterwards.
//!
//! **Cancellation is DROPPING the `connect` future**, so that is what this does — no runner, no
//! input channel, no `Input::Disconnect`. What follows the drop is the same `disconnect` a user's
//! click produces, and it addresses the service by the connection's NAME, which is the whole reason
//! the teardown is safe: the dropped future may never have lived long enough to record anything.
//!
//! The "engine" is a shell script that ignores its arguments and sleeps, so the test is hermetic — a
//! machine without podman still proves the teardown.

use std::sync::Arc;
use std::time::Duration;

use cdc_runtime::capabilities::command::{Command, CommandError, ServiceId};
use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_runtime_host_native::command::TokioCommand;
use cdc_runtime_host_native::fs::{StdFs, SystemClock};
use cdc_runtime_host_native::http::TokioHttp;
use serde_json::json;

const CONNECTION_ID: &str = "host.manual.podman.native";

/// The service the connection's engine API is spawned under — qualified with the connection, never
/// a bare `api`.
fn api_service() -> ServiceId {
    ServiceId(format!("api:{CONNECTION_ID}"))
}

/// A connection whose "engine" is a script that outlives its attempt unless something stops it.
///
/// `mode.manual` so no detection runs — the point here is the API service and its teardown, and a
/// real `which podman` would make the test depend on the machine it runs on.
fn manual_connection(program: &str, socket: &str) -> Connection {
    serde_json::from_value(json!({
      "id": CONNECTION_ID,
      "name": "podman-manual",
      "label": "Manual",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": socket, "relay": "" } },
        "program": { "name": "podman", "path": program, "version": "5.6.2" },
        "rootfull": false,
        "mode": "mode.manual"
      }
    }))
    .expect("connection fixture parses")
}

/// Linux, because these connections are Podman-native and the OS gate is checked for real.
fn linux() -> ConnectionContext {
    ConnectionContext {
        os: OperatingSystem::Linux,
        ..ConnectionContext::default()
    }
}

fn machine(
    connection: Connection,
    start_api: bool,
    command: Arc<TokioCommand>,
) -> ConnectionMachine {
    ConnectionMachine::new(
        ConnectOptions {
            connection,
            start_api,
            skip_availability_check: false,
            origin: None,
        },
        linux(),
        ConnectionCapabilities {
            command,
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
        },
    )
}

/// A script that ignores everything it is handed and stays alive.
fn sleeping_engine(directory: &std::path::Path) -> String {
    let script = directory.join("engine.sh");
    std::fs::write(&script, "#!/bin/sh\nwhile true; do sleep 0.05; done\n").expect("write script");
    let mut permissions = std::fs::metadata(&script)
        .expect("script metadata")
        .permissions();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.set_mode(0o755);
    }
    std::fs::set_permissions(&script, permissions).expect("make the script executable");
    script.to_string_lossy().into_owned()
}

fn process_is_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

/// How many times the arrange below may be rebuilt before the test gives up on this machine.
///
/// This is not a retried assertion. It is the ARRANGE, and it is retried because its one step that
/// can fail for a reason outside the claim is the fork.
const ARRANGE_ATTEMPTS: usize = 3;

/// Bring a fresh machine up until its API service is running, and abandon the attempt there by
/// dropping it — the arrange for the claim below.
///
/// `None` means this machine REFUSED TO FORK, which is the only thing that can end the attempt
/// early and says nothing at all about cancellation. The readiness probe watches a socket that never
/// appears, so the attempt cannot reach the end of its own 10 × 5s budget inside this 10s window;
/// but `start_api` forgives every `spawn_service` error (`Err(_) => Ok(false)`, because the engine may
/// already be listening), and the attempt then settles on the availability check.
///
/// **The PHASE cannot tell that apart from a cancellation that did not happen** — and could not before
/// the readiness probe either, for the mirror-image reason. It used to be `Ready` for both, because a
/// non-empty uri was the whole test; it is now `Failed` for both, because `never.sock` is absent. Only
/// the SERVICE TABLE distinguishes them, which is what the arm below reads.
async fn abandon_a_live_attempt(
    program: &str,
    socket: &str,
) -> Option<(ConnectionMachine, Arc<TokioCommand>, u32)> {
    let command = Arc::new(TokioCommand::default());
    let mut machine = machine(
        manual_connection(program, socket),
        true,
        Arc::clone(&command),
    );
    let pid = {
        let attempt = machine.connect(ConnectOrigin::Bootstrap, None);
        tokio::pin!(attempt);
        let mut found = None;
        for _ in 0..1_000 {
            tokio::select! {
                _ = &mut attempt => {
                    // A settled attempt still holding its service IS the finding: it would mean the
                    // readiness probe passed on a socket that never appears, so nothing was
                    // cancelled. An empty table is the refused fork, and the caller rebuilds.
                    assert!(
                        command.service_pid(&api_service()).is_none(),
                        "the attempt settled with its API service still registered — the readiness \
                         probe passed on a socket that never appears, so nothing was cancelled"
                    );
                    return None;
                }
                _ = tokio::time::sleep(Duration::from_millis(10)) => {}
            }
            if let Some(pid) = command.service_pid(&api_service()) {
                found = Some(pid);
                break;
            }
        }
        found.expect("the API service never started")
    };
    Some((machine, command, pid))
}

#[tokio::test]
async fn a_disconnect_mid_starting_leaves_no_child_process_behind() {
    let directory = tempfile::tempdir().expect("temp dir");
    let program = sleeping_engine(directory.path());
    // A socket that never appears, so the readiness probe is still polling when the user gives up —
    // the attempt is genuinely in flight rather than already finished.
    let socket = directory.path().join("never.sock");
    let socket = socket.to_string_lossy();

    let mut arranged = None;
    for _ in 0..ARRANGE_ATTEMPTS {
        arranged = abandon_a_live_attempt(&program, &socket).await;
        if arranged.is_some() {
            break;
        }
    }
    let (mut machine, command, pid) = arranged.expect(
        "this machine refused to fork the engine in every arrange, so the claim was never \
         exercised — that is saturation and not a finding, and a mutation or coverage run \
         competing for the same memory is what does it",
    );

    assert_eq!(
        machine.phase(),
        ConnectionPhase::Starting,
        "the attempt was abandoned, not settled"
    );

    machine.disconnect().await;

    assert_eq!(
        machine.phase(),
        ConnectionPhase::Idle,
        "a cancelled attempt reaches idle, not failed — the user asked for it"
    );
    assert!(
        !process_is_alive(pid),
        "pid {pid} outlived the attempt that spawned it"
    );
    assert!(
        matches!(
            command.kill(&api_service()).await,
            Err(CommandError::UnknownService(_))
        ),
        "the service is no longer registered either"
    );
}

#[tokio::test]
async fn a_command_that_could_not_run_becomes_a_failed_outcome_not_a_crash() {
    // `Command.Execute` catches and returns `{ success: false }`, which is why a machine with no
    // engine records `which podman` exiting non-zero rather than throwing. The real capability
    // preserves that: detection continues and the connection fails with a diagnostic instead of an
    // error nobody mapped.
    let connection: Connection = serde_json::from_value(json!({
      "id": "host.default.podman.native",
      "name": "Podman Native",
      "label": "Podman",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": "cdc-no-such-engine" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses");
    let command = Arc::new(TokioCommand::default());
    let mut machine = machine(connection, false, Arc::clone(&command));

    machine.connect(ConnectOrigin::Bootstrap, None).await;

    assert_eq!(machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ProgramNotFound),
        "the reason is the domain's diagnostic, not the capability's io error"
    );
    assert!(
        command.service_pid(&api_service()).is_none(),
        "nothing was spawned"
    );
}

#[tokio::test]
async fn a_service_that_cannot_be_spawned_at_all_lets_the_availability_check_decide() {
    // The capability fails immediately — there is no such program — and the native transport
    // forgives it exactly as the oracle's `catch` around `startApi` does, because something outside
    // the app may already be listening.
    let directory = tempfile::tempdir().expect("temp dir");
    let socket = directory.path().join("api.sock");
    std::fs::write(&socket, "").expect("a socket address that resolves to a file, not a listener");
    let command = Arc::new(TokioCommand::default());
    let mut machine = machine(
        manual_connection("/cdc/no/such/engine", &socket.to_string_lossy()),
        true,
        Arc::clone(&command),
    );

    machine.connect(ConnectOrigin::User, None).await;

    // The transport forgives the refused spawn and the availability check decides — which now means
    // ASKING the engine, not merely resolving an address. This path is a plain file, so nothing is
    // serving on it and the verdict is no. Before the readiness probe landed this same fixture
    // reported `ready`, which is the false-ready defect the design recorded from a live run.
    assert_eq!(
        machine.phase(),
        ConnectionPhase::Failed,
        "an address that resolves is not a listener"
    );
    assert_eq!(
        machine.runtime_info().error.map(|it| it.code),
        Some(DiagnosticCode::ApiUnreachable),
        "the reason is the api, not the spawn the transport forgave"
    );
    assert_eq!(machine.starting_step(), None);

    // The teardown now tries to stop something the capability never started. That is not a failed
    // teardown, and it must not leave the connection stuck: a service that has already gone is a
    // service that is stopped.
    machine.disconnect().await;

    assert_eq!(machine.phase(), ConnectionPhase::Idle);
}
