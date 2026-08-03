//! What this client will trust, answering to `src/client/tls.rs`.
//!
//! **The decisions, without a socket.** Which name a certificate is checked against, what an empty CA
//! file means and what an address that could never name a peer means are all pure functions of the
//! arguments — and the reason they are asserted here rather than through a handshake is that a trust
//! decision reached only by dialling something is a decision nobody checks on a laptop. The handshakes
//! that USE them are next door in `dial.rs`, against real listeners.

use cdc_client::tls::{ClientTls, TlsError, Trust};

use crate::harness::certified;

/// The name a certificate would have to carry, as rustls spells one.
///
/// **Asserted as a VALUE rather than through `Debug`**, because `ServerName`'s rendering is structural
/// (`IpAddress(V4(Ipv4Addr([10, 0, 0, 4])))`) and a test that read it would be asserting pki-types'
/// formatting rather than which peer this client is about to check.
fn name(text: &str) -> tokio_rustls::rustls::pki_types::ServerName<'static> {
    tokio_rustls::rustls::pki_types::ServerName::try_from(text)
        .expect("a server name")
        .to_owned()
}

#[test]
fn a_name_with_a_port_after_it_is_verified_as_the_name() {
    // The ordinary case, and the one that would silently verify the wrong thing: a certificate is
    // issued for `engine.example` and never for `engine.example:9091`.
    let tls = ClientTls::new("engine.example:9091", &Trust::Roots).expect("a DNS name and a port");

    assert_eq!(tls.name(), name("engine.example"));
}

#[test]
fn an_address_is_verified_as_an_address() {
    // Which means the certificate has to carry that IP, and an operator issuing their own has to be
    // told — the tools make it easy to write only DNS names into a SAN.
    let tls = ClientTls::new("10.0.0.4:9091", &Trust::Roots).expect("an IPv4 address and a port");

    assert_eq!(tls.name(), name("10.0.0.4"));
}

#[test]
fn a_bracketed_ipv6_address_keeps_only_its_address() {
    // Four colons and only the last one is the port separator, which is why the host is not found by
    // splitting on a colon.
    let tls = ClientTls::new("[::1]:9091", &Trust::Roots).expect("an IPv6 address and a port");

    assert_eq!(
        tls.name(),
        name("::1"),
        "the brackets and the port are framing, not part of the name"
    );
}

#[test]
fn a_name_with_no_port_is_still_a_name() {
    // The connect will fail for want of a port, and it fails as a connect. Refusing here would report
    // a missing port as a certificate problem.
    let tls = ClientTls::new("engine.example", &Trust::Roots).expect("a bare DNS name");

    assert_eq!(tls.name(), name("engine.example"));
}

#[test]
fn something_that_could_never_name_a_peer_is_refused_before_anything_is_dialled() {
    // A connection whose peer cannot be identified is the thing this module exists to prevent, so it is
    // a refusal rather than a handshake that fails later for a reason about the wrong thing.
    let refusal =
        ClientTls::new("not a hostname:9091", &Trust::Roots).expect_err("that is not a name");

    let TlsError::NotAServerName { host } = &refusal else {
        panic!("got {refusal:?}");
    };
    assert_eq!(host, "not a hostname");
    assert!(
        refusal
            .to_string()
            .contains("no certificate can be verified"),
        "and it says why that matters rather than only what is malformed: {refusal}"
    );
}

#[test]
fn what_it_prints_is_the_name_a_failed_handshake_was_about() {
    // `ClientTls` has a hand-written `Debug`, so what it says is a decision and not a derive — and the
    // mutation gate found it: an `fmt` that printed NOTHING passed every other test here, because they
    // all read `name()` instead. A client's TLS config holds no secret, so this is for a reader, and
    // what a reader needs from a failed handshake is which name was being checked.
    let tls = ClientTls::new("engine.example:9091", &Trust::Roots).expect("a name and the roots");

    let printed = format!("{tls:?}");

    assert!(
        printed.contains("ClientTls") && printed.contains("engine.example"),
        "got {printed}"
    );
}

#[test]
fn a_ca_file_pins_exactly_what_is_in_it() {
    let material = certified(&["localhost"]);

    ClientTls::new(
        "localhost:9091",
        &Trust::Pem(material.certificate.into_bytes()),
    )
    .expect("a self-signed certificate is a perfectly good trust anchor");
}

#[test]
fn a_ca_file_with_nothing_in_it_is_refused_rather_than_trusting_nothing() {
    // **An empty trust store is not "trust nothing", it is a client that refuses every server** — and it
    // would do so with a handshake error about an unknown issuer, which reads as the SERVER being
    // wrong. Caught where the file that is at fault can be named.
    let refusal = ClientTls::new("localhost:9091", &Trust::Pem(b"nothing here".to_vec()))
        .expect_err("there is no certificate in that");

    assert!(
        matches!(refusal, TlsError::NoTrustAnchors),
        "got {refusal:?}"
    );
}

#[test]
fn a_ca_file_given_a_private_key_is_refused_as_holding_no_certificate() {
    // The commonest wrong file to point `--tls-ca` at, after the certificate itself.
    let material = certified(&["localhost"]);

    let refusal = ClientTls::new("localhost:9091", &Trust::Pem(material.key.into_bytes()))
        .expect_err("a key is not a trust anchor");

    assert!(
        matches!(refusal, TlsError::NoTrustAnchors),
        "got {refusal:?}"
    );
}

#[test]
fn pem_framing_with_rubbish_inside_it_is_refused_as_unreadable() {
    // Told apart from an empty file for the reason the server's is: this one WAS meant to be a
    // certificate — it says so — and was truncated or re-wrapped on the way.
    let mangled =
        b"-----BEGIN CERTIFICATE-----\nnot base64 at all !!!\n-----END CERTIFICATE-----\n";

    let refusal = ClientTls::new("localhost:9091", &Trust::Pem(mangled.to_vec()))
        .expect_err("the block is framed and its contents are not base64");

    assert!(
        matches!(refusal, TlsError::Unreadable(_)),
        "got {refusal:?}"
    );
}

#[test]
fn every_certificate_in_a_ca_file_is_trusted() {
    // A CA file legitimately holds more than one — an old issuer and its replacement during a
    // changeover, which is the whole reason a rotation does not need a flag day.
    let first = certified(&["localhost"]);
    let second = certified(&["localhost"]);
    let both = format!("{}{}", first.certificate, second.certificate);

    ClientTls::new("localhost:9091", &Trust::Pem(both.into_bytes()))
        .expect("both are trust anchors");
}
