//! The native host: the platform choices this crate makes, and the ones it reads from the machine.
//!
//! **What is asserted here is the DATA, not the syscalls.** `TokioCommand`, `StdFs` and `TokioHttp` are
//! `cdc-runtime-host-native`'s and are covered there; what belongs to this crate is the vocabulary it
//! translates into — node's architecture names, where the socket goes, and the one setting a connection
//! does not carry.

use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectionPhase;
use cdc_server::host::{
    APP_VERSION_VAR, NativeMachines, app_version, architecture, default_local_endpoint,
    native_server, scopes,
};
use cdc_server::server::MachineBuilder;

/// The seeded document, with a reconnect policy the oracle would honour.
fn document(retries: i64) -> String {
    format!(
        r#"{{
  "version": "5.2.19",
  "reconnect": {{ "enabled": true, "maxRetries": {retries}, "initialMs": 250, "maxMs": 4000 }},
  "connections": [
    {{
      "id": "host.default.podman.native",
      "name": "podman-native",
      "label": "Native",
      "engine": "podman",
      "host": "podman.native",
      "settings": {{
        "api": {{ "baseURL": "http://d", "connection": {{ "uri": "", "relay": "" }} }},
        "program": {{ "name": "podman", "path": "", "version": "" }},
        "rootfull": false,
        "mode": "mode.automatic"
      }}
    }}
  ]
}}"#
    )
}

fn connection() -> cdc_runtime::domain::types::connection::Connection {
    let document: serde_json::Value =
        serde_json::from_str(&document(3)).expect("the fixture is valid JSON");
    serde_json::from_value(document["connections"][0].clone()).expect("a connection")
}

fn written(contents: &str) -> (tempfile::TempDir, std::path::PathBuf) {
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-host-")
        .tempdir_in("/tmp")
        .expect("a temp dir");
    let path = directory.path().join("user-settings.json");
    std::fs::write(&path, contents).expect("the document is written");
    (directory, path)
}

#[test]
fn the_architecture_is_translated_into_the_oracle_s_vocabulary() {
    // `Platform.getOsArch()` is node's `process.arch`. The one gate that reads this is Apple's — a raw
    // `x86_64` reaching it would refuse a connector on a machine that can run it.
    assert_eq!(architecture("x86_64"), "x64");
    assert_eq!(architecture("aarch64"), "arm64");
    assert_eq!(
        architecture("riscv64gc"),
        "riscv64gc",
        "an architecture node has no name for travels as itself rather than as a guess"
    );
}

#[cfg(unix)]
#[test]
fn the_local_socket_sits_beside_the_document_it_serves() {
    // Same user, same machine, same directory as `user-settings.json` — a server whose socket lives
    // somewhere else is a server somebody ends up running twice.
    let endpoint = default_local_endpoint();

    assert_eq!(
        endpoint.file_name().and_then(|it| it.to_str()),
        Some("cdc-server.sock")
    );
    assert!(
        endpoint.is_absolute(),
        "a client is told this path: {}",
        endpoint.display()
    );
}

#[test]
fn a_machine_is_built_from_the_connection_it_was_handed() {
    // The builder performs no I/O — it composes. What it must get right is that the connection arrives
    // whole and the machine starts where a machine starts.
    let (_directory, path) = written(&document(3));
    let machines = NativeMachines::new(&path, "5.2.19");

    let machine = machines.build(connection());

    assert_eq!(machine.connection().id, "host.default.podman.native");
    assert_eq!(machine.phase(), ConnectionPhase::Idle);
}

#[test]
fn the_reconnect_policy_is_read_from_the_document_on_every_connect() {
    // A server runs for weeks, so a policy captured at startup is a server that ignores a setting the
    // user changed this morning. Read per build, which is what makes that impossible.
    let (_directory, path) = written(&document(7));
    let machines = NativeMachines::new(&path, "5.2.19");

    let policy = machines.build(connection()).policy().clone();

    assert_eq!(policy.max_retries, Some(7));
    assert_eq!(policy.initial_ms, 250);
    assert_eq!(policy.max_ms, 4000);
}

