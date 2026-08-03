//! Live SSH verification. NOT part of the default `cargo test`.
//!
//! **Targets come from `src/__tests__/live/targets.env`** — the gitignored file the TypeScript live
//! suite already reads (`targets.example.env` is committed beside it). This suite is a second READER of
//! it, not a second convention: a machine is declared once. Which target, and how it is reached, is
//! [`live`]; what must be true when it is reached is here.
//!
//! ```sh
//! # nothing to set when targets.env already declares an enabled SSH target:
//! cargo test -p cdc-runtime-host-native --features live-ssh --test live_ssh -- --nocapture
//! # or point it somewhere directly — these WIN over the file:
//! export CDC_LIVE_SSH_SCOPE=<alias or host>          # the POSIX remote
//! export CDC_LIVE_SSH_WINDOWS_SCOPE=win11            # the Windows remote
//! export CDC_LIVE_SSH_ENGINE=docker                  # or podman; else taken from _HOSTS
//! ```
//!
//! Everything else about this transport is asserted as argv in the hermetic suite, and `cargo test`
//! never runs any of it. Three things only a real host can settle, and the first is the reason this
//! file exists:
//!
//! - **The preflight's stderr classification has no oracle.** `diagnostics/ssh-preflight.ts` returns
//!   `ssh`'s first stderr line for a renderer to show; the CODES come from the design's vocabulary and
//!   the PATTERNS from OpenSSH's messages. A recorded scenario can only pin the classification of
//!   invented stderr, so the patterns themselves are unverified until a real `ssh` produces them.
//! - **`list_scopes` against a real `~/.ssh/config`**, compared with what `ssh -G` resolves.
//! - **`config_host` against a real alias** — that `-i` and `-p` are suppressed AND the alias still
//!   reaches the host.
//!
//! The target is named by environment rather than hard-coded: a live host is the runner's, and a
//! committed hostname is either someone's machine or a lie. Every command here is READ-ONLY —
//! `echo`, `which`, `--version`, `context inspect`, `GET /_ping`. Nothing is created on the remote.

#![cfg(feature = "live-ssh")]

mod live;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use cdc_runtime::capabilities::command::HostCommand;
use cdc_runtime::domain::diagnostic::Diagnostic;
use cdc_runtime::domain::types::connection::SshHost;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::ContainerEngine;
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectOrigin, ConnectionPhase};
use cdc_runtime::runtimes::composition::HostContext;
use cdc_runtime_host_native::fs::StdFs;
use cdc_runtime_host_native::ssh_config::list_scopes;
use live::{
    Live, bare_scope, bridges_running, forwards_running, home, live_host, live_machine, param, run,
    scope, scope_of, short_user_data, target,
};

/// Ask the REAL transport why a scope would not come up, against a real `ssh`.
async fn preflight(scope: SshHost, extra: &[String]) -> Option<Diagnostic> {
    let host = live_host(
        ContainerEngine::Podman,
        scope,
        Arc::new(Live::with_extra(extra)),
    );
    host.transport().diagnose_scope(&host, None).await
}

#[tokio::test]
async fn a_closed_port_is_reported_unreachable_with_the_reason_ssh_gave() {
    // Provoked against loopback rather than the live host: a refusal is a refusal, and nothing is
    // asked of anyone else's machine to observe one.
    let verdict = preflight(bare_scope("127.0.0.1", 1, "nobody"), &[])
        .await
        .expect("a fault");

    assert_eq!(
        verdict.code,
        DiagnosticCode::SshUnreachable,
        "params: {:?}",
        verdict.params
    );
    let reason = param(&verdict, "reason")
        .and_then(|it| it.as_str())
        .unwrap_or_default();
    // The reason is passed through rather than matched, so what is asserted is that it SAYS something
    // — an empty reason is the failure this field exists to prevent.
    assert!(
        reason.contains("port 1"),
        "the reason must carry what ssh actually said, got {reason:?}"
    );
    assert_eq!(param(&verdict, "port").and_then(|it| it.as_i64()), Some(1));
}

