//! The sockets, bound for real.
//!
//! **Real listeners, real clients, real handshakes.** A faked socket would be a test of the fake: what has
//! to be true here is that a client on a Unix socket and a client on a TCP port reach the SAME protocol,
//! that the token is at the door of one and not the other, and that a socket file left by a crash does not
//! stop the next start. None of that is checkable without binding something.
//!
//! Everything binds under `/tmp` and on port 0. Not habit: a unix socket path is capped near 104 bytes and
//! `cargo mutants` repoints `TMPDIR` deep inside `target/`, and a fixed port collides with whatever the
//! machine is already running.
//!
//! What is HERE is the socket's own life — bound, described, and let go of. What an accepted socket
//! becomes is [`attaching`], split off at the 620-line cap along the seam the source has.

mod attaching;

use std::sync::Arc;

use cdc_server::listen::auth::Token;
use cdc_server::listen::endpoint::{BindError, Serving, accepted};
use cdc_server::listen::session::Shared;
use cdc_server::listen::tls::ServerTls;
use cdc_server::listen::{Admitted, Listen, Remote};
use cdc_server::protocol::{Command, Request};
use tokio_util::sync::CancellationToken;

use crate::harness::{
    CONNECTION, Certified, PATIENCE, certified, engine_is_bound, local_client, replied,
    running_server, seeded, server, short_tempdir,
};

fn local_only(path: &std::path::Path) -> Admitted {
    Admitted::admit(Listen {
        local: Some(path.to_path_buf()),
        remote: None,
    })
    .expect("a local socket is a valid configuration")
}

fn remote_only(token: &str) -> Admitted {
    remote_with(token, None)
}

fn remote_with(token: &str, tls: Option<ServerTls>) -> Admitted {
    Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            // Port 0: the kernel picks, and `Serving::remote_address` says which.
            address: "127.0.0.1:0".parse().expect("an address"),
            token: Token::new(token),
            tls,
        }),
    })
    .expect("a remote listener with a token is admitted")
}

/// A listener serving the certificate returned beside it.
fn secured(token: &str) -> (Admitted, Certified) {
    let material = certified(&["localhost"]);
    let tls = ServerTls::from_pem(material.certificate.as_bytes(), material.key.as_bytes())
        .expect("a certificate and its own key");
    (remote_with(token, Some(tls)), material)
}

/// What was traced, for the arms whose whole observable effect is a log line.
///
/// **Thread-local, through `set_default`**, which is what makes it usable in a suite that runs tests
/// in parallel — a global subscriber can be installed once per process and every other test would
/// then be writing into whichever one won. `#[tokio::test]` drives its tasks on the thread that
/// installed this, so a line traced inside a spawned task is captured with the rest.
#[derive(Clone, Default)]
struct CapturedLog(Arc<std::sync::Mutex<Vec<u8>>>);

impl CapturedLog {
    fn subscriber(&self) -> impl tracing::Subscriber + use<> {
        tracing_subscriber::fmt()
            .with_writer(self.clone())
            .with_max_level(tracing::Level::TRACE)
            .finish()
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().expect("the log buffer")).into_owned()
    }
}

impl std::io::Write for CapturedLog {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .expect("the log buffer")
            .extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLog {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[tokio::test]
async fn the_local_socket_is_readable_only_by_its_owner() {
    // This IS the local listener's access control: there is no token on that path, so the mode
    // is the whole of it. `0o600` rather than `0o660`, because a group-writable socket grants full
    // container-engine control to every member of the owner's primary group.
    use std::os::unix::fs::PermissionsExt;
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let serving = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &local_only(&path),
    )
    .await
    .expect("the socket binds");

    let mode = std::fs::metadata(&path)
        .expect("the socket file")
        .permissions()
        .mode();

    assert_eq!(mode & 0o777, 0o600, "mode was {:o}", mode & 0o777);
    drop(serving);
}

#[tokio::test]
async fn a_socket_file_no_server_is_behind_is_replaced() {
    // What a crash leaves. Fatal here would mean a server that cannot restart without someone deleting a
    // file by hand — and the file looks identical to one a live server is using.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let abandoned = tokio::net::UnixListener::bind(&path).expect("bound once");
    drop(abandoned);
    assert!(path.exists(), "dropping a listener leaves the file behind");

    let serving = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &local_only(&path),
    )
    .await;

    assert!(
        serving.is_ok(),
        "a stale socket is replaced, not fatal: {:?}",
        serving.err()
    );
}

