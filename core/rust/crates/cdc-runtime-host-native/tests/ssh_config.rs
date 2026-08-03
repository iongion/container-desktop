//! `~/.ssh/config` read as controller scopes.
//!
//! The grammar belongs to `ssh2-config`, so what is asserted here is the part this core owns: which
//! file is read, which of the parser's hosts become SELECTABLE scopes, and how a `Host` block maps onto
//! the schema's `SSHHost`. The parser's own semantics — `Include`, `Match`, pattern matching, the
//! keyword table — are its tests, not a second copy of them here.
//!
//! Two of these are the departures from `node.ts:getSSHConfig` recorded: a multi-alias
//! `Host` line yields one scope PER alias, and `Connected` / `Usable` are absent rather than `false`.

use std::path::Path;

use cdc_runtime::domain::types::connection::{SshHost, SshHostType};
use cdc_runtime_host_native::fs::StdFs;
use cdc_runtime_host_native::paths::home_variable;
use cdc_runtime_host_native::ssh_config::list_scopes;

/// A home directory containing `.ssh/config` with these contents.
fn home_with_config(contents: &str) -> tempfile::TempDir {
    let home = tempfile::tempdir().expect("a temporary home");
    let ssh = home.path().join(".ssh");
    std::fs::create_dir_all(&ssh).expect("a .ssh directory");
    std::fs::write(ssh.join("config"), contents).expect("an ssh config");
    home
}

fn scopes(contents: &str) -> Vec<SshHost> {
    let home = home_with_config(contents);
    list_scopes(&StdFs, home.path()).expect("the config is read")
}

fn names(hosts: &[SshHost]) -> Vec<&str> {
    hosts.iter().map(|host| host.name.as_str()).collect()
}

fn only(contents: &str) -> SshHost {
    let mut hosts = scopes(contents);
    assert_eq!(
        hosts.len(),
        1,
        "expected exactly one scope from: {contents}"
    );
    hosts.remove(0)
}

/// `~/.ssh/<name>` as the parser expands it — against the PROCESS home, which is what it reads.
///
/// Built from `home_variable` and `Path::join` rather than `HOME` and a `/`, so it says the same thing on
/// Windows, where the variable is `USERPROFILE` and the separator is not a slash.
fn expanded(name: &str) -> String {
    let home = std::env::var(home_variable(std::env::consts::OS)).expect("a home directory");
    Path::new(&home)
        .join(".ssh")
        .join(name)
        .to_string_lossy()
        .into_owned()
}

#[test]
fn a_host_block_becomes_a_scope_with_every_field_filled_in() {
    assert_eq!(
        only(
            "Host prod\n  HostName 10.0.0.1\n  Port 2222\n  User deploy\n  IdentityFile ~/.ssh/id_ed25519\n"
        ),
        SshHost {
            name: "prod".to_string(),
            host: "prod".to_string(),
            host_name: "10.0.0.1".to_string(),
            port: 2222,
            user: "deploy".to_string(),
            // Already absolute: the parser expands `~` itself. See
            // `the_identity_file_is_expanded_against_the_process_home_not_the_one_passed_in`.
            identity_file: expanded("id_ed25519"),
            // Always the alias, which is what tells the argv builder to drop `-i` and `-p` and let
            // `ssh` read the entry this scope came from.
            config_host: Some("prod".to_string()),
            type_: SshHostType::SshConnection,
            connected: None,
            usable: None,
        }
    );
}

#[test]
fn a_host_line_with_several_aliases_yields_one_scope_each() {
    let hosts = scopes("Host web1 web2\n  HostName shared\n  Port 42\n  User deploy\n");
    assert_eq!(names(&hosts), vec!["web1", "web2"]);
    assert!(
        hosts
            .iter()
            .all(|host| host.host_name == "shared" && host.port == 42 && host.user == "deploy")
    );
    // Each alias names ITSELF as the config host — a shared one would send both through the same
    // `~/.ssh/config` entry.
    assert_eq!(
        hosts
            .iter()
            .map(|host| host.config_host.as_deref().unwrap_or_default())
            .collect::<Vec<_>>(),
        vec!["web1", "web2"]
    );
}

#[test]
fn a_pattern_that_matches_hosts_rather_than_naming_one_is_not_a_scope() {
    // Three separate reasons to drop a clause, so three separate clauses: a bare `*`, a token
    // CONTAINING a glob character, and a negation. None of them can be connected to.
    assert_eq!(
        names(&scopes(
            "Host prod web?? *.internal !staging *\n  HostName real\n"
        )),
        vec!["prod"]
    );
}

#[test]
fn a_defaults_block_contributes_no_scope_but_does_not_hide_the_next_one() {
    // `Host *` is where users put defaults, and the parser also files pre-`Host` directives under it.
    assert_eq!(
        names(&scopes(
            "User global\nHost *\n  ServerAliveInterval 60\nHost real\n  HostName r\n"
        )),
        vec!["real"]
    );
}

