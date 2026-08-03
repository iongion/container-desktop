//! Which SCOPES a podman-machine host offers, and which one it defaults to.
//!
//! Split out of `podman_machine_transport.rs`, which was over the 600-line cap. The subject divides
//! cleanly: this file is `list_scopes` + `controller_default_scope` — how the machines are found and
//! which one is chosen — while the transport file keeps entering, starting and stopping them.

use std::sync::{Arc, Mutex};

use crate::fakes::{Asked, FakeCommand, unit_host_controlled, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::types::connection::EngineConnectorSettings;
use cdc_runtime::domain::types::engine::Controller;
use cdc_runtime::domain::types::machine::{ControllerScope, PodmanMachine};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostContext, Transport};
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::podman::PodmanVendorProfile;
use cdc_runtime::runtimes::transports::podman_machine::{PodmanMachineTransport, podman_machines};

const CONNECTION: &str = "host.default.podman.vendor";
const PODMAN: &str = "/usr/bin/podman";

/// A machine as `podman machine list --format json` reports one, once normalized.
fn machine(name: &str, running: bool) -> ControllerScope {
    ControllerScope::PodmanMachine(
        serde_json::from_value(serde_json::json!({
            "Name": name,
            "Type": "PodmanMachine",
            "Active": true,
            "Created": "c",
            "LastUp": "l",
            "Running": running,
            "Usable": running,
            "VMType": "qemu",
        }))
        .expect("machine fixture parses"),
    )
}

/// Settings a vendor connection carries: the controller IS podman, and the machine is named.
fn vendor_settings(scope: &str) -> EngineConnectorSettings {
    let mut settings = unit_settings();
    settings.controller = Some(Controller {
        auto: None,
        homepage: None,
        name: "podman".to_string(),
        path: PODMAN.to_string(),
        scope: (!scope.is_empty()).then(|| scope.to_string()),
        title: None,
        version: None,
    });
    settings
}

async fn vendor(
    os: OperatingSystem,
    scope: Option<ControllerScope>,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::runtimes::host_client::HostClient,
    Arc<Mutex<Asked>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host_controlled(
        CONNECTION,
        Box::new(PodmanMachineTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanVendorProfile),
        os,
        command,
        "podman",
    )
    .with_scope(scope);
    host.set_settings(vendor_settings("podman-machine-default"))
        .await;
    (host, log)
}

fn default_machine() -> Option<ControllerScope> {
    Some(machine("podman-machine-default", true))
}
#[tokio::test]
async fn the_machines_are_listed_and_normalized_the_way_the_picker_needs_them() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"list") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"}]"#,
            );
        }
        CommandExecutionResult::failed(1, "unexpected")
    })
    .await;

    let scopes = PodmanMachineTransport
        .list_scopes(&host, &vendor_settings("podman-machine-default"))
        .await
        .expect("the machines are listed");

    assert_eq!(scopes, vec![machine("podman-machine-default", true)]);
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![PODMAN, "machine", "list", "--format", "json"]
    );
}

