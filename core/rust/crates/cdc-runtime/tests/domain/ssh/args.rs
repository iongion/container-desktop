//! The `ssh` argv rules.
//!
//! Every option here is a fixed bug, so each is asserted as a POSITION in the whole argv rather than
//! with `contains`: `-p` after the identity, the target before the `--`, the target LAST in a tunnel.
//! A membership assertion passes for an argv in the wrong order, and the wrong order is what breaks
//! `ssh`.

use cdc_runtime::domain::ssh::args::{DEFAULT_SSH_PORT, SshCredentials};
use cdc_runtime::domain::types::connection::{SshHost, SshHostType};

fn words(items: &[&str]) -> Vec<String> {
    items.iter().map(|it| (*it).to_string()).collect()
}

/// A key, a non-default port and a user — so every optional part is present and can be seen to
/// disappear.
fn credentials() -> SshCredentials {
    SshCredentials {
        host: "engine.example.com".to_string(),
        port: Some(2222),
        username: Some("deploy".to_string()),
        private_key_path: Some("/home/me/.ssh/id_ed25519".to_string()),
        config_host: None,
    }
}

fn scope() -> SshHost {
    SshHost {
        name: "engine".to_string(),
        type_: SshHostType::SshConnection,
        host: "engine".to_string(),
        host_name: "engine.example.com".to_string(),
        port: 2222,
        user: "deploy".to_string(),
        identity_file: "~/.ssh/id_ed25519".to_string(),
        config_host: None,
        connected: None,
        usable: None,
    }
}

// `ssh-args.ts:buildSSHBaseArgs`

#[test]
fn the_base_args_bound_the_connection_and_carry_the_identity_then_the_port() {
    assert_eq!(
        credentials().base_args(),
        words(&[
            "-oStrictHostKeyChecking=accept-new",
            "-oBatchMode=yes",
            "-oConnectTimeout=15",
            "-oConnectionAttempts=1",
            "-i",
            "/home/me/.ssh/id_ed25519",
            "-p",
            "2222",
        ]),
        "BatchMode, ConnectTimeout and ConnectionAttempts are what stop an unreachable host hanging"
    );
}

#[test]
fn a_config_host_suppresses_both_the_identity_and_the_port() {
    // The interaction the design calls out: `~/.ssh/config` owns the port and the IdentityFile for an
    // alias, and passing either here overrides the user's configuration silently.
    let credentials = SshCredentials {
        config_host: Some("engine-alias".to_string()),
        ..credentials()
    };
    assert_eq!(
        credentials.base_args(),
        words(&[
            "-oStrictHostKeyChecking=accept-new",
            "-oBatchMode=yes",
            "-oConnectTimeout=15",
            "-oConnectionAttempts=1",
        ])
    );
}

#[test]
fn an_absent_port_is_the_default_22() {
    let credentials = SshCredentials {
        port: None,
        ..credentials()
    };
    assert_eq!(credentials.base_args().last().unwrap(), "22");
    assert_eq!(DEFAULT_SSH_PORT, 22);
}

#[test]
fn an_absent_key_passes_no_identity() {
    // Valid, and common: OpenSSH then uses the agent and its own identity discovery.
    let credentials = SshCredentials {
        private_key_path: None,
        ..credentials()
    };
    assert_eq!(
        credentials.base_args(),
        words(&[
            "-oStrictHostKeyChecking=accept-new",
            "-oBatchMode=yes",
            "-oConnectTimeout=15",
            "-oConnectionAttempts=1",
            "-p",
            "2222",
        ])
    );
}

// `ssh-args.ts:buildSSHTarget`

#[test]
fn the_target_prefers_the_config_host_over_the_user_and_host() {
    let credentials = SshCredentials {
        config_host: Some("engine-alias".to_string()),
        ..credentials()
    };
    assert_eq!(credentials.target(), "engine-alias");
}

#[test]
fn the_target_is_user_at_host_when_a_user_is_known() {
    assert_eq!(credentials().target(), "deploy@engine.example.com");
}

#[test]
fn the_target_is_the_bare_host_when_no_user_is_known() {
    let credentials = SshCredentials {
        username: None,
        ..credentials()
    };
    assert_eq!(credentials.target(), "engine.example.com");
}

// `ssh-args.ts:buildSSHArgs`

#[test]
fn a_command_follows_the_target_and_a_double_dash_separator() {
    assert_eq!(
        credentials().args(&words(&["which", "podman"])),
        words(&[
            "-oStrictHostKeyChecking=accept-new",
            "-oBatchMode=yes",
            "-oConnectTimeout=15",
            "-oConnectionAttempts=1",
            "-i",
            "/home/me/.ssh/id_ed25519",
            "-p",
            "2222",
            "deploy@engine.example.com",
            "--",
            "which",
            "podman",
        ]),
        "the separator is what stops a remote argument being read as an ssh option"
    );
}

// `ssh-args.ts:buildSSHTunnelArgs`