#[test]
fn an_absent_port_is_22_and_an_absent_host_name_is_the_alias() {
    let host = only("Host box\n  User me\n");
    assert_eq!(host.port, 22);
    assert_eq!(host.host_name, "box");
    assert_eq!(host.identity_file, "");
}

#[test]
fn an_equals_sign_separates_a_directive_as_well_as_a_space() {
    // Valid OpenSSH, and the desktop app already reads it, so a parser that cannot would be a
    // regression rather than a nicety.
    let host = only("Host gw\n  HostName=192.168.1.1\n  Port=2200\n  User=admin\n");
    assert_eq!(host.host_name, "192.168.1.1");
    assert_eq!(host.port, 2200);
    assert_eq!(host.user, "admin");
}

#[test]
fn the_first_identity_file_wins_when_several_are_configured() {
    // OpenSSH accumulates them and tries them in order; the schema carries one, so the first is the one
    // to report. Reporting the last would hand `ssh -i` a fallback key as though it were the primary.
    assert_eq!(
        only("Host multi\n  IdentityFile ~/.ssh/first\n  IdentityFile ~/.ssh/second\n")
            .identity_file,
        expanded("first")
    );
}

#[test]
fn the_identity_file_is_expanded_against_the_process_home_not_the_one_passed_in() {
    // The cost of buying the grammar, named so it cannot surprise anyone: the parser resolves `~`
    // itself, from the process's own home, while the config FILE is read from the `home` argument. The
    // two are the same in the app and differ here — so a core acting for another user would read that
    // user's config and then name this user's key. `SshCredentials::from_scope` expanding `~` again is
    // harmless (it is already absolute), which is why nothing downstream has to change.
    let home = home_with_config("Host h\n  IdentityFile ~/.ssh/key\n");
    let host = list_scopes(&StdFs, home.path()).expect("read").remove(0);

    assert_eq!(host.identity_file, expanded("key"));
    assert!(
        !host
            .identity_file
            .starts_with(&home.path().to_string_lossy().to_string()),
        "the identity file is NOT resolved against the home argument"
    );
}

#[test]
fn a_directive_this_core_does_not_use_does_not_cost_the_whole_file() {
    // A real `~/.ssh/config` is full of keywords no picker cares about. Parsing strictly would turn
    // one of them into an empty host list, which reads to the user as "no hosts configured".
    let host = only(
        "Host h\n  ProxyJump bastion\n  SetEnv FOO=bar\n  HostName real\n  NotEvenAKeyword yes\n",
    );
    assert_eq!(host.host_name, "real");
}

#[test]
fn no_config_file_is_no_scopes_rather_than_an_error() {
    let home = tempfile::tempdir().expect("a temporary home");
    assert!(
        list_scopes(&StdFs, home.path())
            .expect("an absent config is not an error")
            .is_empty()
    );
}

#[test]
fn a_config_that_cannot_be_read_is_refused_rather_than_reported_as_no_scopes() {
    // A directory where the file belongs stands in for any unreadable config, and unlike a permission
    // bit it behaves the same for root. The app substitutes an empty list here; this core says why,
    // because "no SSH hosts" and "your config could not be read" need different fixes.
    let home = tempfile::tempdir().expect("a temporary home");
    std::fs::create_dir_all(home.path().join(".ssh").join("config"))
        .expect("a directory in its place");
    assert!(list_scopes(&StdFs, home.path()).is_err());
}

#[test]
fn a_config_that_cannot_be_parsed_is_refused_rather_than_reported_as_no_scopes() {
    let home = home_with_config("Host ok\n  Port definitely-not-a-number\n");
    assert!(list_scopes(&StdFs, home.path()).is_err());
}

#[test]
fn an_untracked_connection_is_reported_as_unknown_rather_than_as_not_connected() {
    // The wire claim, not just the Rust one: `Some(false)` would tell a client "this host is NOT
    // connected", which this core cannot know — it holds no connection tracker, and every scoped
    // command is a fresh `ssh`. Absence says "unknown", which is why the schema makes both optional.
    let host = only("Host h\n");
    assert_eq!(host.connected, None);
    assert_eq!(host.usable, None);

    let wire = serde_json::to_value(&host).expect("an SSHHost serializes");
    let object = wire.as_object().expect("an object");
    assert!(
        !object.contains_key("Connected"),
        "Connected must be absent"
    );
    assert!(!object.contains_key("Usable"), "Usable must be absent");
    assert_eq!(
        object.get("Type").and_then(|it| it.as_str()),
        Some("SSHConnection")
    );
}

#[test]
fn the_config_is_read_from_dot_ssh_under_the_home_it_is_given() {
    // Named rather than implied: a core that reads a different path than the desktop app looks like it
    // works while listing somebody else's hosts.
    let home = home_with_config("Host h\n");
    assert!(Path::new(&home.path().join(".ssh").join("config")).is_file());
    assert_eq!(
        names(&list_scopes(&StdFs, home.path()).expect("read")),
        vec!["h"]
    );
}