#[tokio::test]
async fn a_user_the_host_refuses_is_reported_as_an_auth_failure() {
    // BatchMode makes this a refusal rather than a password prompt, which is the whole reason the
    // argv carries it. No key material is needed: an account the host does not have cannot be
    // authenticated by any key the agent offers.
    let host = scope();

    let verdict = preflight(
        bare_scope(&host.host_name, host.port, "cdc-no-such-user"),
        &[],
    )
    .await
    .expect("a fault");

    assert_eq!(
        verdict.code,
        DiagnosticCode::SshAuthFailed,
        "params: {:?}",
        verdict.params
    );
    assert_eq!(
        param(&verdict, "user").and_then(|it| it.as_str()),
        Some("cdc-no-such-user"),
        "the diagnostic names who was refused"
    );
}

/// A `known_hosts` naming the target with a key that is NOT its key.
///
/// Built from the host's REAL key with one character of the base64 changed, deep inside the key
/// material and past the type string and its length prefix. A hand-written key would be rejected as
/// malformed and silently ignored, which reads as "no mismatch" — the failure this fixture must not
/// have.
async fn known_hosts_with_a_stale_key(host: &SshHost, directory: &Path) -> PathBuf {
    let scanned = run(&HostCommand::new(
        "ssh-keyscan",
        &[
            "-T",
            "10",
            "-t",
            "ed25519",
            "-p",
            &host.port.to_string(),
            &host.host_name,
        ],
    ))
    .await;
    let line = scanned
        .stdout
        .lines()
        .find(|line| !line.starts_with('#') && !line.trim().is_empty())
        .unwrap_or_else(|| panic!("ssh-keyscan found no ed25519 key: {}", scanned.stderr))
        .to_string();
    let mut fields = line.split(' ').collect::<Vec<_>>();
    assert_eq!(fields.len(), 3, "unexpected known_hosts line: {line}");
    let key = fields[2];
    let at = key.len() - 8;
    let stale = format!(
        "{}{}{}",
        &key[..at],
        if key.as_bytes()[at] == b'B' { 'C' } else { 'B' },
        &key[at + 1..]
    );
    fields[2] = &stale;
    let path = directory.join("known_hosts");
    std::fs::write(&path, format!("{}\n", fields.join(" "))).expect("write known_hosts");
    path
}

#[tokio::test]
async fn a_changed_host_key_is_reported_as_a_key_change_and_not_as_unreachable() {
    // The ORDER in `probe_fault` is what this proves. OpenSSH prints "Host key verification failed"
    // for a mismatch, and a classifier that reached its unreachable arm first would send someone to
    // check their network when the fix is `known_hosts`.
    let host = scope();
    let directory = tempfile::tempdir().expect("temp dir");
    let known_hosts = known_hosts_with_a_stale_key(&host, directory.path()).await;

    let verdict = preflight(
        bare_scope(&host.host_name, host.port, "nobody"),
        &[
            format!("-oUserKnownHostsFile={}", known_hosts.display()),
            "-oGlobalKnownHostsFile=/dev/null".to_string(),
        ],
    )
    .await
    .expect("a fault");

    assert_eq!(
        verdict.code,
        DiagnosticCode::SshHostKeyChanged,
        "params: {:?}",
        verdict.params
    );
}

#[tokio::test]
async fn a_healthy_scope_passes_the_preflight_with_no_fault_at_all() {
    // The negative case, and it is the one that would go unnoticed: a classifier that answered
    // `SSH_UNREACHABLE` for everything would pass all three tests above.
    let verdict = preflight(scope(), &[]).await;

    assert_eq!(verdict, None, "a reachable host reported a fault");
}

/// What `ssh -G <alias>` resolves, as (keyword, value) pairs in the order printed.
async fn resolved_config(alias: &str) -> Vec<(String, String)> {
    let outcome = run(&HostCommand::new("ssh", &["-G", alias])).await;
    assert!(
        outcome.success(),
        "ssh -G {alias} failed: {}",
        outcome.stderr
    );
    outcome
        .stdout
        .lines()
        .filter_map(|line| line.split_once(' '))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn first<'a>(resolved: &'a [(String, String)], keyword: &str) -> Option<&'a str> {
    resolved
        .iter()
        .find(|(key, _)| key == keyword)
        .map(|(_, value)| value.as_str())
}