#[test]
fn the_global_proxy_is_read_from_the_document_and_carries_its_bypass_list() {
    // The one setting a connection inherits rather than owns. Read per build like the policy above,
    // and for the same reason: a server runs for weeks and the user edits this in an app.
    let (_directory, path) = written(
        r#"{"version":"5.2.19","proxy":{"mode":"manual","protocol":"http","host":"proxy.corp",
        "port":3128,"username":"","password":"","bypass":["example.com"]},"connections":[]}"#,
    );
    let machines = NativeMachines::new(&path, "5.2.19");

    let proxy = machines.global_proxy().expect("the document names one");

    assert_eq!(proxy.host, "proxy.corp");
    assert_eq!(proxy.port, 3128);
    assert_eq!(
        proxy.bypass,
        ["example.com"],
        "what the user typed, exactly — the loopback defaults are added by the resolution, so a \
         document read that added them would be deciding twice"
    );
}

#[test]
fn a_document_with_no_proxy_and_one_that_cannot_be_read_both_mean_no_proxy() {
    // Absence and a shape this core does not model are the same answer here, and it is the answer a
    // machine that never configured a proxy gives: engine processes are started without the
    // variables, which is what they inherit anyway.
    let (_directory, path) = written(r#"{"version":"5.2.19","connections":[]}"#);
    assert!(
        NativeMachines::new(&path, "5.2.19")
            .global_proxy()
            .is_none()
    );

    let (_directory, path) =
        written(r#"{"version":"5.2.19","proxy":"through the office","connections":[]}"#);
    assert!(
        NativeMachines::new(&path, "5.2.19")
            .global_proxy()
            .is_none(),
        "a newer app's shape is the app's business and must not take the connection with it"
    );

    let (_directory, path) = written("{ not json");
    assert!(
        NativeMachines::new(&path, "5.2.19")
            .global_proxy()
            .is_none()
    );
}

#[test]
fn a_document_with_no_policy_falls_back_to_the_oracle_s_own_default() {
    // Which is what the app does when a user has never touched the setting — so an absent key costs the
    // user's PREFERENCE and never the reconnect itself.
    let (_directory, path) = written(r#"{"version":"5.2.19","connections":[]}"#);
    let machines = NativeMachines::new(&path, "5.2.19");

    let policy = machines.build(connection()).policy().clone();

    assert!(policy.enabled, "a missing key must not stop it retrying");
    assert_eq!(policy.initial_ms, 1000, "the oracle's own 1s");
    assert_eq!(policy.max_ms, 30_000, "to 30s");
    assert_eq!(policy.max_retries, None, "and it does not give up");
}

#[test]
fn an_unreadable_document_still_builds_a_machine_that_reconnects() {
    // The worse failure by far would be a server that stopped retrying because a JSON key was missing.
    let (_directory, path) = written("{ not json");
    let machines = NativeMachines::new(&path, "5.2.19");

    let policy = machines.build(connection()).policy().clone();

    assert!(policy.enabled);
}

#[test]
fn a_policy_this_core_does_not_understand_is_ignored_rather_than_fatal() {
    // The document is shared with an app that may be newer. A shape this core cannot read is the app's
    // business, and it must not take the connection with it.
    let (_directory, path) =
        written(r#"{"version":"5.2.19","reconnect":"aggressively","connections":[]}"#);
    let machines = NativeMachines::new(&path, "5.2.19");

    let policy = machines.build(connection()).policy().clone();

    assert!(policy.enabled);
    assert_eq!(policy.initial_ms, 1000);
}

#[test]
fn a_home_with_no_ssh_config_offers_no_scopes() {
    // Ordinary rather than exceptional: a machine with no `~/.ssh/config` has no controller scopes, and a
    // connection that names one refuses by itself with SCOPE_NOT_FOUND — which a client can already render.
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-home-")
        .tempdir_in("/tmp")
        .expect("a temp dir");

    assert!(scopes(&directory.path().to_string_lossy()).is_empty());
}

#[test]
fn an_unreadable_ssh_config_offers_no_scopes_rather_than_failing_the_connection() {
    // A directory where a file belongs is the cheapest unreadable file there is. What matters is that a
    // broken config costs the SCOPES and never the connect.
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-home-")
        .tempdir_in("/tmp")
        .expect("a temp dir");
    std::fs::create_dir_all(directory.path().join(".ssh/config"))
        .expect("a directory where a config file belongs");

    assert!(scopes(&directory.path().to_string_lossy()).is_empty());
}

/// Set by the parent, so the child asserts instead of spawning again.
const IN_THE_CHILD: &str = "CDC_NATIVE_SERVER_CHILD";

/// Printed by the child at the end. **The parent asserts on it**, because `--exact` with a name that
/// matches nothing runs zero tests and still exits 0 — a green parent proving nothing at all.
const REACHED_THE_END: &str = "cdc: the child read the relocated document";

#[test]
fn the_native_server_reads_the_document_the_desktop_app_is_using() {
    // The whole point of `native_server`: a core that resolved anything else would look like it worked
    // while managing a parallel universe of connections. The claim is about the ENVIRONMENT seam, so
    // it is made by a process born with the variable — `set_var` is `unsafe` in edition 2024, and this
    // harness is exactly the multi-threaded program the rule is about.
    if std::env::var(IN_THE_CHILD).is_err() {
        let directory = tempfile::Builder::new()
            .prefix("cdc-server-native-")
            .tempdir_in("/tmp")
            .expect("a temp dir");
        std::fs::write(
            directory.path().join("user-settings.json"),
            r#"{"version":"5.2.19","connections":[]}"#,
        )
        .expect("written");

        let output = std::process::Command::new(std::env::current_exe().expect("this test binary"))
            .args([
                "--exact",
                "the_native_server_reads_the_document_the_desktop_app_is_using",
                "--nocapture",
            ])
            .env(IN_THE_CHILD, "1")
            // The same seam the desktop app uses to relocate its own data.
            .env("CONTAINER_DESKTOP_USER_DATA_DIR", directory.path())
            .output()
            .expect("the child test binary runs");

        let said = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success(), "the child failed:\n{said}");
        assert!(
            said.contains(REACHED_THE_END),
            "the child ran no test — was this one renamed?\n{said}"
        );
        return;
    }

    let snapshot = native_server("5.2.19")
        .snapshot()
        .expect("the document is readable");

    assert!(snapshot.connections.is_empty());
    assert!(snapshot.running, "a server that is answering is up");
    println!("{REACHED_THE_END}");
}

#[test]
fn a_real_ssh_config_becomes_the_scopes_a_connection_can_name() {
    // The other direction, and the one that matters: a host declared in `~/.ssh/config` has to arrive as a
    // scope, through the real parser. Asserting only that a broken config yields NOTHING would pass
    // against a function that always yields nothing.
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-home-")
        .tempdir_in("/tmp")
        .expect("a temp dir");
    std::fs::create_dir_all(directory.path().join(".ssh")).expect("an .ssh directory");
    std::fs::write(
        directory.path().join(".ssh/config"),
        "Host devbox\n  HostName 192.168.122.5\n  User tester\n  Port 2222\n",
    )
    .expect("a config the parser can read");

    let offered = scopes(&directory.path().to_string_lossy());

    let ControllerScope::SshHost(host) = offered.first().expect("the declared host") else {
        panic!("a declared host arrives as an SSH scope: {offered:?}");
    };
    assert_eq!(host.name, "devbox");
    assert_eq!(host.host_name, "192.168.122.5");
    assert_eq!(host.port, 2222);
    assert_eq!(host.user, "tester");
}

#[test]
fn the_app_version_is_the_one_the_desktop_app_ships_rather_than_this_crate_s() {
    // **The document's `version` key is the APP's**, and there are now two binaries that
    // write it — this server and the terminal's embedded one. A default that leaked a crate version
    // into a user's settings file would tell the desktop app it had been downgraded.
    let shipped = std::env::var(APP_VERSION_VAR).ok();

    let reported = app_version();

    match shipped {
        Some(version) => assert_eq!(reported, version, "whatever ships them says which"),
        None => assert_eq!(
            reported,
            env!("CARGO_PKG_VERSION"),
            "and only when nothing says otherwise is the crate's own used"
        ),
    }
}
