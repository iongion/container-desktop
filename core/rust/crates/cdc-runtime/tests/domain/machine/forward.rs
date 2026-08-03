//! The data plane a scoped connection opens.
//!
//! `machine_scope.rs` proves the CONTROL connection. This is the other half: a connection that
//! reaches `ready` with nothing listening on the address it resolved has proved nothing to a client.
//! The readiness probe now catches that at the availability check too (`machine/availability.rs`);
//! what is asserted here is the transport REFUSING outright, which is a different and earlier claim —
//! a forward that never bound must not be reported as a connection that merely failed its ping.
//!
//! The whole argv is asserted, never its tail: a forward assembled in the wrong order binds nothing
//! and says so nowhere.

use crate::fakes::APP_VERSION;
use crate::fakes::FakeCommand;
use crate::harness::{
    Harness, SOCKTAINER_SOCKET, apple_remote, apple_remote_is_healthy, linux_offering, options,
    podman_remote, remote_is_healthy, ssh_scope,
};
use cdc_runtime::capabilities::command::{CommandExecutionResult, ReadinessCheck, ServiceId};
use cdc_runtime::capabilities::http::Endpoint;
use cdc_runtime::domain::ssh::forward::local_forward_address;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectionPhase;
use cdc_runtime::runtimes::transports::ssh::{TUNNEL_READINESS_ATTEMPTS, TUNNEL_READINESS_WAIT};

/// The connector the forward still belongs to. Every podman and docker remote resolves a stdio
/// bridge now, and `start_api` skips the forward when one is present — Apple ships no
/// `system dial-stdio`, so it is the connector these rules can still be asserted on.
const APPLE: &str = "host.default.container.remote";

/// A healthy Apple remote, asked or not asked to start the engine's own API service.
fn remote(start_api: bool) -> Harness {
    Harness::new(
        options(apple_remote("engine"), start_api),
        linux_offering(vec![ssh_scope("engine")]),
        apple_remote_is_healthy,
    )
}

/// A healthy podman remote, which reaches its engine over the bridge instead.
fn bridged(start_api: bool) -> Harness {
    Harness::new(
        options(podman_remote("engine"), start_api),
        linux_offering(vec![ssh_scope("engine")]),
        remote_is_healthy,
    )
}

/// The local end of the forward, derived exactly as the transport derives it — never spelled out as
/// a literal, which would pin the hash rather than the rule.
fn local_end() -> String {
    local_forward_address(OperatingSystem::Linux, APPLE, crate::harness::USER_DATA)
}

#[tokio::test]
async fn the_forward_is_opened_whether_or_not_the_engines_api_was_asked_for() {
    // `start_api` asks for the ENGINE's service, which SSH's own `startApi` declines as "not
    // required". The forward is not that: it is what makes the resolved uri mean anything, and
    // gating it on that flag would leave a connection reporting `ready` on a socket with no
    // listener — exactly what this sub-step exists to prevent.
    for start_api in [false, true] {
        let mut harness = remote(start_api);

        harness.connect(0).await;

        assert_eq!(
            harness.spawned(),
            vec![format!("api:{APPLE}")],
            "start_api = {start_api}"
        );
        assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    }
}

#[tokio::test]
async fn a_scoped_connection_opens_its_forward_between_the_two_ends_detection_resolved() {
    let mut harness = remote(false);

    harness.connect(0).await;

    let (id, command, opts) = harness.service();
    let mut expected: Vec<String> = [
        "ssh",
        "-oStrictHostKeyChecking=accept-new",
        "-oBatchMode=yes",
        "-oConnectTimeout=15",
        "-oConnectionAttempts=1",
        "-p",
        "22",
        "-oExitOnForwardFailure=yes",
        "-oStreamLocalBindUnlink=yes",
        "-NL",
    ]
    .iter()
    .map(|it| (*it).to_string())
    .collect();
    expected.push(format!("{}:{SOCKTAINER_SOCKET}", local_end()));
    expected.push("tester@192.168.122.5".to_string());
    assert_eq!(
        command
            .argv()
            .iter()
            .map(|it| (*it).to_string())
            .collect::<Vec<_>>(),
        expected,
        "the two ends must be the ones the settings already carry, not a second derivation free to \
         disagree with the first"
    );
    assert_eq!(
        opts.check_status,
        ReadinessCheck::ApiAnswers {
            endpoint: Endpoint::UnixSocket(local_end()),
            headers: vec![
                ("Host".to_string(), "localhost".to_string()),
                ("Accept".to_string(), "application/json".to_string()),
                ("Content-Type".to_string(), "application/json".to_string()),
                (
                    "User-Agent".to_string(),
                    format!("Container Desktop {APP_VERSION}")
                ),
            ],
        },
        "the ENGINE answering down the forward is what proves it bound — `ssh -NL` accepts locally \
         with its channel refused by the remote, which is `startTunnel`'s own `checkStatus`"
    );
    assert_eq!(
        (opts.retry.count, opts.retry.wait),
        (TUNNEL_READINESS_ATTEMPTS, TUNNEL_READINESS_WAIT),
        "the tunnel's own ceiling, not the engine API's"
    );
    assert_eq!(id, ServiceId(format!("api:{APPLE}")));
}

