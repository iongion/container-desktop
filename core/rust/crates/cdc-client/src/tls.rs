//! What this client will trust a server to be, before it presents a token to one.
//!
//! **The other end of [`cdc_server::listen::tls`], and it is the end that carries the harder half.** A
//! server proves who it is by holding a key; a client decides whether that proof means anything, and
//! getting that decision wrong is how an encrypted connection ends up being encrypted to the wrong peer.
//! The token this client presents is worth exactly as much as the answer here — an attacker who can
//! terminate TLS gets handed the secret in a header on the very first frame.
//!
//! **There is deliberately no way to skip verification.** No `--tls-insecure`, no "accept any
//! certificate", no environment variable. Such a flag is reached for once during a bad afternoon and
//! then lives in a systemd unit for three years, and what it produces is a connection that reports
//! itself as encrypted while being exactly as safe as `ws://` — which is worse than `ws://`, because
//! nobody is warned. What replaces it is [`Trust::Pem`]: point the client at the certificate the server
//! actually serves, which is one flag, works with a self-signed certificate, and is a real check.
//!
//! **The name is verified, and the address is only how it was reached.** A certificate is issued for a
//! NAME, so `--remote engine.example:9091` verifies `engine.example` however DNS resolved it, and
//! `--remote 10.0.0.4:9091` needs a certificate with that IP in it — which is what an operator issuing
//! their own certificate has to be told, because the tools make it easy to omit.

use std::sync::Arc;

use tokio_rustls::TlsConnector;
use tokio_rustls::rustls::pki_types::ServerName;
use tokio_rustls::rustls::{ClientConfig, DEFAULT_VERSIONS, RootCertStore};

/// What this client checks a server's certificate against.
#[derive(Debug, Clone)]
pub enum Trust {
    /// Mozilla's root programme, compiled into the binary. For a certificate from a public CA.
    ///
    /// Compiled in rather than read from the platform store, which would be a native dependency per OS
    /// and a different answer on each — including "there is no store" on a minimal container image,
    /// which fails as an empty trust set rather than as an error.
    Roots,
    /// Exactly the certificates in this PEM, and nothing else.
    ///
    /// **The realistic case**, and the answer to every reason somebody would otherwise want to skip
    /// verification: a certificate the operator issued, which no root programme has ever heard of.
    ///
    /// **Pinning the server's own leaf works only if it IS a leaf.** `openssl req -x509` writes
    /// `basicConstraints: CA:TRUE` by default, and rustls refuses a CA certificate used as an
    /// end-entity one — the handshake fails with `CaUsedAsEndEntity`, which names the rule and not the
    /// fix. `cdc-server`'s `--tls-cert` help carries the invocation that makes a usable one. The other
    /// arrangement always works: a real CA certificate here, and a leaf it signed on the server.
    Pem(Vec<u8>),
}

/// Why this client will not dial a server over TLS.
#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    /// The `--tls-ca` file holds no certificate. A key, a DER file, or a path that pointed elsewhere.
    #[error("the CA file holds no certificate: it needs at least one PEM CERTIFICATE block")]
    NoTrustAnchors,
    /// The bytes are framed as PEM and are not readable as it.
    #[error("the CA file is not readable as PEM: {0}")]
    Unreadable(#[source] std::io::Error),
    /// A certificate was read and cannot be a trust anchor.
    #[error("the CA file holds a certificate that cannot be trusted as an issuer: {0}")]
    NotATrustAnchor(#[source] tokio_rustls::rustls::Error),
    /// The address names something that is neither a DNS name nor an IP address, so there is nothing a
    /// certificate could be checked against. **Refused rather than dialled**: a connection whose peer
    /// cannot be identified is the thing this module exists to prevent.
    #[error(
        "{host} is neither a DNS name nor an IP address, so no certificate can be verified against it"
    )]
    NotAServerName { host: String },
    /// rustls refused the configuration itself.
    #[error("the TLS configuration was refused: {0}")]
    Rejected(#[source] tokio_rustls::rustls::Error),
}

