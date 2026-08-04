//! The fixtures both test targets share: a document, a server over fakes, and a client that speaks
//! this protocol.
//!
//! **One fixture set, parameterized**, for the same reason `cdc-runtime` keeps `tests/fakes/` — the
//! alternative is that `tests/server.rs` and `tests/listen/` each grow their own settings document, and
//! the two drift until a change passes in one and fails in the other for reasons nobody can see. The
//! fake CAPABILITIES are `cdc-runtime`'s own, reached by path from here for the same reason.

#![allow(dead_code)]

use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyRequestPayload;
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;
use cdc_runtime::settings::store::SettingsStore;
use cdc_server::protocol::{Command, Push, Request, Response};
use cdc_server::server::{ClientId, MachineBuilder, Server};
use serde_json::{Value, json};

use crate::fakes::{FakeClock, FakeCommand, FakeHttp, Gate, MemoryFs, Unheard};

pub const SETTINGS: &str = "/home/tester/.config/container-desktop/user-settings.json";

/// The connection every fixture stores.
pub const CONNECTION: &str = "host.default.podman.native";

/// A SECOND connection, for the questions that only exist once a person has two engines configured.
pub const OTHER_CONNECTION: &str = "host.default.docker.native";

pub const APP_VERSION: &str = "5.2.19";

/// One attached client. Which one only matters where a stream is involved — the server holds no other
/// per-client state.
pub fn client() -> ClientId {
    ClientId::from("a-client")
}

/// A builder that must never be asked for a machine.
///
/// Stronger than an unused stub: every document command is expected to answer WITHOUT touching a
/// host, and a builder that quietly returned one would let a regression go unnoticed.
pub struct NoMachineIsBuilt;

impl MachineBuilder for NoMachineIsBuilt {
    fn build(&self, connection: Connection) -> ConnectionMachine {
        panic!("a document command built a machine for {}", connection.id);
    }
}

/// A settings file as the desktop app writes one, carrying keys this core does not model.
pub fn document() -> &'static str {
    r#"{
  "version": "5.2.19",
  "connections": [
    {
      "id": "host.default.podman.native",
      "name": "podman-native",
      "label": "Native",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": "podman", "path": "", "version": "" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }
  ],
  "ai": { "provider": "lmstudio", "model": "llama3" },
  "theme": "dark"
}"#
}

pub fn server(fs: MemoryFs) -> Server<MemoryFs, NoMachineIsBuilt, FakeClock> {
    Server::new(
        SettingsStore::new(fs, SETTINGS, APP_VERSION),
        NoMachineIsBuilt,
        FakeClock::at(0),
        OperatingSystem::Linux,
    )
}

pub fn seeded() -> MemoryFs {
    MemoryFs::seeded(SETTINGS, document())
}

/// A builder that really does build one, over faked capabilities.
///
/// It shares the server's own filesystem, so the settings document and the engine socket are the same
/// world — which is what a real host has, and what makes a connection able to reach `ready` here.
pub struct BuildsAMachine {
    fs: MemoryFs,
    /// What a STREAMED body delivers, for the cases about forwarding rather than about connecting.
    chunks: Vec<String>,
    /// What a forwarded WHOLE read answers, for a test about what a client does with the body rather
    /// than about the forwarding. `None` is the empty list every other test expects.
    body: Option<String>,
    /// The SERVER's own clock, handed on to every machine it builds — as `NativeMachines` does, and
    /// for the reason that matters to a client: `ConnectProgress::ts`, `next_retry_at` and
    /// `AppRuntimeSnapshot::now` are subtracted from one another, so they have to be one clock.
    clock: FakeClock,
    /// Where a connect STOPS, when a test wants one in flight while it asserts something else.
    ///
    /// **`start_api` turns on with it, and the two are one knob deliberately**: the gate stands in
    /// `spawn_service`, so a builder that gates a connect is exactly a builder whose connect starts the
    /// engine's own service. Two flags would let a test ask for a gate that nothing ever reaches.
    gate: Option<Gate>,
}