#[tokio::test]
async fn a_remote_connection_asked_to_start_the_api_runs_nothing_on_this_machine() {
    // The bug asking the TRANSPORT first removes. `build_service_args` is the dialect's answer and
    // Podman's is not `None`, so the dialect would hand back `podman system service unix://<local>`
    // — and the machine would run it HERE, with the REMOTE's program path. It would look like a
    // working connection to a local engine. A bridged remote spawns nothing at all.
    let mut harness = bridged(true);

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);
    assert!(
        harness.spawned().is_empty(),
        "the bridge is the data plane: {:?}",
        harness.spawned()
    );
}

#[tokio::test]
async fn a_forward_that_cannot_be_opened_fails_the_attempt_instead_of_reporting_ready() {
    // The engine's own service is forgiven a failed start, because something outside the app may
    // already have started it. A forward is the opposite: nothing else can have opened it, so
    // continuing would publish a data plane that does not exist. The transport refuses it HERE, with
    // the reason only it can give — `SSH_FORWARD_FAILED`, not the `API_UNREACHABLE` the availability
    // check would reach for a socket nobody bound.
    let mut harness = Harness::over(
        options(apple_remote("engine"), false),
        linux_offering(vec![ssh_scope("engine")]),
        FakeCommand::answering(apple_remote_is_healthy).refusing_services(),
    );

    harness.connect(0).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    assert_eq!(
        harness.machine.runtime_info().error.expect("a reason").code,
        DiagnosticCode::SshForwardFailed
    );
    assert_eq!(
        harness.killed(),
        vec![format!("api:{APPLE}")],
        "the forward is stopped on the way out: a spawn that failed part-way still leaves a child \
         the capability is holding"
    );
}

#[tokio::test]
async fn a_remote_whose_engine_socket_was_never_reported_refuses_to_forward_to_nothing() {
    // Detection could not read a remote socket, so there is no far end. Reaching `ready` here is the
    // failure mode: the local address IS resolved, so the availability verdict says yes, and every
    // request through the forward then fails separately with nothing to point at the cause.
    let mut harness = Harness::new(
        options(podman_remote("engine"), false),
        linux_offering(vec![ssh_scope("engine")]),
        |argv| {
            if argv.contains(&"echo") {
                return CommandExecutionResult::ok("SSH connection established\n");
            }
            if argv.contains(&"which") {
                return CommandExecutionResult::ok("/usr/bin/podman\n");
            }
            if argv.contains(&"--version") {
                return CommandExecutionResult::ok("podman version 5.6.2");
            }
            CommandExecutionResult::failed(125, "Cannot connect")
        },
    );

    harness.connect(0).await;

    assert!(
        harness.spawned().is_empty(),
        "nothing is spawned when there is nothing to forward to: {:?}",
        harness.spawned()
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Failed);
    let error = harness.machine.runtime_info().error.expect("a reason");
    assert_eq!(error.code, DiagnosticCode::SshForwardFailed);
    assert_eq!(
        error.params.get("relay").and_then(|it| it.as_str()),
        Some(""),
        "the diagnostic names the settings field that is empty"
    );
}

#[tokio::test]
async fn a_disconnect_stops_the_forward_the_attempt_opened() {
    let mut harness = remote(false);
    harness.connect(0).await;
    assert_eq!(harness.machine.phase(), ConnectionPhase::Ready);

    harness.disconnect(1).await;

    assert_eq!(
        harness.killed(),
        vec![format!("api:{APPLE}")],
        "an `ssh -NL` outliving its connection is the orphan this teardown exists to prevent"
    );
    assert_eq!(harness.machine.phase(), ConnectionPhase::Idle);
}

#[tokio::test]
async fn a_dropped_connection_stops_its_old_forward_before_a_retry_opens_another() {
    // `StreamLocalBindUnlink=yes` means the next forward UNLINKS the socket the previous one bound,
    // so a retry that leaves the old child running orphans a process holding a socket nobody can
    // reach — and it looks, to `ps`, exactly like a working tunnel.
    let mut harness = remote(false);
    harness.connect(0).await;

    harness.dropped(0, DiagnosticCode::ApiUnreachable).await;

    assert_eq!(harness.machine.phase(), ConnectionPhase::Reconnecting);
    assert_eq!(harness.killed(), vec![format!("api:{APPLE}")]);
}
