//! What the command line asks for, and what that means.
//!
//! **In the library rather than in `main.rs`, because it is the part with answers.** Whether `--remote`
//! without a token starts anything, where a token may arrive from, whether a trailing newline in a token
//! file counts — those are decisions, and a decision that lives in a binary's `main` is a decision no
//! test can ask about. What is left in `main.rs` is wiring: parse, build a runtime, serve, exit.
//!
//! **The token never arrives as an argument.** There is deliberately no `--token`: argv is world-readable
//! through `ps` on every platform this runs on, so a token passed that way is a token every user on the
//! machine has. A file is preferred over the environment because a file has an owner and a mode, where an
//! environment variable is inherited by every child this process spawns — and this process spawns `ssh`.

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::Parser;

use crate::host;
use crate::listen::auth::Token;
use crate::listen::{Admitted, Listen};

/// The environment variable a token may arrive in, when a file is not used.
pub const TOKEN_VAR: &str = "CDC_SERVER_TOKEN";

#[derive(Debug, Parser)]
#[command(
    name = "cdc-server",
    about = "Serve container-engine connections over a local socket, and optionally over the network.",
    version
)]
pub struct Options {
    /// Where the local socket lives. Defaults to one beside `user-settings.json`.
    #[arg(long, value_name = "PATH")]
    pub socket: Option<PathBuf>,

    /// Do not listen locally. Only meaningful together with `--remote`, and refused on its own.
    #[arg(long)]
    pub no_local: bool,

    /// Also listen for network clients on this address. **Off unless given**, and refused without a
    /// token.
    #[arg(long, value_name = "ADDR")]
    pub remote: Option<SocketAddr>,

    /// A file holding the bearer token remote clients must present. Preferred over the environment.
    #[arg(long, value_name = "PATH")]
    pub token_file: Option<PathBuf>,

    /// The PEM certificate chain the remote listener serves, turning `ws://` into `wss://`. Needs
    /// `--tls-key`, and does nothing without `--remote`.
    ///
    /// **The leaf FIRST and every intermediate after it.** A chain that stops at the leaf is what a
    /// browser papers over and a client carrying only roots refuses, so the depth is logged at start.
    ///
    /// **It must be an END-ENTITY certificate, and the obvious way to make one does not produce one.**
    /// `openssl req -x509` defaults to `basicConstraints: CA:TRUE`, and a CA certificate served as a
    /// leaf is refused by every rustls client with `CaUsedAsEndEntity` — `cdc-client` included. Found by
    /// driving the two binaries against each other rather than by any test, because `rcgen`, which the
    /// suite generates with, makes a leaf. What works:
    ///
    /// ```text
    /// openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    ///   -keyout key.pem -out cert.pem -subj "/CN=<the name clients dial>" \
    ///   -addext "subjectAltName=DNS:<the name clients dial>" \
    ///   -addext "basicConstraints=critical,CA:FALSE" \
    ///   -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    ///   -addext "extendedKeyUsage=serverAuth"
    /// ```
    ///
    /// The name in `subjectAltName` is what a client verifies, so it has to be the one clients DIAL —
    /// an IP address needs `IP:10.0.0.4` rather than `DNS:`.
    #[arg(long, value_name = "PATH", requires = "tls_key")]
    pub tls_cert: Option<PathBuf>,

    /// The PEM private key for `--tls-cert`. PKCS#8, PKCS#1 or SEC1 — whichever the tool that made it
    /// wrote.
    ///
    /// **A path, never a value.** Same rule the token has and for the same reason: argv is world-readable
    /// through `ps`. A key is additionally a file whose MODE is the point, which a string has none of.
    #[arg(long, value_name = "PATH", requires = "tls_cert")]
    pub tls_key: Option<PathBuf>,

    /// The bearer token, from the environment only — never as an argument. See the module docs.
    #[arg(
        long = "token-env",
        env = TOKEN_VAR,
        hide_env_values = true,
        value_name = "TOKEN"
    )]
    pub token: Option<String>,

    /// `error`, `warn`, `info`, `debug`, `trace`, or anything `RUST_LOG` accepts. `RUST_LOG` wins.
    #[arg(long, default_value = "info", value_name = "FILTER")]
    pub log: String,

    /// Log JSON rather than text, for a collector rather than a terminal.
    #[arg(long)]
    pub log_json: bool,
}