#[test]
fn a_machine_list_gains_the_two_fields_podman_does_not_report() {
    // `Type` and `Usable` are the app's, and `Usable` IS `Running` — a picker that read `Usable` from
    // podman would find nothing there and offer every machine as usable.
    let listed = podman_machines(
        r#"[{"Name":"m","Active":false,"Created":"c","LastUp":"l","Running":false,"VMType":"wsl"}]"#,
    );
    assert_eq!(listed.len(), 1);
    assert!(!listed[0].usable);
    assert!(!listed[0].running);

    let running = podman_machines(
        r#"[{"Name":"m","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"wsl"}]"#,
    );
    assert!(running[0].usable, "usable IS running");

    // Unparseable output is no machines, and one malformed entry does not hide the others.
    assert!(podman_machines("not json").is_empty());
    assert!(podman_machines(r#"["a string"]"#).is_empty());
    let mixed = podman_machines(
        r#"[{"Name":"broken"},{"Name":"m","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"wsl"}]"#,
    );
    assert_eq!(
        mixed.iter().map(|it| it.name.as_str()).collect::<Vec<_>>(),
        vec!["m"],
        "the entry missing what the schema requires is dropped, the rest survive"
    );
}

#[tokio::test]
async fn the_default_scope_is_the_machine_behind_podmans_default_connection() {
    let (host, log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-default-root","IsMachine":true,"Default":true},
                    {"Name":"podman-machine-default","IsMachine":true,"Default":false}]"#,
            );
        }
        CommandExecutionResult::ok(
            r#"[{"Name":"podman-machine-default","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"}]"#,
        )
    })
    .await;

    assert_eq!(
        PodmanMachineTransport
            .controller_default_scope(&host, &vendor_settings(""))
            .await
            .expect("answers"),
        default_machine(),
        "the ROOTLESS machine, even though podman marked the rootful connection as its default"
    );
    assert_eq!(
        log.lock().expect("asked").argv[0],
        vec![PODMAN, "system", "connection", "list", "--format", "json"]
    );

    // A connection list that cannot be read is not a refusal — the machine list is still consulted,
    // and a single machine is used.
    let (fallback, _) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::failed(1, "podman: unknown command");
        }
        CommandExecutionResult::ok(
            r#"[{"Name":"podman-machine-default","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"}]"#,
        )
    })
    .await;
    assert_eq!(
        PodmanMachineTransport
            .controller_default_scope(&fallback, &vendor_settings(""))
            .await
            .expect("answers"),
        None,
        "with no connections at all there is no DEFAULT connection to map, and guessing one would \
         pick a machine podman does not point at"
    );
}

#[tokio::test]
async fn a_machine_that_cannot_be_listed_offers_no_scopes() {
    let (host, _) = vendor(OperatingSystem::Linux, default_machine(), |_| {
        CommandExecutionResult::failed(127, "podman: not found")
    })
    .await;

    assert!(
        PodmanMachineTransport
            .list_scopes(&host, &vendor_settings("podman-machine-default"))
            .await
            .expect("answers")
            .is_empty()
    );
}

/// A machine's own name, for the assertions that compare scopes by it.
fn scope_name(scope: &ControllerScope) -> &str {
    match scope {
        ControllerScope::PodmanMachine(PodmanMachine { name, .. }) => name,
        _ => panic!("a machine transport answers machines"),
    }
}

#[tokio::test]
async fn the_default_scope_matches_the_machine_case_insensitively() {
    // Podman's connection names and its machine names are not guaranteed to agree in case, and a
    // case-sensitive match would report "no default scope" for a machine that is right there.
    let (host, _) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"Podman-Machine-Default","IsMachine":true,"Default":true}]"#,
            );
        }
        CommandExecutionResult::ok(
            r#"[{"Name":"podman-machine-default","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"}]"#,
        )
    })
    .await;

    let resolved = PodmanMachineTransport
        .controller_default_scope(&host, &vendor_settings(""))
        .await
        .expect("answers")
        .expect("a machine was matched");
    assert_eq!(scope_name(&resolved), "podman-machine-default");
}

#[tokio::test]
async fn with_several_machines_the_default_is_the_one_the_connection_actually_names() {
    // With ONE machine `select_default_machine_scope_name` answers `OnlyMachine` and the name never
    // has to be right — so a single-machine fixture cannot tell a correct lookup from a broken one.
    // Two machines is what makes the NAME load-bearing, in both places it is read: building the
    // candidate list, and matching the chosen name back to a scope.
    let (host, _log) = vendor(OperatingSystem::Linux, default_machine(), |argv| {
        if argv.contains(&"connection") {
            return CommandExecutionResult::ok(
                r#"[{"Name":"podman-machine-work","URI":"ssh://core@127.0.0.1:1234/run/user/1000/podman/podman.sock","Identity":"/k","IsMachine":true,"Default":true}]"#,
            );
        }
        CommandExecutionResult::ok(
            r#"[{"Name":"podman-machine-default","Active":false,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"},
                {"Name":"podman-machine-work","Active":true,"Created":"c","LastUp":"l","Running":true,"VMType":"qemu"}]"#,
        )
    })
    .await;

    let resolved = PodmanMachineTransport
        .controller_default_scope(&host, &vendor_settings(""))
        .await
        .expect("answers")
        .expect("podman's default connection names a machine that exists");

    assert_eq!(
        scope_name(&resolved),
        "podman-machine-work",
        "the machine podman points at, NOT the first one listed"
    );
}
