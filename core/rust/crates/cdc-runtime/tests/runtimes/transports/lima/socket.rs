//! What address a LIMA connection is given, and where that address comes from.
//!
//! Split out of `transports/lima.rs` for the 620-line cap; the fixtures are its.

use crate::fakes::{FakeCommand, unit_host_controlled};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::Transport;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::shared::LimaProfile;
use cdc_runtime::runtimes::transports::lima::{LimaTransport, forwarded_socket};

use super::{CONNECTION, LIMACTL, REPORT, lima_settings, mac, running_instance};

const PODMAN_GUEST: &str = "/run/user/501/podman/podman.sock";
const DOCKER_GUEST: &str = "/var/run/docker.sock";

#[test]
fn the_forward_chosen_is_the_one_whose_guest_socket_the_engine_reported() {
    // Both engines forwarded by one instance. Read off a real Mac: docker answers
    // `/var/run/docker.sock` and podman `/run/user/501/podman/podman.sock`, and those are exactly
    // the `guestSocket` values LIMA records — so the match is an equality, not a heuristic.
    assert_eq!(
        forwarded_socket(REPORT, PODMAN_GUEST),
        "/Users/tester/.lima/lima-podman/sock/podman.sock"
    );
    assert_eq!(
        forwarded_socket(REPORT, DOCKER_GUEST),
        "/Users/tester/.lima/lima-podman/sock/second.sock",
        "the SECOND rule, which the first-match fallback could never reach — without this the \
         docker connector would silently manage podman's engine"
    );
}

#[test]
fn an_engine_that_named_no_socket_takes_the_first_forward() {
    for (guest, why) in [
        ("", "nothing answered, so there is nothing to match on"),
        (
            "/run/nowhere.sock",
            "no forward names what this engine reported",
        ),
    ] {
        assert_eq!(
            forwarded_socket(REPORT, guest),
            "/Users/tester/.lima/lima-podman/sock/podman.sock",
            "{why} — LIMA's own precedence, first rule that names a socket"
        );
    }
}

#[test]
fn nothing_forwarded_names_nothing() {
    for (report, why) in [
        ("", "nothing was printed"),
        ("not json", "the line does not parse"),
        (
            r#"{"name":"i","config":{"portForwards":null}}"#,
            "LIMA prints null for an instance that forwards nothing",
        ),
        (
            r#"{"name":"i","config":{"portForwards":[]}}"#,
            "an empty rule list forwards nothing",
        ),
        (
            r#"{"name":"i","config":{}}"#,
            "the config carries no rules at all",
        ),
        (r#"{"name":"i"}"#, "there is no config"),
        (
            r#"{"name":"i","config":{"portForwards":[{"hostSocket":""}]}}"#,
            "an empty socket is not a socket",
        ),
    ] {
        assert_eq!(forwarded_socket(report, PODMAN_GUEST), "", "{why}");
        assert_eq!(forwarded_socket(report, ""), "", "{why}");
    }
}

#[tokio::test]
async fn an_instance_that_forwards_no_socket_falls_back_to_the_engine_agnostic_convention() {
    let (host, _) = mac(running_instance(), |_| {
        CommandExecutionResult::ok(r#"{"name":"lima-podman","config":{"portForwards":null}}"#)
    })
    .await;
    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&host, &lima_settings("lima-podman"), PODMAN_GUEST)
            .await,
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock",
        "the last resort, and it is only ever right for an instance named after its engine"
    );

    let (refusing, _) = mac(running_instance(), |_| {
        CommandExecutionResult::failed(1, "unknown flag: --format")
    })
    .await;
    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&refusing, &lima_settings("lima-podman"), PODMAN_GUEST)
            .await,
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock",
        "a limactl that cannot be asked leaves the connection exactly as it was before it was"
    );

    let command = FakeCommand::answering(|_| CommandExecutionResult::ok(REPORT));
    let log = command.log();
    let linux = unit_host_controlled(
        CONNECTION,
        Box::new(LimaTransport),
        Box::new(PodmanDialect),
        Box::new(LimaProfile::PODMAN),
        OperatingSystem::Linux,
        command,
        "limactl",
    )
    .with_scope(running_instance());
    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&linux, &lima_settings("lima-podman"), PODMAN_GUEST)
            .await,
        "/home/tester/.lima/lima-podman/sock/lima-podman.sock",
        "LIMA exists on no other OS, so asking there is a slow failure dressed up as \"no socket\""
    );
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "and nothing was spawned to find that out"
    );
}

#[tokio::test]
async fn the_imposed_address_is_the_socket_lima_reports_it_forwards() {
    let (host, log) = mac(running_instance(), |argv| {
        CommandExecutionResult::ok(if argv.contains(&"json") { REPORT } else { "" })
    })
    .await;

    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&host, &lima_settings("lima-podman"), PODMAN_GUEST)
            .await,
        "/Users/tester/.lima/lima-podman/sock/podman.sock",
        "named by the TEMPLATE's `hostSocket`, never by the instance — a real Mac answered \
         `sock/docker.sock` for an instance called `ubuntu-vm`"
    );
    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&host, &lima_settings("lima-podman"), DOCKER_GUEST)
            .await,
        "/Users/tester/.lima/lima-podman/sock/second.sock",
        "and the engine it is resolved FOR decides which forward, through the whole transport"
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![LIMACTL, "list", "--format", "json", "lima-podman"],
        "asked about ONE instance, so a second instance's forward can never be read as this one's"
    );
    assert_eq!(
        LimaTransport
            .resolve_scope_uri(&host, &lima_settings(""), PODMAN_GUEST)
            .await,
        "",
        "with no instance named there is no socket to name"
    );
    assert_eq!(
        LimaTransport.local_forward_fallback(&host).await,
        "",
        "nothing is forwarded: the socket is already on this machine"
    );
    assert_eq!(
        LimaTransport
            .resolve_guest_path(&host, "/Users/tester/ctx")
            .await,
        "/Users/tester/ctx",
        "LIMA mounts the home directory at the same path inside the VM"
    );
}
