//! `runtimes/dialects/podman-machine-connections.ts` — reading `podman system connection list`.
//!
//! Which machine a connection BELONGS to, and which of a machine's two connections this app wants:
//! podman's own default may be the rootful one, and this app targets rootless.

use cdc_runtime::runtimes::dialects::podman_machine_connections::{
    DefaultMachineScope, PodmanSystemConnection, is_rootful_connection_name,
    machine_name_from_connection_name, parse_system_connections,
    prefer_rootless_machine_connection, select_default_machine_scope_name,
};

fn connection(name: &str, is_machine: bool, default: bool, uri: &str) -> PodmanSystemConnection {
    PodmanSystemConnection {
        name: name.to_string(),
        uri: uri.to_string(),
        identity: String::new(),
        is_machine,
        default,
    }
}

#[test]
fn a_connection_list_podman_could_not_produce_is_no_connections() {
    // The original's `catch` answers `[]`, and so does this: a connection list that will not parse is
    // a reason to fall back to the machine list, never a reason to refuse.
    assert_eq!(parse_system_connections("not json"), Vec::new());
    assert_eq!(parse_system_connections("{}"), Vec::new());
    assert_eq!(parse_system_connections("[]"), Vec::new());
    // Every field defaults: an older podman omits what it does not have, and a missing `IsMachine`
    // must read as "not a machine" rather than hiding every other entry.
    assert_eq!(
        parse_system_connections(r#"[{"Name":"podman-machine-default"}]"#),
        vec![connection("podman-machine-default", false, false, "")]
    );
}

#[test]
fn the_rootful_suffix_is_recognised_and_stripped_case_insensitively() {
    for rootful in [
        "podman-machine-default-root",
        "podman-machine-default-ROOT",
        "  podman-machine-default-root  ",
    ] {
        assert!(is_rootful_connection_name(rootful), "{rootful}");
        assert_eq!(
            machine_name_from_connection_name(rootful),
            "podman-machine-default"
        );
    }
    for rootless in ["podman-machine-default", "", "-root", "rooted"] {
        assert!(!is_rootful_connection_name(rootless), "{rootless}");
    }
    assert_eq!(
        machine_name_from_connection_name("  podman-machine-default  "),
        "podman-machine-default",
        "and the name is trimmed either way, because podman pads its columns"
    );
    assert_eq!(
        machine_name_from_connection_name("-root"),
        "-root",
        "a name that is ONLY the suffix is not a rootful connection to a machine called nothing"
    );
}

#[test]
fn the_rootless_connection_wins_even_when_podman_marks_the_rootful_one_as_default() {
    let rootful_default = vec![
        connection("machine-root", true, true, ""),
        connection("machine", true, false, ""),
    ];
    assert_eq!(
        prefer_rootless_machine_connection(&rootful_default)
            .map(|it| it.name.as_str())
            .expect("a rootless connection is offered"),
        "machine",
        "this is the WSL case the original calls out: podman's default is the rootful one"
    );

    // Among several rootless ones, `Default` decides.
    let two_rootless = vec![
        connection("first", true, false, ""),
        connection("second", true, true, ""),
    ];
    assert_eq!(
        prefer_rootless_machine_connection(&two_rootless).map(|it| it.name.as_str()),
        Some("second")
    );

    // With nothing but rootful connections, one of them is still better than none — a machine that
    // offers no rootless connection is reachable only that way.
    let only_rootful = vec![
        connection("a-root", true, false, ""),
        connection("b-root", true, true, ""),
    ];
    assert_eq!(
        prefer_rootless_machine_connection(&only_rootful).map(|it| it.name.as_str()),
        Some("b-root")
    );
    assert_eq!(prefer_rootless_machine_connection(&[]), None);
}

#[test]
fn the_default_scope_is_the_machine_behind_podmans_default_connection() {
    let machines = vec!["podman-machine-default".to_string()];
    let list = vec![
        connection("podman-machine-default-root", true, true, ""),
        connection("podman-machine-default", true, false, ""),
    ];

    assert_eq!(
        select_default_machine_scope_name(&list, &machines),
        DefaultMachineScope::Matched {
            connection: "podman-machine-default".to_string(),
            machine: "podman-machine-default".to_string(),
            rootful_remapped: false,
        }
    );

    // A rootful default with NO rootless sibling is remapped to the machine it names, and the remap is
    // recorded — it is the difference between "podman agrees with us" and "we overrode podman".
    assert_eq!(
        select_default_machine_scope_name(
            &[connection("podman-machine-default-root", true, true, "")],
            &machines
        ),
        DefaultMachineScope::Matched {
            connection: "podman-machine-default-root".to_string(),
            machine: "podman-machine-default".to_string(),
            rootful_remapped: true,
        }
    );
}

#[test]
fn a_default_connection_that_names_no_known_machine_falls_back_only_to_a_sole_machine() {
    // A connection list that disagrees with the machine list is podman's business; refusing to connect
    // over it would strand a machine that works. With MORE than one machine there is nothing to guess.
    assert_eq!(
        select_default_machine_scope_name(
            &[connection("stale", true, true, "")],
            &["only-machine".to_string()]
        ),
        DefaultMachineScope::OnlyMachine {
            connection: "stale".to_string(),
            machine: "only-machine".to_string(),
        }
    );
    let ambiguous = select_default_machine_scope_name(
        &[connection("stale-root", true, true, "")],
        &["one".to_string(), "two".to_string()],
    );
    assert_eq!(
        ambiguous,
        DefaultMachineScope::NoMatch {
            connection: "stale-root".to_string(),
            machine: "stale".to_string(),
        },
        "and it names the connection AND the machine it mapped to, which is what a fix needs"
    );
    assert_eq!(ambiguous.machine(), None);

    // Nothing at all.
    assert_eq!(
        select_default_machine_scope_name(&[], &["one".to_string()]),
        DefaultMachineScope::NoConnections
    );
    assert_eq!(DefaultMachineScope::NoConnections.machine(), None);

    // No MACHINE connection, but connections exist: the first is used, exactly as the original falls
    // back — and it matches by machine name, case-insensitively.
    assert_eq!(
        select_default_machine_scope_name(
            &[connection("Podman-Machine-Default", false, false, "")],
            &["podman-machine-default".to_string()]
        ),
        DefaultMachineScope::Matched {
            connection: "Podman-Machine-Default".to_string(),
            machine: "podman-machine-default".to_string(),
            rootful_remapped: false,
        }
    );
}