impl MachineBuilder for BuildsAMachine {
    fn build(&self, connection: Connection) -> ConnectionMachine {
        let chunks: Vec<&str> = self.chunks.iter().map(String::as_str).collect();
        let command = FakeCommand::answering(|argv| {
            match argv {
                ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
                [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
                // NDJSON, as the real CLI prints it — the shape is the thing worth faking, so a parser
                // that went back to reading an array would fail here rather than in production.
                [_, "context", "ls", ..] | [_, "--context", _, "context", "ls", ..] => {
                    CommandExecutionResult::ok(
                        "{\"Current\":true,\"Description\":\"Docker Desktop\",\"DockerEndpoint\":\"unix:///d.sock\",\"Error\":\"\",\"Name\":\"desktop-linux\"}\n{\"Current\":false,\"Description\":\"colima\",\"DockerEndpoint\":\"unix:///c.sock\",\"Error\":\"\",\"Name\":\"colima\"}",
                    )
                }
                _ => CommandExecutionResult::ok(
                    r#"{"host":{"remoteSocket":{"path":"/run/podman.sock","exists":true}}}"#,
                ),
            }
        });
        ConnectionMachine::new(
            ConnectOptions {
                connection,
                start_api: self.gate.is_some(),
                skip_availability_check: false,
                origin: None,
            },
            ConnectionContext {
                os: OperatingSystem::Linux,
                arch: "x64".to_string(),
                home: "/home/tester".to_string(),
                user_data_path: "/home/tester/.local/share/container-desktop".to_string(),
                ..ConnectionContext::default()
            },
            ConnectionCapabilities {
                command: Arc::new(match &self.gate {
                    Some(gate) => command.gated(gate.clone()),
                    None => command,
                }),
                fs: Arc::new(self.fs.clone()),
                // The engine is up for the readiness probe and answers an empty list to anything
                // forwarded, so a connect is honest and a forward is about the forwarding.
                http: Arc::new(
                    FakeHttp::scripted({
                        let body = self.body.clone();
                        move |request| {
                            if request.path == "/_ping" {
                                return Ok(crate::fakes::answered(200, "OK"));
                            }
                            Ok(crate::fakes::answered(200, body.as_deref().unwrap_or("[]")))
                        }
                    })
                    .delivering(&chunks),
                ),
                clock: Arc::new(self.clock.clone()),
            },
        )
    }
}

/// One command from the default client, with NOBODY listening to what it publishes.
///
/// **The listener is not optional on `dispatch`**, because a connect's progress lines go there and
/// nowhere else — an absence would silently swallow the trace of the one operation that lasts a
/// minute. So a test says which it is: this, for the majority that are asking what a command
/// ANSWERS, and an explicit `&Heard` for the few asking what a client is TOLD.
pub async fn dispatched<F: FsLocks, B: MachineBuilder, C: Clock>(
    server: &Server<F, B, C>,
    request: Request,
) -> (Response, Vec<Push>) {
    server.dispatch(&client(), request, &Unheard).await
}

pub fn running_server(fs: MemoryFs) -> Server<MemoryFs, BuildsAMachine, FakeClock> {
    streaming_server(fs, &[])
}

/// The same server, whose engine answers a forwarded whole read with THIS body.
///
/// For the tests that are about what a client does with a resource — a shape that parses, a row that
/// renders — rather than about whether a request arrived. Every other builder answers `[]`, which is
/// what makes "the list is empty" a real assertion in them.
pub fn responding_server(fs: MemoryFs, body: &str) -> Server<MemoryFs, BuildsAMachine, FakeClock> {
    let clock = FakeClock::at(0);
    Server::new(
        SettingsStore::new(fs.clone(), SETTINGS, APP_VERSION),
        BuildsAMachine {
            fs,
            chunks: Vec::new(),
            body: Some(body.to_string()),
            clock: clock.clone(),
            gate: None,
        },
        clock,
        OperatingSystem::Linux,
    )
}

pub fn streaming_server(
    fs: MemoryFs,
    chunks: &[&str],
) -> Server<MemoryFs, BuildsAMachine, FakeClock> {
    server_on(fs, chunks, FakeClock::at(0))
}

/// The same server, over a clock the CALLER holds — for a test about the stamps rather than about
/// what a command answers.
///
/// A handle rather than an accessor on `Server`: exposing its clock would be production API existing
/// only for a test, and `FakeClock` already shares its state across clones.
pub fn server_on(
    fs: MemoryFs,
    chunks: &[&str],
    clock: FakeClock,
) -> Server<MemoryFs, BuildsAMachine, FakeClock> {
    Server::new(
        SettingsStore::new(fs.clone(), SETTINGS, APP_VERSION),
        BuildsAMachine {
            fs,
            chunks: chunks.iter().map(|it| (*it).to_string()).collect(),
            body: None,
            clock: clock.clone(),
            gate: None,
        },
        clock,
        OperatingSystem::Linux,
    )
}

/// The same server, whose connect STOPS in the sub-step a real one spends its time in.
///
/// [`Gate`] holds it inside `spawn_service`, which polls a socket for readiness — ten attempts five
/// seconds apart, measured at 51 to 56 seconds against a real engine that never came up — and
/// everything a server can be asked meanwhile is what the lock split is about. Let the gate through and
/// the connection settles `ready` exactly as an ungated one does, because it IS the same builder.
pub fn gated_server(fs: MemoryFs, gate: Gate) -> Server<MemoryFs, BuildsAMachine, FakeClock> {
    let clock = FakeClock::at(0);
    Server::new(
        SettingsStore::new(fs.clone(), SETTINGS, APP_VERSION),
        BuildsAMachine {
            fs,
            chunks: Vec::new(),
            body: None,
            clock: clock.clone(),
            gate: Some(gate),
        },
        clock,
        OperatingSystem::Linux,
    )
}

/// A builder whose ENGINE the test controls, freshly for every machine it makes.
///
/// **A factory rather than one fake**, because a machine is built per connect and its client per
/// attempt: an engine handed over once could only ever describe the world as it was at the first
/// connect, and the whole subject of the reconnect cycle is a world that changed underneath it.
pub struct WatchedMachines {
    fs: MemoryFs,
    http: Arc<dyn Fn() -> FakeHttp + Send + Sync>,
    clock: FakeClock,
    /// The global reconnect policy, which is the only place `maxRetries` can come from — a
    /// per-connection `autoReconnect` can say yes or no and nothing about how many.
    reconnect: Option<ReconnectPolicy>,
}

impl MachineBuilder for WatchedMachines {
    fn build(&self, connection: Connection) -> ConnectionMachine {
        ConnectionMachine::new(
            ConnectOptions {
                connection,
                start_api: false,
                skip_availability_check: false,
                origin: None,
            },
            ConnectionContext {
                os: OperatingSystem::Linux,
                arch: "x64".to_string(),
                home: "/home/tester".to_string(),
                user_data_path: "/home/tester/.local/share/container-desktop".to_string(),
                reconnect: self.reconnect.clone(),
                ..ConnectionContext::default()
            },
            ConnectionCapabilities {
                command: Arc::new(FakeCommand::answering(|argv| match argv {
                    ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
                    [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
                    _ => CommandExecutionResult::ok(
                        r#"{"host":{"remoteSocket":{"path":"/run/podman.sock","exists":true}}}"#,
                    ),
                })),
                fs: Arc::new(self.fs.clone()),
                http: Arc::new((self.http)()),
                clock: Arc::new(self.clock.clone()),
            },
        )
    }
}

pub fn watched_server(
    fs: MemoryFs,
    http: impl Fn() -> FakeHttp + Send + Sync + 'static,
    clock: FakeClock,
) -> Server<MemoryFs, WatchedMachines, FakeClock> {
    watched_server_retrying(fs, http, clock, None)
}

/// The same, under a reconnect policy of the caller's choosing — `maxRetries`, most usefully, which
/// is what makes the give-up path reachable without waiting for an unbounded back-off.
pub fn watched_server_retrying(
    fs: MemoryFs,
    http: impl Fn() -> FakeHttp + Send + Sync + 'static,
    clock: FakeClock,
    reconnect: Option<ReconnectPolicy>,
) -> Server<MemoryFs, WatchedMachines, FakeClock> {
    Server::new(
        SettingsStore::new(fs.clone(), SETTINGS, APP_VERSION),
        WatchedMachines {
            fs,
            http: Arc::new(http),
            clock: clock.clone(),
            reconnect,
        },
        clock,
        OperatingSystem::Linux,
    )
}

/// A filesystem where the engine's socket is bound, which is what makes a connection able to be up.
pub fn engine_is_bound() -> MemoryFs {
    let fs = seeded();
    fs.put("/run/podman.sock", "");
    fs
}

/// The same, with [`OTHER_CONNECTION`] stored beside [`CONNECTION`].
///
/// **Derived from [`document`] rather than written out again.** A second literal is a second document
/// to keep in step, and the whole subject of the tests that use this is that the two connections are
/// alike in everything except their id — which a copy would stop being the moment either was edited.
pub fn two_connections_bound() -> MemoryFs {
    let mut document: Value = serde_json::from_str(document()).expect("the fixture is valid JSON");
    let mut other = document["connections"][0].clone();
    other["id"] = json!(OTHER_CONNECTION);
    other["name"] = json!("docker-native");
    document["connections"]
        .as_array_mut()
        .expect("the fixture stores connections")
        .push(other);
    let written = serde_json::to_string_pretty(&document).expect("a document serializes");
    let fs = MemoryFs::seeded(SETTINGS, &written);
    fs.put("/run/podman.sock", "");
    fs
}

/// A document whose SECOND connection is genuinely Docker, and pinned to a context.
///
/// Separate from [`two_connections_bound`], which renames a copy of the podman entry and leaves its
/// `engine`/`host` alone — good enough for the questions about two slots, and useless here: the
/// dialect is composed from those two fields, so that fixture would answer with podman's (absent)
/// notion of a context and the test would pass against nothing.
pub fn docker_connection_pinned() -> MemoryFs {
    let mut document: Value = serde_json::from_str(document()).expect("the fixture is valid JSON");
    let mut other = document["connections"][0].clone();
    other["id"] = json!(OTHER_CONNECTION);
    other["name"] = json!("docker-native");
    other["engine"] = json!("docker");
    other["host"] = json!("docker.native");
    other["settings"]["program"]["name"] = json!("docker");
    other["settings"]["context"] = json!("desktop-linux");
    document["connections"]
        .as_array_mut()
        .expect("the fixture stores connections")
        .push(other);
    let written = serde_json::to_string_pretty(&document).expect("a document serializes");
    let fs = MemoryFs::seeded(SETTINGS, &written);
    fs.put("/run/podman.sock", "");
    fs
}

pub fn proxy(connection: Option<&str>, req: Value) -> Command {
    Command::ProxyRequest {
        payload: Box::new(CommandProxyRequestPayload {
            connection: connection
                .map(|id| json!({ "id": id }).as_object().cloned().expect("an object")),
            req: req.as_object().cloned().expect("a req object"),
        }),
    }
}

/// Every wait in a test is bounded.
///
/// **Not politeness — the lesson of an OOM that took a whole mutation run with it.** An unbounded wait
/// under `cargo mutants` is a mutant that hangs a worker instead of failing it, and every worker shares
/// one cgroup. Five seconds is orders of magnitude more than any of these need on a loopback.
pub const PATIENCE: std::time::Duration = std::time::Duration::from_secs(5);

/// A client of this protocol, as any client is: a WebSocket carrying JSON envelopes.
///
/// It speaks the wire and nothing else — no shortcut into the library — so what these tests prove is
/// what a Go or Rust client written against `protocol.rs` would see.
#[derive(Debug)]
pub struct TestClient<S> {
    socket: tokio_tungstenite::WebSocketStream<S>,
    /// How long any one frame may take. [`PATIENCE`] for a hermetic exchange, longer for a live one — a
    /// real connect spawns an engine service and waits for it to LISTEN, which is seconds rather than
    /// milliseconds, and a constant that covered both would be a constant that catches no hang at all.
    patience: std::time::Duration,
}

impl<S> TestClient<S>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    pub fn new(socket: tokio_tungstenite::WebSocketStream<S>) -> Self {
        Self {
            socket,
            patience: PATIENCE,
        }
    }