#[test]
fn a_tunnel_puts_the_forward_before_the_target_and_uses_no_separator() {
    // A different SHAPE from `args`, not a variation on it: the target comes last and there is no
    // `--`, because `-NL` takes no remote command.
    assert_eq!(
        credentials().tunnel_args(
            "/run/user/1000/cdt-ssh-8600bf43.sock",
            "/run/podman/podman.sock"
        ),
        words(&[
            "-oStrictHostKeyChecking=accept-new",
            "-oBatchMode=yes",
            "-oConnectTimeout=15",
            "-oConnectionAttempts=1",
            "-i",
            "/home/me/.ssh/id_ed25519",
            "-p",
            "2222",
            "-oExitOnForwardFailure=yes",
            "-oStreamLocalBindUnlink=yes",
            "-NL",
            "/run/user/1000/cdt-ssh-8600bf43.sock:/run/podman/podman.sock",
            "deploy@engine.example.com",
        ])
    );
}

#[test]
fn a_tunnel_forwards_to_the_socket_path_without_its_scheme() {
    // `startTunnel` strips `unix://` before building the forward: `ssh -NL` wants a path, and the
    // scheme reaches it as part of the remote address otherwise.
    let argv = credentials().tunnel_args("/tmp/local.sock", "UNIX:///run/podman/podman.sock");
    assert_eq!(
        argv[argv.len() - 2],
        "/tmp/local.sock:/run/podman/podman.sock"
    );
}

// `ssh-args.ts:buildSSHConnectionURI`

#[test]
fn the_connection_uri_is_the_user_host_and_port_and_ignores_a_config_host() {
    let credentials = SshCredentials {
        config_host: Some("engine-alias".to_string()),
        ..credentials()
    };
    assert_eq!(
        credentials.connection_uri(),
        "deploy@engine.example.com:2222"
    );
}

#[test]
fn the_connection_uri_drops_the_user_when_there_is_none_and_defaults_the_port() {
    let credentials = SshCredentials {
        username: None,
        port: None,
        ..credentials()
    };
    assert_eq!(credentials.connection_uri(), "engine.example.com:22");
}

// `ssh-transport.ts:startSSHConnection` — the scope as connect parameters.

#[test]
fn a_scope_becomes_credentials_preferring_the_resolved_host_name() {
    let credentials = SshCredentials::from_scope(&scope(), "/home/me");
    assert_eq!(credentials.host, "engine.example.com");
    assert_eq!(credentials.port, Some(2222));
    assert_eq!(credentials.username, Some("deploy".to_string()));
    assert_eq!(
        credentials.private_key_path,
        Some("/home/me/.ssh/id_ed25519".to_string())
    );
}

#[test]
fn a_scope_falls_back_to_the_written_host_then_to_the_name() {
    let written = SshHost {
        host_name: String::new(),
        ..scope()
    };
    assert_eq!(
        SshCredentials::from_scope(&written, "/home/me").host,
        "engine"
    );

    let named = SshHost {
        host_name: String::new(),
        host: String::new(),
        ..scope()
    };
    assert_eq!(
        SshCredentials::from_scope(&named, "/home/me").host,
        "engine",
        "`Name` is the last resort, and for an alias it is the only thing set"
    );
}

#[test]
fn a_scope_expands_both_home_spellings_in_the_identity_file() {
    let dollar = SshHost {
        identity_file: "$HOME/keys/id_rsa".to_string(),
        ..scope()
    };
    assert_eq!(
        SshCredentials::from_scope(&dollar, "/home/me").private_key_path,
        Some("/home/me/keys/id_rsa".to_string())
    );
    let absolute = SshHost {
        identity_file: "/etc/keys/id_rsa".to_string(),
        ..scope()
    };
    assert_eq!(
        SshCredentials::from_scope(&absolute, "/home/me").private_key_path,
        Some("/etc/keys/id_rsa".to_string()),
        "a path with no home marker is passed through untouched"
    );
}

#[test]
fn a_scope_reads_every_empty_field_as_absent() {
    // The oracle's falsiness, pinned once here rather than repeated at each use: `""` for a key, a
    // user or a config host all mean "not configured", and `0` is not a port.
    let empty = SshHost {
        user: String::new(),
        identity_file: String::new(),
        config_host: Some(String::new()),
        port: 0,
        ..scope()
    };
    let credentials = SshCredentials::from_scope(&empty, "/home/me");
    assert_eq!(credentials.username, None);
    assert_eq!(credentials.private_key_path, None);
    assert_eq!(credentials.config_host, None);
    assert_eq!(credentials.port, None);
    assert_eq!(credentials.port(), 22);
}

#[test]
fn a_nonsense_port_reaches_ssh_rather_than_becoming_the_default() {
    // Narrowing it to a `u16` would read 70000 as "absent" and connect to port 22 — the right host,
    // the wrong service, and no error. Passing it through makes `ssh` refuse it out loud.
    let nonsense = SshHost {
        port: 70_000,
        ..scope()
    };
    let credentials = SshCredentials::from_scope(&nonsense, "/home/me");
    assert_eq!(credentials.port, Some(70_000));
    assert_eq!(credentials.base_args().last().unwrap(), "70000");
}
