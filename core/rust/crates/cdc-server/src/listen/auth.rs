//! The bearer token.
//!
//! Three requirements, and each one is met by a mechanism rather than by care:
//!
//! - **compared in constant time.** `==` on a string stops at the first differing byte, and the time
//!   that takes is a measurement of how much of the token an attacker has already guessed. `subtle`'s
//!   `ct_eq` is the standard answer and it is bought rather than written, because a hand-rolled loop is
//!   exactly what an optimiser is entitled to short-circuit back into a fast path.
//! - **never logged.** [`Token`] wraps `secrecy::SecretString`, whose `Debug` renders a redaction and
//!   whose buffer is zeroed on drop. So `{token:?}`, a `#[derive(Debug)]` on any struct that holds one,
//!   and a `tracing` field all print `[REDACTED]` — the rule holds without anyone remembering it, which
//!   is the same reason `Push::is_droppable` lives on the frame.
//! - **never written to a corpus file.** There is no corpus at all. Nothing in this
//!   crate serialises a token, and [`Token`] has no `Serialize` for that to be an accident.
//!
//! What this module does NOT do is decide whether a token is required — that is [`super::Admitted`]'s
//! answer, made before anything binds.

use secrecy::{ExposeSecret, SecretString};
use subtle::ConstantTimeEq;

/// The header a client presents, and the only one this server reads.
pub const AUTHORIZATION: &str = "authorization";

/// The scheme, matched case-insensitively because RFC 7235 says the scheme is case-insensitive and
/// clients really do send `bearer`.
const BEARER: &str = "bearer";

/// A shared secret that guards a remote listener.
///
/// Clone is cheap and safe — `SecretString` is reference-counted internally — which matters because
/// every accepted connection compares against the same token.
#[derive(Clone)]
pub struct Token(SecretString);

impl Token {
    pub fn new(token: impl Into<String>) -> Self {
        Self(SecretString::from(token.into()))
    }

    /// A token with nothing in it, which [`super::Admitted`] refuses. Whitespace counts as nothing: a
    /// token read from a file is trimmed, so `" "` arrives here as empty and must not read as a secret.
    pub fn is_empty(&self) -> bool {
        self.0.expose_secret().trim().is_empty()
    }

    /// Whether a presented value is this token, in time that does not depend on how much of it matches.
    ///
    /// Lengths that differ answer `false` immediately, which leaks the LENGTH of the token and nothing
    /// about its contents — the same trade every constant-time comparison of variable-length secrets
    /// makes, and the reason a token's length is not a secret worth protecting.
    pub fn matches(&self, presented: &str) -> bool {
        let expected = self.0.expose_secret().as_bytes();
        let presented = presented.as_bytes();
        expected.len() == presented.len() && bool::from(expected.ct_eq(presented))
    }
}

/// `Debug` for a token that cannot leak it. Delegated to `SecretString`, which renders a redaction.
impl std::fmt::Debug for Token {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&self.0, formatter)
    }
}

/// The token out of an `Authorization: Bearer <token>` header value.
///
/// `None` for anything that is not that: no header, a scheme this server does not speak, or a scheme
/// with nothing after it. A caller cannot tell those apart on purpose — which of the four ways a
/// request was unauthorized is information for this process's log and not for whoever sent it.
pub fn bearer(header_value: &str) -> Option<&str> {
    let (scheme, token) = header_value.trim().split_once(' ')?;
    if !scheme.eq_ignore_ascii_case(BEARER) {
        return None;
    }
    let token = token.trim();
    (!token.is_empty()).then_some(token)
}

/// Whether a request carrying these headers may proceed.
///
/// Takes the LOOKUP rather than the headers so it serves both the handshake (where the headers are
/// tungstenite's `http::HeaderMap`) and a test (where they are whatever it likes) — and so the
/// case-insensitive lookup stays the caller's, since that is the part their type already does.
pub fn admits(token: &Token, header_value: Option<&str>) -> bool {
    header_value
        .and_then(bearer)
        .is_some_and(|presented| token.matches(presented))
}
