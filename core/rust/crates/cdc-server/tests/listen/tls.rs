//! What makes a certificate usable, answering to `src/listen/tls.rs`.
//!
//! **Every refusal here is one an operator can act on**, which is why they are separate variants rather
//! than one "bad TLS material": the files given to each other's flag, a chain that stops at the leaf and
//! a key that belongs to a different certificate are three different mistakes with three different
//! fixes, and a single message covering all of them tells nobody which one they made.
//!
//! Nothing in this file touches the filesystem. The module is handed bytes precisely so these rules are
//! checkable without one — reading a path is `cli.rs`'s, and it is asserted there.

use cdc_server::listen::tls::{ServerTls, TlsError};

use crate::harness::certified;

#[test]
fn a_certificate_and_its_own_key_serve_a_listener() {
    let material = certified(&["localhost"]);

    let tls = ServerTls::from_pem(material.certificate.as_bytes(), material.key.as_bytes())
        .expect("a self-signed certificate and its own key are usable");

    assert_eq!(
        tls.chain_depth(),
        1,
        "a self-signed certificate is a leaf with nothing above it"
    );
}

#[test]
fn the_two_files_given_to_each_others_flag_are_named_as_themselves() {
    // The commonest way to arrive here, and the one where a rustls error about a missing end-entity
    // certificate sends the reader to the wrong question entirely.
    let material = certified(&["localhost"]);

    let swapped = ServerTls::from_pem(material.key.as_bytes(), material.certificate.as_bytes())
        .expect_err("a key is not a certificate");

    assert!(
        matches!(swapped, TlsError::NoCertificates),
        "got {swapped:?}"
    );
    assert!(
        swapped.to_string().contains("no certificate"),
        "and it says which file is wrong: {swapped}"
    );
}

#[test]
fn a_key_file_with_no_key_in_it_is_refused() {
    // The other half of the swap, reached separately: a certificate PEM parses as a certificate and
    // then has no key in it, so this is a different arm of the same mistake.
    let material = certified(&["localhost"]);

    let refusal = ServerTls::from_pem(
        material.certificate.as_bytes(),
        material.certificate.as_bytes(),
    )
    .expect_err("a certificate is not a key");

    assert!(matches!(refusal, TlsError::NoPrivateKey), "got {refusal:?}");
    assert!(
        refusal.to_string().contains("PRIVATE KEY"),
        "and it names the block it wanted: {refusal}"
    );
}

#[test]
fn bytes_that_are_not_pem_at_all_are_refused() {
    // A DER file that was never converted, or a path that pointed at something else entirely. There is
    // no PEM framing here, so nothing is found rather than something being malformed.
    let refusal = ServerTls::from_pem(b"\x30\x82\x01\x0a not pem", b"nor is this")
        .expect_err("DER is not PEM");

    assert!(
        matches!(refusal, TlsError::NoCertificates),
        "got {refusal:?}"
    );
}

#[test]
fn pem_framing_with_rubbish_inside_it_is_refused_as_unreadable() {
    // Told apart from "no certificate here", and the difference is worth having: this file WAS meant to
    // be a certificate — it says so — and it was truncated, re-wrapped by a mail client or edited by
    // hand. Pointing that reader at "give me a PEM CERTIFICATE block" would be answering the wrong
    // question.
    let material = certified(&["localhost"]);
    let mangled = "-----BEGIN CERTIFICATE-----\nnot base64 at all !!!\n-----END CERTIFICATE-----\n";

    let refusal = ServerTls::from_pem(mangled.as_bytes(), material.key.as_bytes())
        .expect_err("the block is framed and its contents are not base64");

    let TlsError::Unreadable { what, .. } = &refusal else {
        panic!("got {refusal:?}");
    };
    assert_eq!(*what, "certificate", "and it says which file: {refusal}");
}