#[tokio::test]
async fn list_scopes_agrees_with_ssh_dash_g_about_every_alias_it_offers() {
    // The parser is `ssh2-config`'s, so what is verified here is not its grammar but the MAPPING:
    // every scope this core would offer a user must resolve to the host `ssh` itself would dial.
    // Checked against the whole real config rather than one alias, because the divergence this would
    // catch is a keyword shape that happens not to appear in the target's own block.
    let home = home();
    let scopes = list_scopes(&StdFs, Path::new(&home)).expect("~/.ssh/config is readable");
    assert!(!scopes.is_empty(), "no scopes in ~/.ssh/config to compare");

    for host in &scopes {
        let resolved = resolved_config(&host.name).await;
        assert_eq!(
            first(&resolved, "hostname"),
            Some(host.host_name.as_str()),
            "{}: hostname",
            host.name
        );
        assert_eq!(
            first(&resolved, "port").map(str::to_string),
            Some(host.port.to_string()),
            "{}: port",
            host.name
        );
        if host.user.is_empty() {
            // Absent, not defaulted: the schema carries what the file SAID, and `ssh` fills the
            // local account in itself. A scope that guessed one would connect as the wrong user the
            // day the two differ.
            assert_eq!(
                first(&resolved, "user"),
                std::env::var("USER").ok().as_deref(),
                "{}: an unset user must resolve to the local account",
                host.name
            );
        } else {
            assert_eq!(
                first(&resolved, "user"),
                Some(host.user.as_str()),
                "{}: user",
                host.name
            );
        }
        if !host.identity_file.is_empty() {
            let offered = resolved
                .iter()
                .filter(|(key, _)| key == "identityfile")
                .map(|(_, value)| value.replace('~', &home))
                .collect::<Vec<_>>();
            assert!(
                offered.contains(&host.identity_file),
                "{}: {} is not among the identities ssh would try: {offered:?}",
                host.name,
                host.identity_file
            );
        }
    }
}

#[tokio::test]
async fn a_scoped_command_reaches_the_host_the_way_the_target_is_declared() {
    // Two shapes, and which one runs depends on the target: an alias exercises `config_host`, which
    // suppresses `-i` AND `-p` so the `~/.ssh/config` entry decides both, and a bare host exercises the
    // explicit `-p`/`-i` argv. The hermetic suite pins both shapes; what it cannot show is that either
    // still CONNECTS — an alias whose identity was suppressed and never picked up looks identical and
    // fails only at runtime. Asserted per shape rather than skipped, so the run always proves something
    // and always says which.
    let host = scope();
    let alias = host.config_host.clone();
    let expected_port = host.port.to_string();
    let command = Arc::new(Live::default());
    let client = live_host(ContainerEngine::Podman, host, Arc::clone(&command));
    let settings = client.settings().await;

    let outcome = client
        .transport()
        .run_scope_command(&client, "echo", &["cdc-live-ok".to_string()], &settings)
        .await
        .expect("the scope is usable");

    let argv = command.recorded().pop().expect("one invocation");
    match &alias {
        Some(alias) => {
            println!("live: config_host shape, alias {alias}");
            assert!(
                !argv.iter().any(|arg| arg == "-i" || arg == "-p"),
                "the alias owns the identity and the port: {argv:?}"
            );
            assert!(argv.contains(alias), "{argv:?}");
        }
        None => {
            println!(
                "live: explicit shape — point the target at a ~/.ssh/config alias to cover config_host"
            );
            assert!(
                argv.windows(2).any(|pair| pair == ["-p", &expected_port]),
                "a host without an alias carries its port explicitly: {argv:?}"
            );
        }
    }
    assert!(outcome.success(), "stderr: {}", outcome.stderr);
    assert_eq!(outcome.stdout.trim(), "cdc-live-ok");
}

