//! The listener — `cdc-server/src/listen{.rs,/}`, one test file per source file.
//!
//! Cargo roots a multi-file test target at `<dir>/main.rs`, and a crate root resolves `mod` against its
//! OWN directory, which is why this is `main.rs` rather than `listen.rs`. It is the file that answers to
//! `src/listen.rs`, so **the security posture is asserted here** — what may be listened on, and what is
//! refused before anything binds. Its submodules answer to `src/listen/` file for file.
//!
//! Everything in this file is a pure decision, deliberately: a posture that could only be checked by
//! binding a socket would be a posture nobody checks on a laptop.

#[path = "../../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;
#[path = "../harness/mod.rs"]
mod harness;

mod auth;
mod clients;
mod endpoint;
mod session;
mod tls;

use std::net::SocketAddr;
use std::path::PathBuf;

use cdc_server::listen::auth::Token;
use cdc_server::listen::tls::ServerTls;
use cdc_server::listen::{Admitted, Listen, ListenError, Remote};

use crate::harness::certified;

fn address(text: &str) -> SocketAddr {
    text.parse().expect("a socket address")
}

fn local_only() -> Listen {
    Listen {
        local: Some(PathBuf::from("/tmp/cdc-server-test.sock")),
        remote: None,
    }
}

#[test]
fn a_server_with_nothing_to_listen_on_is_refused() {
    // It would come up, log that it was ready, and answer nobody — the failure mode that wastes an
    // afternoon, because everything about it looks healthy.
    assert_eq!(
        Admitted::admit(Listen::default()).expect_err("nothing was configured"),
        ListenError::NothingConfigured
    );
}

#[test]
fn the_local_socket_alone_is_enough() {
    let admitted = Admitted::admit(local_only()).expect("a local socket is the default");

    assert_eq!(
        admitted.local(),
        Some(&PathBuf::from("/tmp/cdc-server-test.sock"))
    );
    assert!(
        admitted.remote().is_none(),
        "remote is off unless asked for"
    );
}

#[test]
fn remote_is_off_by_default() {
    // Task 4's first rule, and it is expressed as a type rather than as a flag someone can default to
    // `true`: `Listen::remote` is an `Option` and `Default` leaves it empty.
    assert!(Listen::default().remote.is_none());
}

#[test]
fn a_non_loopback_address_without_a_token_is_refused() {
    // The test the design names in so many words. `0.0.0.0` is every interface: without a token
    // this would hand full container-engine control to anything that can route to the machine.
    let refusal = Admitted::remote_from(address("0.0.0.0:9091"), None, None)
        .expect_err("a token is not optional here");

    assert_eq!(
        refusal,
        ListenError::RemoteNeedsToken {
            address: address("0.0.0.0:9091")
        }
    );
}

#[test]
fn loopback_without_a_token_is_refused_too() {
    // STRICTER than a non-loopback rule, and the reason is that the exemption would rest on a claim
    // process cannot make: a loopback TCP port has no filesystem permissions, so every local user and
    // every sandboxed process on the machine can reach it. The local socket already serves the
    // same-machine case with a mode of 0600.
    let refusal = Admitted::remote_from(address("127.0.0.1:0"), None, None)
        .expect_err("loopback is not an exemption");

    assert_eq!(
        refusal,
        ListenError::RemoteNeedsToken {
            address: address("127.0.0.1:0")
        }
    );
}

#[test]
fn an_empty_token_is_no_token() {
    // Not a weak secret — the absence of one wearing the shape of a secret. It would also compare equal
    // to an empty `Authorization` header, which is the specific way this goes wrong.
    let refusal = Admitted::remote_from(address("127.0.0.1:0"), Some(Token::new("")), None)
        .expect_err("an empty token guards nothing");

    assert_eq!(refusal, ListenError::TokenIsEmpty);
}

#[test]
fn a_token_of_whitespace_is_no_token() {
    // A token read from a file is trimmed, so `" "` arrives here as empty and must not read as a secret.
    let refusal = Admitted::remote_from(address("127.0.0.1:0"), Some(Token::new(" \n\t")), None)
        .expect_err("whitespace is not a secret");

    assert_eq!(refusal, ListenError::TokenIsEmpty);
}