#[tokio::test]
async fn a_socket_another_server_is_serving_is_never_taken_over() {
    // The other half of the same rule, and the dangerous one: unlinking a socket a live server is behind
    // takes it offline while it still believes it is up. Only a connection attempt tells the two apart.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let first = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &local_only(&path),
    )
    .await
    .expect("the first binds");
    let accepting = tokio::spawn(first.run());

    let second = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &local_only(&path),
    )
    .await;

    match second {
        Err(BindError::LocalInUse { path: refused }) => assert_eq!(refused, path),
        other => panic!("a live socket must be refused, got {other:?}"),
    }
    shutdown.cancel();
    let _ = tokio::time::timeout(PATIENCE, accepting).await;
}

#[tokio::test]
async fn a_local_path_that_cannot_be_bound_is_named_in_the_refusal() {
    let path = std::path::Path::new("/proc/cdc-server-cannot-live-here/s.sock");

    let refusal = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &local_only(path),
    )
    .await
    .expect_err("/proc is not writable");

    assert!(
        matches!(refusal, BindError::Local { .. }),
        "got {refusal:?}"
    );
    assert!(
        refusal.to_string().contains("cdc-server-cannot-live-here"),
        "the refusal names the path: {refusal}"
    );
}

#[tokio::test]
async fn shutting_down_removes_the_socket_it_bound() {
    // So the next start has nothing to decide about. A server that left its socket behind would make the
    // stale-file path the normal one, and the normal path is the one that must be boring.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let serving = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &local_only(&path),
    )
    .await
    .expect("bound");
    let accepting = tokio::spawn(serving.run());
    // Attached, so the shutdown has a session to unwind rather than an empty roster.
    let _client = local_client(&path).await;

    shutdown.cancel();
    tokio::time::timeout(PATIENCE, accepting)
        .await
        .expect("the run ends")
        .expect("without panicking");

    assert!(!path.exists(), "the socket file is gone");
}

#[tokio::test]
async fn a_socket_file_that_cannot_be_removed_is_logged_and_never_fatal() {
    // The other half of the test above, and the half a shutdown depends on: the process is already
    // going, so a socket file something else got to first must not turn a clean stop into a panic in a
    // spawned task — where it would be a shutdown that never finishes rather than an error anyone reads.
    // A tmpfs cleanup, a `rm` and this test's own hand all produce the same missing file.
    let captured = CapturedLog::default();
    let guard = tracing::subscriber::set_default(captured.subscriber());
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let serving = Serving::bind(
        Shared::new(server(seeded()), shutdown.clone()),
        &local_only(&path),
    )
    .await
    .expect("bound");
    let accepting = tokio::spawn(serving.run());
    let _client = local_client(&path).await;

    std::fs::remove_file(&path).expect("something else takes the socket away first");
    shutdown.cancel();
    tokio::time::timeout(PATIENCE, accepting)
        .await
        .expect("the run still ends")
        .expect("without panicking");

    drop(guard);
    let log = captured.text();
    assert!(
        log.contains("the socket file could not be removed"),
        "the failure is not swallowed: {log}"
    );
    assert!(
        log.contains("s.sock"),
        "and it names the path, which is the whole of what an operator can act on: {log}"
    );
}

#[tokio::test]
async fn shutting_down_takes_every_connection_with_it() {
    // The reason it matters: each machine's own teardown is what stops its
    // services, so a shutdown that skipped it would leave an `ssh -NL` reparented to init with no handle
    // anywhere.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let shared = Shared::new(running_server(engine_is_bound()), shutdown.clone());
    let serving = Serving::bind(Arc::clone(&shared), &local_only(&path))
        .await
        .expect("bound");
    let accepting = tokio::spawn(serving.run());
    let mut client = local_client(&path).await;
    client.next().await;
    client
        .send(&Request::new(
            "1",
            Command::Connect {
                connection_id: CONNECTION.to_string(),
                origin: cdc_runtime::domain::types::resource_sync_protocol::ConnectOrigin::User,
            },
        ))
        .await;
    replied(client.reply_to("1").await);
    assert!(
        shared.server.snapshot().expect("readable").active.is_some(),
        "the connection is up before the shutdown"
    );

    shutdown.cancel();
    tokio::time::timeout(PATIENCE, accepting)
        .await
        .expect("the run ends")
        .expect("without panicking");

    let after = shared.server.snapshot().expect("readable");
    assert!(
        after.active.is_none(),
        "and every connection is down afterwards: {after:?}"
    );
}

