//! The certificate the remote listener terminates, and what makes one usable.
//!
//! **This closes the one gap [`super::Remote`] used to name.** The bearer token is presented in a header
//! during the WebSocket handshake, so on a plaintext listener anything that can read the wire can read it
//! and replay it — and what it replays into is full container-engine control. A token is an
//! authentication mechanism and it was carrying a confidentiality requirement it cannot meet on its own.
//!
//! **TLS sits BELOW the WebSocket, not beside it.** The accepted stream is wrapped and tungstenite is
//! handed the result, so there is one handshake path, one session, one set of frames — the same rule
//! [`super`] states about the local and remote listeners, one layer further down. Nothing above the wrap
//! can tell which stream it got, which is why `wss://` needed no second protocol and no second dispatch.
//!
//! **This module holds the decisions and performs no I/O.** It is handed BYTES, so every rule below is
//! checkable without a file: what an empty chain means, which spellings of a private key are read, and
//! that a key which does not match its certificate is a refusal to start rather than a listener that
//! fails every handshake. Reading the two files is [`crate::cli`]'s, which is where a path can be named.
//!
//! **Rotation: read once, at start, and restarting is how a certificate is replaced.** That is a
//! decision rather than an omission. A server that reloaded would need to answer WHEN — a signal, a file
//! watch, an expiry poll — and each answer has a failure mode of its own: a watch fires on a half-written
//! file, a poll needs the clock the certificate was issued against, and a signal is one more thing to
//! get wrong in a unit file. Restarting has none of them, and it is what this process is already cheap
//! at: it holds no client state that outlives a socket, so a restart costs every attached client one
//! reconnect. If that ever stops being true, this is where the reload goes and the note above is what it
//! has to answer.

use std::sync::Arc;

use tokio_rustls::TlsAcceptor;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};
use tokio_rustls::rustls::{DEFAULT_VERSIONS, ServerConfig};

/// Why the certificate and key cannot serve a listener.
///
/// **Every one of these is decided before anything binds**, which is the same rule the rest of the
/// posture follows: a server that came up and then failed every handshake would report itself healthy to
/// its supervisor while being unreachable to everybody else.
#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    /// PEM with no `CERTIFICATE` block in it. A key file given to `--tls-cert` is the usual way here,
    /// and the other is a DER file that was never converted.
    #[error(
        "the certificate file holds no certificate: it needs at least one PEM CERTIFICATE block"
    )]
    NoCertificates,
    /// PEM with no private key in it, in any of the three spellings.
    #[error(
        "the key file holds no private key: it needs a PEM PRIVATE KEY, RSA PRIVATE KEY or EC PRIVATE KEY block"
    )]
    NoPrivateKey,
    /// The bytes are not PEM at all. Named by WHICH file, because the two are given as separate flags
    /// and swapping them is the commonest way to arrive here.
    #[error("the {what} file is not readable as PEM: {source}")]
    Unreadable {
        what: &'static str,
        #[source]
        source: std::io::Error,
    },
    /// rustls refused the pair. The one that matters is a key that does not belong to the certificate —
    /// which is otherwise discovered by a client, at handshake time, as an error about the wrong thing.
    #[error("the certificate and key are not a usable pair: {0}")]
    Rejected(#[source] tokio_rustls::rustls::Error),
}

/// A certificate chain and its key, in the form a listener can accept with.
///
/// **Holding one IS the check**, the way holding an [`super::Admitted`] is: there is no way to have this
/// value without having gone through [`ServerTls::from_pem`], so a caller cannot bind a listener it
/// believes is encrypted against material rustls was going to refuse.
#[derive(Clone)]
pub struct ServerTls {
    config: Arc<ServerConfig>,
    /// How long the chain is, for [`std::fmt::Debug`] and for the start-up log. **Not cosmetic**: a
    /// chain of one is a leaf with no intermediates, which is the single commonest reason a certificate
    /// that "works in a browser" is refused by a client carrying only roots.
    depth: usize,
}

/// Hand-written, and the reason is the same one [`super::auth::Token`] has: the value contains a private
/// key, and a derived `Debug` on a struct that holds one is a key in a panic message. `ServerConfig` does
/// not print its key material either, but this does not depend on that staying true.
impl std::fmt::Debug for ServerTls {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ServerTls")
            .field("chain_depth", &self.depth)
            .finish()
    }
}

impl ServerTls {
    /// Read a certificate chain and a private key, and refuse anything a listener could not serve with.
    ///
    /// **The order of the checks is what makes the messages worth reading.** "No certificate here" and
    /// "no key here" are answered before rustls is asked anything, so the two commonest mistakes — the
    /// files swapped, or a path that pointed at the wrong thing — are named as themselves rather than
    /// arriving as a rustls error about a missing end-entity certificate.
    pub fn from_pem(certificates: &[u8], key: &[u8]) -> Result<Self, TlsError> {
        let chain = read_certificates(certificates)?;
        if chain.is_empty() {
            return Err(TlsError::NoCertificates);
        }
        let key = read_key(key)?.ok_or(TlsError::NoPrivateKey)?;
        let depth = chain.len();
        // The provider is named rather than taken from the process default, and that is deliberate: the
        // default is global mutable state a library elsewhere in the process can set, and a server whose
        // cipher suites depend on what else was linked is a server whose posture is not in its own
        // source. `DEFAULT_VERSIONS` is TLS 1.3 and 1.2 — 1.2 stays because this terminates for clients
        // an operator does not choose, and rustls has no 1.0/1.1 to fall back to.
        let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
        let config = ServerConfig::builder_with_provider(provider)
            .with_protocol_versions(DEFAULT_VERSIONS)
            .map_err(TlsError::Rejected)?
            // No client certificates. The client is authenticated by the bearer token, which is one
            // mechanism rather than two half-configured ones — and mutual TLS would need an issuing
            // story this process has no part of.
            .with_no_client_auth()
            .with_single_cert(chain, key)
            .map_err(TlsError::Rejected)?;
        Ok(Self {
            config: Arc::new(config),
            depth,
        })
    }

    /// How long the chain is. A leaf on its own is worth a word at start-up.
    pub fn chain_depth(&self) -> usize {
        self.depth
    }

    /// The acceptor each connection is wrapped with. Cheap to clone — it is an `Arc` over the config.
    pub fn acceptor(&self) -> TlsAcceptor {
        TlsAcceptor::from(Arc::clone(&self.config))
    }
}

/// Every `CERTIFICATE` block, in the order the file has them — which IS the chain order rustls needs.
fn read_certificates(pem: &[u8]) -> Result<Vec<CertificateDer<'static>>, TlsError> {
    rustls_pemfile::certs(&mut std::io::BufReader::new(pem))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|source| TlsError::Unreadable {
            what: "certificate",
            source,
        })
}

/// The first private key, in any of the three spellings a tool might have written.
///
/// PKCS#8 (`PRIVATE KEY`), PKCS#1 (`RSA PRIVATE KEY`) and SEC1 (`EC PRIVATE KEY`) are all in use by
/// tools an operator plausibly has, and telling somebody their perfectly good key is in the wrong
/// dialect is not a message worth sending. `rustls_pemfile::private_key` reads all three.
fn read_key(pem: &[u8]) -> Result<Option<PrivateKeyDer<'static>>, TlsError> {
    rustls_pemfile::private_key(&mut std::io::BufReader::new(pem)).map_err(|source| {
        TlsError::Unreadable {
            what: "key",
            source,
        }
    })
}