#[test]
fn a_remote_listener_with_a_token_is_admitted() {
    let remote = Admitted::remote_from(address("127.0.0.1:9091"), Some(Token::new("s3cret")), None)
        .expect("a token is all it needed");

    let admitted = Admitted::admit(Listen {
        local: None,
        remote: Some(remote),
    })
    .expect("remote alone is a valid configuration");
    assert_eq!(
        admitted.remote().map(|remote| remote.address),
        Some(address("127.0.0.1:9091"))
    );
}

#[test]
fn admitting_re_checks_the_token_it_was_handed() {
    // `Remote` can be built by hand, so `admit` cannot assume it came through `remote_from`. Two doors
    // into the same room means both need the lock.
    let refusal = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: address("0.0.0.0:9091"),
            token: Token::new(""),
            tls: None,
        }),
    })
    .expect_err("an empty token is refused however it arrived");

    assert_eq!(refusal, ListenError::TokenIsEmpty);
}

#[test]
fn reaching_off_the_host_is_a_property_of_the_address() {
    let off_host = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: address("0.0.0.0:9091"),
            token: Token::new("s3cret"),
            tls: None,
        }),
    })
    .expect("admitted");
    let loopback = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: address("127.0.0.1:9091"),
            token: Token::new("s3cret"),
            tls: None,
        }),
    })
    .expect("admitted");

    assert!(
        off_host.is_reachable_off_host(),
        "0.0.0.0 is every interface, and an operator has to be told"
    );
    assert!(
        !loopback.is_reachable_off_host(),
        "127.0.0.1 is not reachable from another machine"
    );
    assert!(
        !Admitted::admit(local_only())
            .expect("admitted")
            .is_reachable_off_host(),
        "and a local socket is not reachable from anywhere"
    );
}

#[test]
fn a_refusal_says_which_address_it_is_about() {
    // The message is what an operator reads at 3am, and an address they can grep for is the difference
    // between fixing a flag and guessing at one.
    let refusal = Admitted::remote_from(address("0.0.0.0:9091"), None, None).expect_err("refused");

    assert!(
        refusal.to_string().contains("0.0.0.0:9091"),
        "the refusal names the address: {refusal}"
    );
    assert!(
        ListenError::NothingConfigured
            .to_string()
            .contains("no listener"),
        "and the empty configuration says what to do about it"
    );
}

#[test]
fn whether_anything_crosses_a_network_in_the_clear_is_a_property_of_the_configuration() {
    // The three answers the start-up log branches on, and each one has a different thing to say. They
    // are asserted here rather than in `main.rs` for the reason the whole module exists: a posture that
    // could only be checked by reading a log line is a posture nobody checks.
    let material = certified(&["localhost"]);
    let tls = ServerTls::from_pem(material.certificate.as_bytes(), material.key.as_bytes())
        .expect("a certificate and its own key");
    let encrypted = admitted_remote(address("0.0.0.0:9091"), Some(tls));
    let in_the_clear = admitted_remote(address("0.0.0.0:9091"), None);
    let tunnelled = admitted_remote(address("127.0.0.1:9091"), None);

    assert!(encrypted.is_encrypted());
    assert!(
        !encrypted.is_exposed_in_the_clear(),
        "off-host over TLS is the arrangement this exists for"
    );
    assert!(!in_the_clear.is_encrypted());
    assert!(
        in_the_clear.is_exposed_in_the_clear(),
        "off-host with no certificate is the one combination with no good story"
    );
    assert!(
        !tunnelled.is_exposed_in_the_clear(),
        "plaintext on loopback is what a tunnel and a reverse proxy both produce, and both are correct"
    );
    assert!(
        !Admitted::admit(local_only())
            .expect("admitted")
            .is_encrypted(),
        "and a local socket is not encrypted, because there is no network to encrypt"
    );
}

fn admitted_remote(address: SocketAddr, tls: Option<ServerTls>) -> Admitted {
    Admitted::admit(Listen {
        local: None,
        remote: Some(
            Admitted::remote_from(address, Some(Token::new("s3cret")), tls).expect("admitted"),
        ),
    })
    .expect("admitted")
}