/// A trust decision and the name it is made about, ready to dial with.
///
/// **Built when the command line is read rather than when the socket is opened**, which is the rule the
/// rest of a client's CLI follows: a CA file that cannot be read is an operator's typo, and a typo has
/// to be a refusal to start rather than a failure on the first connect.
#[derive(Clone)]
pub struct ClientTls {
    config: Arc<ClientConfig>,
    name: ServerName<'static>,
}

/// Prints the name being verified and nothing about the configuration. There is no secret in a client's
/// TLS config — it holds no key — so this is for a reader rather than for safety, and what a reader
/// needs is which name a failed handshake was about.
impl std::fmt::Debug for ClientTls {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClientTls")
            .field("verifying", &self.name)
            .finish()
    }
}

impl ClientTls {
    /// Decide what to trust, and what name to check it against.
    ///
    /// `address` is the `host:port` a caller typed; the host half is what a certificate is issued for.
    pub fn new(address: &str, trust: &Trust) -> Result<Self, TlsError> {
        let host = host_of(address);
        let name = ServerName::try_from(host)
            .map_err(|_| TlsError::NotAServerName {
                host: host.to_string(),
            })?
            .to_owned();
        // Named rather than taken from the process default, for the reason the server's is: the default
        // is global mutable state anything else linked into this process can set, and a client whose
        // cipher suites depend on what else is in the binary is a client whose posture is not in its
        // own source.
        let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
        let config = ClientConfig::builder_with_provider(provider)
            .with_protocol_versions(DEFAULT_VERSIONS)
            .map_err(TlsError::Rejected)?
            .with_root_certificates(anchors(trust)?)
            // No client certificate. The client is authenticated by the bearer token, which is one
            // mechanism rather than two half-configured ones.
            .with_no_client_auth();
        Ok(Self {
            config: Arc::new(config),
            name,
        })
    }

    /// The connector each dial goes through. Cheap to clone — it is an `Arc` over the config.
    pub fn connector(&self) -> TlsConnector {
        TlsConnector::from(Arc::clone(&self.config))
    }

    /// The name a server's certificate is checked against.
    pub fn name(&self) -> ServerName<'static> {
        self.name.clone()
    }
}

/// The trust anchors a decision comes down to.
fn anchors(trust: &Trust) -> Result<RootCertStore, TlsError> {
    let mut roots = RootCertStore::empty();
    match trust {
        Trust::Roots => roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned()),
        Trust::Pem(pem) => {
            for certificate in rustls_pemfile::certs(&mut std::io::BufReader::new(&pem[..])) {
                roots
                    .add(certificate.map_err(TlsError::Unreadable)?)
                    .map_err(TlsError::NotATrustAnchor)?;
            }
            // **An empty store is not "trust nothing", it is a client that refuses every server** — and
            // it would do so with a handshake error about an unknown issuer, which reads as the SERVER
            // being wrong. Caught here, where the file that is actually at fault can be named.
            //
            // Asked of the STORE rather than of a counter kept alongside it. A counter is a second
            // record of the same fact, and the mutation gate says so: `found += 1` mutated to `-=`
            // survived every test here, because nothing but the counter could tell.
            if roots.is_empty() {
                return Err(TlsError::NoTrustAnchors);
            }
        }
    }
    Ok(roots)
}

/// The host half of a `host:port`, which is what a certificate is issued for.
///
/// **Three spellings, and the bracketed one is why this is not a `split`**: `[::1]:9091` has four
/// colons and only the last one separates the port. Parsing as a socket address first is what settles
/// it — that grammar already knows where the address ends — and the fallback covers a DNS name, which
/// never parses as one.
fn host_of(address: &str) -> &str {
    if address.parse::<std::net::SocketAddr>().is_ok() {
        return address
            .rsplit_once(':')
            .map(|(host, _)| host.trim_start_matches('[').trim_end_matches(']'))
            .unwrap_or(address);
    }
    address
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or(address)
}
