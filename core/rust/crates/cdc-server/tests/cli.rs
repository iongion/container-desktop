//! What an invocation asks for, and what it is refused.
//!
//! The command line is where the security posture is actually reached from, so it is asserted here the
//! same way the posture itself is: as a decision, with no socket in sight. `clap`'s own parsing is not
//! under test — what is under test is what this crate does with what `clap` produces.

use std::path::PathBuf;

use cdc_server::cli::{ConfigError, Options};
use cdc_server::listen::ListenError;
use clap::Parser;

/// As a shell would hand them over, `cdc-server` included.
fn options(args: &[&str]) -> Options {
    let mut argv = vec!["cdc-server"];
    argv.extend_from_slice(args);
    Options::try_parse_from(argv).expect("the arguments parse")
}

fn written(contents: &str) -> (tempfile::TempDir, PathBuf) {
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-cli-")
        .tempdir_in("/tmp")
        .expect("a temp dir");
    let path = directory.path().join("token");
    std::fs::write(&path, contents).expect("the token file is written");
    (directory, path)
}

#[test]
fn the_default_invocation_serves_the_local_socket_and_nothing_else() {
    let admitted = options(&[]).admitted().expect("the default is valid");

    assert!(
        admitted.local().is_some(),
        "a local socket is the default listener"
    );
    assert!(
        admitted.remote().is_none(),
        "and remote is off unless it is asked for"
    );
    assert!(!admitted.is_reachable_off_host());
}

#[test]
fn a_named_socket_is_used_instead_of_the_default() {
    let admitted = options(&["--socket", "/tmp/cdc-server-elsewhere.sock"])
        .admitted()
        .expect("valid");

    assert_eq!(
        admitted.local(),
        Some(&PathBuf::from("/tmp/cdc-server-elsewhere.sock"))
    );
}

#[test]
fn refusing_to_listen_locally_with_nothing_else_asked_for_is_refused() {
    // A server with no listener would come up, log that it was ready, and answer nobody.
    let refusal = options(&["--no-local"])
        .admitted()
        .expect_err("nothing would be listening");

    assert!(
        matches!(refusal, ConfigError::Listen(ListenError::NothingConfigured)),
        "got {refusal:?}"
    );
}

#[test]
fn a_remote_listener_without_a_token_is_refused_at_the_command_line() {
    // The posture reached through the door an operator actually uses. `0.0.0.0` is every interface.
    let refusal = options(&["--remote", "0.0.0.0:9091"])
        .admitted()
        .expect_err("a token is not optional");

    assert!(
        matches!(
            refusal,
            ConfigError::Listen(ListenError::RemoteNeedsToken { .. })
        ),
        "got {refusal:?}"
    );
}

#[test]
fn a_token_file_is_read_and_its_trailing_newline_is_not_part_of_the_token() {
    // Every editor and every `echo` puts one there, and a token that only fails when it was created with
    // an editor is a support case nobody enjoys.
    let (_directory, path) = written("s3cret\n");

    let token = options(&["--token-file", &path.to_string_lossy()])
        .token()
        .expect("the file is readable")
        .expect("a token");

    assert!(token.matches("s3cret"));
    assert!(!token.matches("s3cret\n"));
}

#[test]
fn a_token_file_that_holds_only_whitespace_is_refused_as_empty() {
    let (_directory, path) = written("\n\n");

    let refusal = options(&[
        "--remote",
        "127.0.0.1:0",
        "--token-file",
        &path.to_string_lossy(),
    ])
    .admitted()
    .expect_err("whitespace is not a secret");

    assert!(
        matches!(refusal, ConfigError::Listen(ListenError::TokenIsEmpty)),
        "got {refusal:?}"
    );
}

#[test]
fn a_token_file_that_cannot_be_read_names_the_path_and_never_its_contents() {
    let refusal = options(&["--token-file", "/tmp/cdc-server-no-such-token"])
        .token()
        .expect_err("there is no such file");

    let message = refusal.to_string();
    assert!(
        message.contains("/tmp/cdc-server-no-such-token"),
        "the path is what an operator can act on: {message}"
    );
    assert!(matches!(refusal, ConfigError::TokenFile { .. }));
}

#[test]
fn a_token_from_the_environment_is_accepted_and_trimmed() {
    // The environment is the fallback, and it is second because a variable is inherited by every child
    // this process spawns — and this process spawns `ssh`.
    let token = options(&["--token-env", " s3cret "])
        .token()
        .expect("no file was named")
        .expect("a token");

    assert!(token.matches("s3cret"));
}

#[test]
fn a_token_file_wins_over_the_environment() {
    let (_directory, path) = written("from-the-file");

    let token = options(&[
        "--token-file",
        &path.to_string_lossy(),
        "--token-env",
        "from-the-environment",
    ])
    .token()
    .expect("readable")
    .expect("a token");

    assert!(token.matches("from-the-file"));
    assert!(!token.matches("from-the-environment"));
}

#[test]
fn a_remote_listener_with_a_token_is_admitted_and_says_whether_it_reaches_off_the_host() {
    let off_host = options(&["--remote", "0.0.0.0:9091", "--token-env", "s3cret"])
        .admitted()
        .expect("a token was given");
    let loopback = options(&["--remote", "127.0.0.1:9091", "--token-env", "s3cret"])
        .admitted()
        .expect("a token was given");

    assert!(
        off_host.is_reachable_off_host(),
        "0.0.0.0 is every interface"
    );
    assert!(!loopback.is_reachable_off_host());
}