#[test]
fn a_key_framed_as_pem_and_malformed_inside_is_refused_as_unreadable() {
    // The same arm as the certificate's, on the other file — and it is a SEPARATE arm because the
    // message names which one. Asserted rather than assumed: the coverage gate found this one
    // unexercised while its certificate twin above was, which is exactly how a `what:` field ends up
    // saying the wrong word in the branch nobody ran.
    let material = certified(&["localhost"]);
    let mangled = "-----BEGIN PRIVATE KEY-----\nnot base64 at all !!!\n-----END PRIVATE KEY-----\n";

    let refusal = ServerTls::from_pem(material.certificate.as_bytes(), mangled.as_bytes())
        .expect_err("the block is framed and its contents are not base64");

    let TlsError::Unreadable { what, .. } = &refusal else {
        panic!("got {refusal:?}");
    };
    assert_eq!(*what, "key", "and it says which file: {refusal}");
}

#[test]
fn a_key_that_belongs_to_another_certificate_is_refused_before_anything_binds() {
    // The one this exists for. Both files are perfectly good PEM, both hold what they claim to hold, and
    // the pair cannot serve — which without this check is discovered by a CLIENT, at handshake time, as
    // an error about the wrong thing entirely.
    let served = certified(&["localhost"]);
    let other = certified(&["localhost"]);

    let refusal = ServerTls::from_pem(served.certificate.as_bytes(), other.key.as_bytes())
        .expect_err("the key does not belong to that certificate");

    assert!(matches!(refusal, TlsError::Rejected(_)), "got {refusal:?}");
    assert!(
        refusal.to_string().contains("not a usable pair"),
        "and it says what is wrong rather than passing rustls's words through alone: {refusal}"
    );
}

#[test]
fn the_chain_depth_counts_every_certificate_in_the_file() {
    // What the number is FOR: a chain of one is a leaf with no intermediates, which is the commonest
    // reason a certificate that "works in a browser" — browsers fetch the missing link — is refused by a
    // client carrying only roots. rustls checks the key against the LEAF and takes the rest on trust, so
    // a second block is enough to assert the count is a count.
    let leaf = certified(&["localhost"]);
    let above = certified(&["issuer.example"]);
    let chain = format!("{}{}", leaf.certificate, above.certificate);

    let one = ServerTls::from_pem(leaf.certificate.as_bytes(), leaf.key.as_bytes())
        .expect("a leaf on its own");
    let two = ServerTls::from_pem(chain.as_bytes(), leaf.key.as_bytes())
        .expect("a leaf with something above it");

    assert_eq!(one.chain_depth(), 1);
    assert_eq!(two.chain_depth(), 2);
}

#[test]
fn the_leaf_must_come_first_in_the_chain() {
    // PEM order IS chain order, and getting it backwards is a file that looks right and cannot serve:
    // rustls checks the key against the FIRST block. Asserted so the ordering in `read_certificates`
    // stays a decision rather than an accident of how the parser happened to yield.
    let leaf = certified(&["localhost"]);
    let above = certified(&["issuer.example"]);
    let backwards = format!("{}{}", above.certificate, leaf.certificate);

    let refusal = ServerTls::from_pem(backwards.as_bytes(), leaf.key.as_bytes())
        .expect_err("the key does not belong to the block that is first");

    assert!(matches!(refusal, TlsError::Rejected(_)), "got {refusal:?}");
}

#[test]
fn nothing_about_it_prints_the_private_key() {
    // The rule `auth::Token` carries, on the value that holds the other secret in this process. A
    // derived `Debug` here would put key material in a panic message.
    let material = certified(&["localhost"]);
    let tls = ServerTls::from_pem(material.certificate.as_bytes(), material.key.as_bytes())
        .expect("usable");

    let printed = format!("{tls:?}");

    assert!(
        !printed.contains("PRIVATE"),
        "the key's own framing is not in it: {printed}"
    );
    // The body of the key, not just its label — a `Debug` that printed raw DER would pass the check
    // above and fail this one.
    let body: String = material
        .key
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect();
    assert!(
        !body.is_empty() && !printed.contains(&body[..32]),
        "and neither is its content: {printed}"
    );
    assert!(
        printed.contains("chain_depth: 1"),
        "what it does print is the one thing worth reading: {printed}"
    );
}