#[tokio::test]
async fn a_remote_address_that_cannot_be_bound_is_named_in_the_refusal() {
    let taken = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port to squat on");
    let address = taken.local_addr().expect("its address");

    let refusal = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &Admitted::admit(Listen {
            local: None,
            remote: Some(Remote {
                address,
                token: Token::new("s3cret"),
                tls: None,
            }),
        })
        .expect("admitted"),
    )
    .await
    .expect_err("that port is taken");

    assert!(
        matches!(refusal, BindError::Remote { .. }),
        "got {refusal:?}"
    );
    assert!(
        refusal.to_string().contains(&address.to_string()),
        "the refusal names the address: {refusal}"
    );
}

#[tokio::test]
async fn a_bound_server_says_which_listeners_it_has() {
    // What a failing assertion — or an operator reading a log — needs from it: which of the two it got,
    // and for a remote one the address the kernel actually chose.
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let serving = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &local_only(&path),
    )
    .await
    .expect("bound");

    let described = format!("{serving:?}");

    assert!(described.contains("s.sock"), "got {described}");
    assert!(
        described.contains("remote: None"),
        "and it says the remote listener is off: {described}"
    );
}

#[tokio::test]
async fn a_path_a_socket_cannot_have_is_refused_with_its_own_reason() {
    // The other side of the stale-socket decision, and the one a weaker assertion misses: only
    // `AddrInUse` means "something is already there". Anything else must be reported AS ITSELF — a bind
    // failure investigated as though it were stale comes back carrying whatever the investigation failed
    // on, which is a reason about the wrong thing.
    let directory = short_tempdir();
    // A unix socket address is capped near 104 bytes, so this one cannot be bound at all.
    let path = directory.path().join("x".repeat(200));

    let refusal = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &local_only(&path),
    )
    .await
    .expect_err("no socket can have that address");

    let BindError::Local { source, .. } = &refusal else {
        panic!("got {refusal:?}");
    };
    assert_eq!(
        source.kind(),
        std::io::ErrorKind::InvalidInput,
        "the reason is the bind's own, not a stale-socket investigation's: {source:?}"
    );
}

#[test]
fn only_an_address_already_in_use_is_worth_investigating() {
    use cdc_server::listen::endpoint::is_address_taken;

    assert!(is_address_taken(&std::io::Error::from(
        std::io::ErrorKind::AddrInUse
    )));
    assert!(!is_address_taken(&std::io::Error::from(
        std::io::ErrorKind::PermissionDenied
    )));
    assert!(!is_address_taken(&std::io::Error::from(
        std::io::ErrorKind::InvalidInput
    )));
}

#[test]
fn a_client_that_could_not_be_accepted_is_logged_and_the_listener_goes_round_again() {
    // The same rule `is_address_taken` above is here for: nothing a test can do to a bound listener
    // makes `accept` fail, so leaving this decision inside the loop leaves it where no gate on this
    // machine can execute it. What it decides is worth executing — a per-accept failure is ONE client
    // whose connection died between the kernel accepting it and this reading it, and ending the
    // listener over that would take a server down on behalf of everyone it was serving.
    let captured = CapturedLog::default();
    let guard = tracing::subscriber::set_default(captured.subscriber());

    let refused = accepted::<u8>(
        Err(std::io::Error::from(std::io::ErrorKind::ConnectionAborted)),
        "local",
    );
    let served = accepted(Ok(7u8), "local");

    drop(guard);
    assert_eq!(refused, None, "a failure is not a client");
    assert_eq!(
        served,
        Some(7),
        "and an accepted socket is handed straight on"
    );
    let log = captured.text();
    assert!(
        log.contains("could not be accepted") && log.contains("local"),
        "the failure names itself and which listener it was: {log}"
    );
    assert_eq!(
        log.lines().count(),
        1,
        "and the accepted one says NOTHING — a line per client is a log nobody reads: {log}"
    );
}

#[tokio::test]
async fn a_bound_server_says_whether_its_remote_listener_is_encrypted() {
    // An address cannot answer it, and it is the one thing about a remote listener that changes what an
    // operator should do next.
    let (admitted, _material) = secured("s3cret");
    let secure = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &admitted,
    )
    .await
    .expect("bound");
    let plain = Serving::bind(
        Shared::new(server(seeded()), CancellationToken::new()),
        &remote_only("s3cret"),
    )
    .await
    .expect("bound");

    assert!(
        format!("{secure:?}").contains("remote_tls: Some(true)"),
        "got {secure:?}"
    );
    assert!(
        format!("{plain:?}").contains("remote_tls: Some(false)"),
        "and a plaintext listener says so rather than saying nothing: {plain:?}"
    );
}