    /// Wait longer than a hermetic exchange would. Still BOUNDED — see [`PATIENCE`].
    pub fn with_patience(mut self, patience: std::time::Duration) -> Self {
        self.patience = patience;
        self
    }

    pub async fn send(&mut self, request: &cdc_server::protocol::Request) {
        use futures_util::SinkExt;
        let text = serde_json::to_string(request).expect("a request serializes");
        self.socket
            .send(tokio_tungstenite::tungstenite::Message::text(text))
            .await
            .expect("the request is sent");
    }

    /// Put arbitrary bytes on the wire — what a broken or hostile client does.
    pub async fn send_raw(&mut self, message: tokio_tungstenite::tungstenite::Message) {
        use futures_util::SinkExt;
        self.socket.send(message).await.expect("the frame is sent");
    }

    /// The next frame, parsed as the union the server writes.
    pub async fn next(&mut self) -> cdc_server::protocol::Outbound {
        let text = self.next_text().await.expect("a frame, not a close");
        serde_json::from_str(&text)
            .unwrap_or_else(|error| panic!("a client must be able to parse {text}: {error}"))
    }

    /// The next frame's raw text, or `None` once the server has closed the session.
    pub async fn next_text(&mut self) -> Option<String> {
        use futures_util::StreamExt;
        loop {
            let message = tokio::time::timeout(self.patience, self.socket.next())
                .await
                .expect("the server answers within this client's patience")?;
            match message.expect("a readable frame") {
                tokio_tungstenite::tungstenite::Message::Text(text) => {
                    return Some(text.to_string());
                }
                tokio_tungstenite::tungstenite::Message::Close(_) => return None,
                _ => continue,
            }
        }
    }

