//! The bearer token: what it admits, what it refuses, and what it will not print.
//!
//! The constant-time property itself is not asserted here and deliberately so — a timing assertion is a
//! flaky test on a loaded machine, and what can be checked is that the comparison goes through `subtle`
//! at all, which is a review question rather than a runtime one. What IS asserted is every case a
//! comparison has to get right, including the two that a hand-rolled one gets wrong: a presented value
//! that is a PREFIX of the token, and one that is longer.

use cdc_server::listen::auth::{Token, admits, bearer};

#[test]
fn a_token_matches_itself_and_nothing_else() {
    let token = Token::new("s3cret-value");

    assert!(token.matches("s3cret-value"));
    assert!(
        !token.matches("s3cret-valuf"),
        "same length, one byte different"
    );
    assert!(!token.matches("s3cret"), "a prefix is not the token");
    assert!(
        !token.matches("s3cret-value-and-more"),
        "nor is anything that starts with it"
    );
    assert!(!token.matches(""), "and neither is nothing");
}

#[test]
fn emptiness_is_answered_in_both_directions() {
    // Both, because a predicate asserted one way only is a predicate that does not distinguish — the
    // mutation score has caught exactly this twice.
    assert!(Token::new("").is_empty());
    assert!(Token::new("   ").is_empty(), "whitespace is not a secret");
    assert!(Token::new("\n\t").is_empty());
    assert!(!Token::new("s").is_empty());
    assert!(!Token::new(" s ").is_empty(), "but a secret with space is");
}

#[test]
fn the_scheme_is_read_case_insensitively() {
    // RFC 7235 says the scheme is case-insensitive, and clients really do send `bearer`.
    assert_eq!(bearer("Bearer abc"), Some("abc"));
    assert_eq!(bearer("bearer abc"), Some("abc"));
    assert_eq!(bearer("BEARER abc"), Some("abc"));
}

#[test]
fn a_header_that_is_not_a_bearer_token_reads_as_none() {
    assert_eq!(bearer("Basic abc"), None, "another scheme");
    assert_eq!(bearer("Bearer"), None, "a scheme with nothing after it");
    assert_eq!(bearer("Bearer   "), None, "nor with only space after it");
    assert_eq!(bearer(""), None);
    assert_eq!(bearer("abc"), None, "a bare value is not a scheme");
}

#[test]
fn surrounding_space_is_not_part_of_the_token() {
    assert_eq!(bearer("  Bearer   abc  "), Some("abc"));
}

#[test]
fn admitting_needs_the_header_and_the_right_value() {
    let token = Token::new("s3cret");

    assert!(admits(&token, Some("Bearer s3cret")));
    assert!(!admits(&token, Some("Bearer wrong")), "the wrong token");
    assert!(!admits(&token, Some("s3cret")), "the token with no scheme");
    assert!(!admits(&token, None), "no header at all");
}

#[test]
fn a_token_cannot_be_printed() {
    // The requirement is "never logged", and this is what enforces it: `{:?}` is what a `tracing` field
    // and a `#[derive(Debug)]` on any struct holding one both reach for.
    let token = Token::new("s3cret-value");

    let printed = format!("{token:?}");

    assert!(
        !printed.contains("s3cret"),
        "a token must not be printable: {printed}"
    );
    assert!(
        printed.to_lowercase().contains("redacted"),
        "and it should say that it was withheld rather than look empty: {printed}"
    );
}

#[test]
fn a_token_that_is_cloned_is_still_the_same_secret() {
    // Every accepted connection compares against the same token, so it is cloned per client.
    let token = Token::new("s3cret");

    let clone = token.clone();

    assert!(clone.matches("s3cret"));
    assert!(!clone.matches("other"));
}