/// Why an invocation will not start anything.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The posture refused it — no listener at all, or a remote one with no token.
    #[error(transparent)]
    Listen(#[from] crate::listen::ListenError),
    /// The token file could not be read. The PATH is named and the contents never are.
    #[error("the token file {path} cannot be read: {source}")]
    TokenFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// The certificate or the key could not be read. Same rule: the PATH, never the contents.
    #[error("the TLS file {path} cannot be read: {source}")]
    TlsFile {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// Both files were read and they cannot serve a listener. **Both paths are named**, because the
    /// commonest way here is passing them to each other's flag, and an error about only one of them
    /// sends the reader to the file that is fine.
    #[error("--tls-cert {cert} with --tls-key {key} cannot serve a listener: {source}")]
    Tls {
        cert: PathBuf,
        key: PathBuf,
        #[source]
        source: crate::listen::tls::TlsError,
    },
    /// A certificate with nothing to encrypt. **Refused rather than ignored**, the way a token with no
    /// `--remote` is on the client: silently dropping it is how somebody comes to believe a listener is
    /// encrypted when there is no listener at all.
    #[error(
        "--tls-cert and --tls-key were given with no --remote to serve: the local socket is not TLS, its access control is its mode"
    )]
    TlsWithNoRemote,
}

impl Options {
    /// The listeners this invocation asks for, admitted or refused.
    ///
    /// Nothing is bound here: what this answers is whether binding would be allowed, which is the
    /// question that has to be settled before a socket exists (see [`Admitted`]).
    pub fn admitted(&self) -> Result<Admitted, ConfigError> {
        let tls = self.tls()?;
        let remote = match self.remote {
            Some(address) => Some(Admitted::remote_from(address, self.token()?, tls)?),
            None if tls.is_some() => return Err(ConfigError::TlsWithNoRemote),
            None => None,
        };
        Ok(Admitted::admit(Listen {
            local: self.local_endpoint(),
            remote,
        })?)
    }

    /// The certificate this invocation asks the remote listener to serve, or `None` for plaintext.
    ///
    /// **Read here rather than at bind time**, which is the rule the whole of [`Admitted`] follows: a
    /// certificate that cannot serve is an operator's typo, and a typo has to stop the process before it
    /// has a socket, not after it has one that fails every handshake.
    pub fn tls(&self) -> Result<Option<crate::listen::tls::ServerTls>, ConfigError> {
        // clap's `requires` makes each flag demand the other, so one present means both are.
        let (Some(cert), Some(key)) = (&self.tls_cert, &self.tls_key) else {
            return Ok(None);
        };
        let material = crate::listen::tls::ServerTls::from_pem(&read(cert)?, &read(key)?).map_err(
            |source| ConfigError::Tls {
                cert: cert.clone(),
                key: key.clone(),
                source,
            },
        )?;
        Ok(Some(material))
    }

    /// Where the local socket goes, or `None` when this invocation asked for no local listener.
    pub fn local_endpoint(&self) -> Option<PathBuf> {
        if self.no_local {
            return None;
        }
        Some(
            self.socket
                .clone()
                .unwrap_or_else(host::default_local_endpoint),
        )
    }

    /// The token, from a file if one was named and from the environment otherwise.
    ///
    /// **Trimmed, both ways.** A token in a file has a trailing newline in it — every editor and every
    /// `echo` puts one there — and a token that only fails when it was created with an editor is a
    /// support case nobody enjoys. `Token::is_empty` trims too, so whitespace cannot pass as a secret.
    pub fn token(&self) -> Result<Option<Token>, ConfigError> {
        if let Some(path) = &self.token_file {
            let contents =
                std::fs::read_to_string(path).map_err(|source| ConfigError::TokenFile {
                    path: path.clone(),
                    source,
                })?;
            return Ok(Some(Token::new(contents.trim())));
        }
        Ok(self.token.as_deref().map(str::trim).map(Token::new))
    }
}

/// A TLS file, read whole and NOT trimmed — PEM's own framing is what says where a block ends, and a
/// key file is bytes rather than a string with a stray newline to forgive.
fn read(path: &PathBuf) -> Result<Vec<u8>, ConfigError> {
    std::fs::read(path).map_err(|source| ConfigError::TlsFile {
        path: path.clone(),
        source,
    })
}