    pub async fn next_response(&mut self) -> cdc_server::protocol::Response {
        match self.next().await {
            cdc_server::protocol::Outbound::Answer(response) => response,
            other => panic!("expected a reply, got {other:?}"),
        }
    }

    pub async fn next_push(&mut self) -> cdc_server::protocol::Push {
        match self.next().await {
            cdc_server::protocol::Outbound::Pushed(push) => push,
            other => panic!("expected a push, got {other:?}"),
        }
    }

    /// The next reply, skipping whatever was pushed on the way.
    ///
    /// A client that issues a command genuinely has to do this: progress lines and snapshots arrive
    /// between the request and its answer, and a client that assumed otherwise would deadlock.
    pub async fn reply_to(&mut self, id: &str) -> cdc_server::protocol::Response {
        loop {
            if let cdc_server::protocol::Outbound::Answer(response) = self.next().await {
                assert_eq!(response.id, id, "a reply carries the id it answers");
                return response;
            }
        }
    }
}

/// The reply's payload, or a panic naming the refusal — which is what a failing test wants to read.
pub fn replied(response: cdc_server::protocol::Response) -> cdc_server::protocol::Reply {
    match response.outcome {
        cdc_server::protocol::Outcome::Ok { reply } => reply,
        cdc_server::protocol::Outcome::Err { diagnostic } => panic!("refused: {diagnostic:?}"),
    }
}

/// The refusal, or a panic naming what came back instead.
pub fn refused(
    response: cdc_server::protocol::Response,
) -> cdc_runtime::domain::types::diagnostic::ReportedDiagnostic {
    match response.outcome {
        cdc_server::protocol::Outcome::Err { diagnostic } => *diagnostic,
        cdc_server::protocol::Outcome::Ok { reply } => panic!("expected a refusal, got {reply:?}"),
    }
}

/// A directory under `/tmp`, because a unix socket path is capped near 104 bytes and `cargo mutants`
/// repoints `TMPDIR` deep inside `target/`.
pub fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("cdc-server-")
        .tempdir_in("/tmp")
        .expect("a short temp dir")
}