#[test]
fn there_is_no_way_to_pass_a_token_as_an_argument() {
    // Deliberate, and asserted so it cannot be added back by accident: argv is world-readable through
    // `ps` on every platform this runs on, so `--token s3cret` would hand the secret to every user on the
    // machine. The environment variable is the fallback and a file is the recommendation.
    assert!(
        Options::try_parse_from(["cdc-server", "--token", "s3cret"]).is_err(),
        "there must be no --token flag"
    );
}

/// A certificate and its key, written where a command line can point at them.
fn certificate_files() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let generated = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])
        .expect("a self-signed certificate");
    let directory = tempfile::Builder::new()
        .prefix("cdc-server-tls-")
        .tempdir_in("/tmp")
        .expect("a temp dir");
    let cert = directory.path().join("cert.pem");
    let key = directory.path().join("key.pem");
    std::fs::write(&cert, generated.cert.pem()).expect("the certificate is written");
    std::fs::write(&key, generated.signing_key.serialize_pem()).expect("the key is written");
    (directory, cert, key)
}

#[test]
fn a_certificate_turns_the_remote_listener_into_a_wss_one() {
    let (_directory, cert, key) = certificate_files();

    let admitted = options(&[
        "--remote",
        "0.0.0.0:9091",
        "--token-env",
        "s3cret",
        "--tls-cert",
        &cert.to_string_lossy(),
        "--tls-key",
        &key.to_string_lossy(),
    ])
    .admitted()
    .expect("a certificate and its key are all it needed");

    assert!(admitted.is_encrypted());
    assert!(
        !admitted.is_exposed_in_the_clear(),
        "and off-host is no longer the combination with no story"
    );
}

#[test]
fn a_remote_listener_without_a_certificate_is_still_admitted_and_still_in_the_clear() {
    // Opt-in rather than mandatory, and the reason is in `listen`: behind an SSH tunnel or a reverse
    // proxy something else owns the certificate, and refusing would push an operator onto a worse
    // arrangement. What is not optional is being TOLD, and that is what this value is read for.
    let admitted = options(&["--remote", "0.0.0.0:9091", "--token-env", "s3cret"])
        .admitted()
        .expect("plaintext remote is a configuration, not a refusal");

    assert!(!admitted.is_encrypted());
    assert!(admitted.is_exposed_in_the_clear());
}

#[test]
fn one_half_of_the_pair_is_not_a_configuration() {
    // Enforced by `clap`'s `requires` rather than by a check here, which is why it is asserted at the
    // PARSE rather than at `admitted()`: a certificate with no key cannot even be expressed.
    let (_directory, cert, key) = certificate_files();

    for half in [
        ["--tls-cert", &cert.to_string_lossy()],
        ["--tls-key", &key.to_string_lossy()],
    ] {
        assert!(
            Options::try_parse_from(["cdc-server", half[0], half[1]]).is_err(),
            "{} alone is not a configuration",
            half[0]
        );
    }
}

#[test]
fn a_certificate_with_no_remote_listener_to_serve_is_refused_rather_than_ignored() {
    // The rule the client's `--token` with no `--remote` follows, for the same reason: quietly dropping
    // it is how somebody comes to believe a listener is encrypted when there is no listener at all. The
    // local socket is not TLS — its access control is its mode.
    let (_directory, cert, key) = certificate_files();

    let refusal = options(&[
        "--tls-cert",
        &cert.to_string_lossy(),
        "--tls-key",
        &key.to_string_lossy(),
    ])
    .admitted()
    .expect_err("there is nothing to serve it on");

    assert!(
        matches!(refusal, ConfigError::TlsWithNoRemote),
        "got {refusal:?}"
    );
}

#[test]
fn a_certificate_that_cannot_be_read_names_the_path_and_never_its_contents() {
    let (_directory, _cert, key) = certificate_files();

    let refusal = options(&[
        "--tls-cert",
        "/tmp/cdc-server-no-such-certificate",
        "--tls-key",
        &key.to_string_lossy(),
    ])
    .tls()
    .expect_err("that path does not exist");

    let ConfigError::TlsFile { path, .. } = &refusal else {
        panic!("got {refusal:?}");
    };
    assert_eq!(path, &PathBuf::from("/tmp/cdc-server-no-such-certificate"));
}

#[test]
fn material_that_cannot_serve_names_both_paths() {
    // The commonest way here is passing the two files to each other's flag, and an error about only one
    // of them sends the reader to the file that is fine.
    let (_directory, cert, key) = certificate_files();

    let refusal = options(&[
        "--tls-cert",
        &key.to_string_lossy(),
        "--tls-key",
        &cert.to_string_lossy(),
    ])
    .tls()
    .expect_err("the two files are the wrong way round");

    let message = refusal.to_string();
    assert!(
        message.contains(&cert.to_string_lossy().to_string())
            && message.contains(&key.to_string_lossy().to_string()),
        "both paths are named: {message}"
    );
}

#[test]
fn there_is_no_way_to_pass_a_private_key_as_an_argument() {
    // The rule the token has, on the other secret: argv is world-readable through `ps`. A key is
    // additionally a file whose MODE is the point, and a string has none.
    assert!(
        Options::try_parse_from([
            "cdc-server",
            "--tls-key-value",
            "-----BEGIN PRIVATE KEY-----"
        ])
        .is_err(),
        "there is no flag that takes key material"
    );
}