#[tokio::test]
async fn a_live_remote_reaches_its_engine_over_a_real_stdio_bridge() {
    // `ssh -NL` is no longer the data plane for a podman or docker remote: `resolveDialStdioBridge`
    // answers for every reachable endpoint, and `ssh-transport.ts` picks between the bridge and the
    // forward on that one field. Reaching `ready` here is the whole plane and not merely an address
    // that resolved — the availability check runs a real `GET /_ping` through `Endpoint::Stdio`.
    let target = target(false);
    println!("live: target {} ({})", target.id, target.ssh_host);
    let user_data = short_user_data();
    let mut machine = live_machine(
        &target.engine(),
        scope_of(&target),
        &user_data.path().to_string_lossy(),
    );

    machine.connect(ConnectOrigin::Bootstrap, None).await;

    let info = machine.runtime_info();
    assert_eq!(
        machine.phase(),
        ConnectionPhase::Ready,
        "the connection failed: {:?}",
        info.error
    );
    println!(
        "live: uri={:?} relay={:?} version={:?}",
        info.uri, info.relay, info.version
    );

    let bridge = machine.settings().api.connection.dial_stdio_command.clone();
    println!("live: bridge={bridge:?}");
    assert_eq!(
        bridge.first().map(String::as_str),
        Some("ssh"),
        "{bridge:?}"
    );
    assert_eq!(
        &bridge[bridge.len() - 2..],
        &["system".to_string(), "dial-stdio".to_string()],
        "{bridge:?}"
    );
    assert_eq!(
        forwards_running(&user_data.path().to_string_lossy()),
        0,
        "a forward as well as a bridge is a second data plane nobody chose"
    );

    machine.disconnect().await;

    assert_eq!(machine.phase(), ConnectionPhase::Idle);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(
        bridges_running(),
        0,
        "an `ssh` holding a dial-stdio channel outlived the request that opened it"
    );
}

#[tokio::test]
async fn a_windows_remote_reaches_its_named_pipe_over_the_bridge() {
    // The win11 QEMU host. Recorded live so nobody has to boot the VM to learn it:
    //   where docker            -> C:\Program Files\Docker\Docker\resources\bin\docker (+ .exe)
    //   docker --version        -> Docker version 29.6.1, build 8900f1d
    //   docker context inspect  -> Host = npipe:////./pipe/dockerDesktopLinuxEngine
    //   which docker / uname -s -> not recognized as an internal or external command
    //
    // That pipe is why this connection used to fail at `SSH_FORWARD_FAILED`, which was the honest
    // answer while there was no bridge: `ssh -NL` cannot forward a named pipe at all. `docker system
    // dial-stdio` on the remote reaches it, so a Windows Docker remote going green is the deliverable.
    //
    // The program is `settings.program.name` and not the detected path for a reason this host is the
    // proof of: its path has spaces in it, and the outer `ssh` hands the command to cmd.exe.
    let target = target(true);
    println!("live windows: target {} ({})", target.id, target.ssh_host);
    let user_data = short_user_data();
    let mut machine = live_machine(
        &target.engine(),
        scope_of(&target),
        &user_data.path().to_string_lossy(),
    );

    machine.connect(ConnectOrigin::Bootstrap, None).await;

    let info = machine.runtime_info();
    println!(
        "live windows: phase={:?} error={:?} uri={:?} relay={:?} version={:?}",
        machine.phase(),
        info.error,
        info.uri,
        info.relay,
        info.version
    );
    assert_ne!(
        info.error.as_ref().map(|it| it.code.clone()),
        Some(DiagnosticCode::SshUnreachable),
        "the Windows host is not answering — start the VM (`virsh start win11`) and give it ~30s; \
         SSH opens well after the domain is running"
    );
    assert_eq!(
        machine.phase(),
        ConnectionPhase::Ready,
        "a Windows remote is reachable over the bridge: {:?}",
        info.error
    );
    assert_eq!(
        info.relay.as_deref(),
        Some("npipe:////./pipe/dockerDesktopLinuxEngine"),
        "the endpoint is still the pipe — it is what the bridge reaches, not what a forward binds"
    );

    let bridge = machine.settings().api.connection.dial_stdio_command.clone();
    println!("live windows: bridge={bridge:?}");
    assert_eq!(
        &bridge[bridge.len() - 3..],
        &[
            "docker".to_string(),
            "system".to_string(),
            "dial-stdio".to_string()
        ],
        "a bare program name, never the `C:\\Program Files\\…` path cmd.exe would split: {bridge:?}"
    );
    assert_eq!(forwards_running(&user_data.path().to_string_lossy()), 0);

    machine.disconnect().await;
}