/// A client on a local socket, through the same handshake a remote client uses.
pub async fn local_client(path: &std::path::Path) -> TestClient<tokio::net::UnixStream> {
    let stream = tokio::net::UnixStream::connect(path)
        .await
        .expect("the socket is being served");
    let (socket, _) = tokio_tungstenite::client_async("ws://localhost/", stream)
        .await
        .expect("the local handshake");
    TestClient::new(socket)
}

/// A client on the remote listener, presenting whatever the caller says it presents.
///
/// **Beside [`local_client`] rather than in the test that first needed it**, because the three of them
/// are one thing said three ways: the transport is the only difference between reaching this protocol
/// on a socket, on a port, and on a port with TLS under it. Keeping them apart is how a change to the
/// handshake ends up made in one of them.
pub async fn remote_client(
    address: std::net::SocketAddr,
    bearer: Option<&str>,
) -> Result<TestClient<tokio::net::TcpStream>, tokio_tungstenite::tungstenite::Error> {
    let stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("the port is being served");
    let (socket, _) =
        tokio_tungstenite::client_async(asked(&format!("ws://{address}/"), bearer), stream).await?;
    Ok(TestClient::new(socket))
}

/// The same, over TLS.
///
/// The TLS failure and the WebSocket one are reported as one type on purpose: what a caller asserts is
/// that it did or did not become a client, and `Io` is how tungstenite already carries everything that
/// went wrong under it.
pub async fn secure_remote_client(
    address: std::net::SocketAddr,
    connector: &tokio_rustls::TlsConnector,
    bearer: Option<&str>,
) -> Result<
    TestClient<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>,
    tokio_tungstenite::tungstenite::Error,
> {
    let stream = tokio::net::TcpStream::connect(address)
        .await
        .expect("the port is being served");
    // The certificate is issued for `localhost` and the connection is to `127.0.0.1`, which is the
    // ordinary case: the NAME is what is verified and the address is only how it was reached.
    let name =
        tokio_rustls::rustls::pki_types::ServerName::try_from("localhost").expect("a server name");
    let secured = connector
        .connect(name, stream)
        .await
        .map_err(tokio_tungstenite::tungstenite::Error::Io)?;
    let (socket, _) =
        tokio_tungstenite::client_async(asked(&format!("wss://{address}/"), bearer), secured)
            .await?;
    Ok(TestClient::new(socket))
}

/// The upgrade request, carrying whatever authorization the caller wants presented.
fn asked(url: &str, bearer: Option<&str>) -> tokio_tungstenite::tungstenite::http::Request<()> {
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    let mut request = url.into_client_request().expect("a client request");
    if let Some(bearer) = bearer {
        request
            .headers_mut()
            .insert("authorization", bearer.parse().expect("a header value"));
    }
    request
}

/// A TLS connector trusting exactly the certificate it is handed, and nothing else.
///
/// **No root programme is consulted.** What the tests assert is that a listener presents THIS
/// certificate, so a store carrying public roots would make "the client trusted it" a weaker claim than
/// it looks — and the realistic deployment is the same shape: a certificate the operator issued, which
/// no root programme has heard of.
pub fn trusting(certificate: &str) -> tokio_rustls::TlsConnector {
    let mut roots = tokio_rustls::rustls::RootCertStore::empty();
    for certificate in rustls_pemfile::certs(&mut std::io::BufReader::new(certificate.as_bytes())) {
        roots
            .add(certificate.expect("a certificate"))
            .expect("a usable trust anchor");
    }
    let provider = Arc::new(tokio_rustls::rustls::crypto::ring::default_provider());
    let config = tokio_rustls::rustls::ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(tokio_rustls::rustls::DEFAULT_VERSIONS)
        .expect("the default protocol versions")
        .with_root_certificates(roots)
        .with_no_client_auth();
    tokio_rustls::TlsConnector::from(Arc::new(config))
}

/// A connected pair over an in-memory duplex: a served socket and a client speaking to it.
///
/// **The handshake is real**, both sides of it, which is what makes this a client rather than a mock —
/// the only thing it does not exercise is the token check, and that needs a listener (see
/// `tests/listen/endpoint.rs`).
pub async fn connected_pair() -> (
    tokio_tungstenite::WebSocketStream<tokio::io::DuplexStream>,
    TestClient<tokio::io::DuplexStream>,
) {
    let (client_io, server_io) = tokio::io::duplex(64 * 1024);
    let (served, client) = tokio::join!(
        tokio_tungstenite::accept_async(server_io),
        tokio_tungstenite::client_async("ws://localhost/", client_io),
    );
    (
        served.expect("the server side of the handshake"),
        TestClient::new(client.expect("the client side of the handshake").0),
    )
}

/// A certificate and its private key, in PEM, made when the test runs.
///
/// **Generated rather than checked into the tree**, and that is not fastidiousness: a PEM in a
/// repository is a PEM with an expiry date on it, and what it produces is a suite that goes red on a
/// day nobody chose, for a reason that looks like a TLS defect and is not one. `rcgen` is a
/// dev-dependency for exactly this.
pub struct Certified {
    pub certificate: String,
    pub key: String,
}

/// One self-signed certificate valid for the names given, and the key that belongs to it.
pub fn certified(names: &[&str]) -> Certified {
    let names: Vec<String> = names.iter().map(|name| (*name).to_string()).collect();
    let generated = rcgen::generate_simple_self_signed(names).expect("a self-signed certificate");
    Certified {
        certificate: generated.cert.pem(),
        key: generated.signing_key.serialize_pem(),
    }
}
