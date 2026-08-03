//! Reaching a server that is really listening, answering to `src/client/dial.rs`.
//!
//! **Real listeners, because the questions here are only real ones.** Whether a token reaches the door,
//! whether a refusal is told apart from an empty address, whether the local socket and the TCP port
//! arrive at the same protocol: a faked socket would answer all three by construction and prove none of
//! them. Everything binds under `/tmp` and on port 0, for the reasons `listen/endpoint.rs` states.

use cdc_client::dial::Wire;
use cdc_client::tls::{ClientTls, Trust};
use cdc_client::{ClientError, Endpoint};
use cdc_server::listen::auth::Token;
use cdc_server::listen::endpoint::Serving;
use cdc_server::listen::session::Shared;
use cdc_server::listen::{Admitted, Listen, Remote};
use secrecy::SecretString;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

use crate::harness::{seeded, server, short_tempdir};

const TOKEN: &str = "a-shared-secret";

/// A server on a local socket, and the endpoint that reaches it.
async fn serving_locally(
    path: &std::path::Path,
    shutdown: &CancellationToken,
) -> tokio::task::JoinHandle<()> {
    let admitted = Admitted::admit(Listen {
        local: Some(path.to_path_buf()),
        remote: None,
    })
    .expect("a local socket is a valid configuration");
    let serving = Serving::bind(Shared::new(server(seeded()), shutdown.clone()), &admitted)
        .await
        .expect("the socket binds");
    tokio::spawn(serving.run())
}

/// A server on a TCP port with a token, and the address the kernel gave it.
async fn serving_remotely(
    shutdown: &CancellationToken,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    let admitted = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: "127.0.0.1:0".parse().expect("an address"),
            token: Token::new(TOKEN),
            tls: None,
        }),
    })
    .expect("a remote listener with a token is admitted");
    let serving = Serving::bind(Shared::new(server(seeded()), shutdown.clone()), &admitted)
        .await
        .expect("the port binds");
    let address = serving.remote_address().expect("the port it actually got");
    (address, tokio::spawn(serving.run()))
}

fn remote_endpoint(address: std::net::SocketAddr, token: &str) -> Endpoint {
    Endpoint::Remote {
        address: address.to_string(),
        token: SecretString::from(token.to_string()),
        tls: None,
    }
}

#[tokio::test]
async fn a_client_on_the_local_socket_is_handed_the_state() {
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let shutdown = CancellationToken::new();
    let accepting = serving_locally(&path, &shutdown).await;

    let mut client = crate::connect(&Endpoint::Local(path))
        .await
        .expect("the socket is being served");

    assert_eq!(client.transport(), "local");
    let snapshot = crate::handed_state(crate::frame(&mut client).await);
    assert_eq!(
        snapshot.connections.len(),
        1,
        "the document this server was pointed at: {snapshot:?}"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn a_client_that_presents_the_token_reaches_the_same_protocol() {
    let shutdown = CancellationToken::new();
    let (address, accepting) = serving_remotely(&shutdown).await;

    let mut client = crate::connect(&remote_endpoint(address, TOKEN))
        .await
        .expect("the token is the one the listener was given");

    assert_eq!(client.transport(), "remote");
    let snapshot = crate::handed_state(crate::frame(&mut client).await);
    assert_eq!(
        snapshot.connections.len(),
        1,
        "the same state a local client is handed: {snapshot:?}"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn a_client_with_the_wrong_token_is_told_it_was_refused() {
    let shutdown = CancellationToken::new();
    let (address, accepting) = serving_remotely(&shutdown).await;

    let refusal = crate::connect(&remote_endpoint(address, "not-the-secret"))
        .await
        .err()
        .expect("a listener with a token refuses one that does not match");

    let ClientError::Unauthorized { endpoint } = refusal else {
        panic!("a refused token is its own answer, not a handshake that went wrong: {refusal:?}");
    };
    assert_eq!(
        endpoint,
        format!("ws://{address}"),
        "and it says where, without saying what was presented"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn nothing_listening_on_a_socket_is_told_apart_from_a_refusal() {
    let directory = short_tempdir();
    let path = directory.path().join("nobody-is-here.sock");

    let refusal = crate::connect(&Endpoint::Local(path.clone()))
        .await
        .err()
        .expect("there is no socket at that path");

    let ClientError::Unreachable { endpoint, .. } = refusal else {
        panic!("an absent server is unreachable, not unauthorized: {refusal:?}");
    };
    assert_eq!(endpoint, format!("unix:{}", path.display()));
}

#[tokio::test]
async fn nothing_listening_on_a_port_is_unreachable() {
    // Bound and then dropped: the port is one nothing is on, without guessing which.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let address = listener.local_addr().expect("its address");
    drop(listener);

    let refusal = crate::connect(&remote_endpoint(address, TOKEN))
        .await
        .err()
        .expect("nothing is listening there");

    assert!(
        matches!(refusal, ClientError::Unreachable { .. }),
        "a closed port is unreachable: {refusal:?}"
    );
}

/// A peer that answers one HTTP status and then keeps the connection open.
///
/// **Held open deliberately**: a peer that hangs up straight away is reported as a broken connection
/// before its status is ever read, which would test the wrong arm entirely.
async fn answering(status: &'static str) -> std::net::SocketAddr {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let address = listener.local_addr().expect("its address");
    tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let _ = stream
                .write_all(format!("HTTP/1.1 {status}\r\ncontent-length: 0\r\n\r\n").as_bytes())
                .await;
            let _ = stream.flush().await;
            tokio::time::sleep(crate::harness::PATIENCE).await;
        }
    });
    address
}

#[tokio::test]
async fn only_a_401_means_the_token_and_every_other_status_means_the_peer() {
    // The distinction this is guarding: a client told "unauthorized" goes and fixes its token, and a
    // client told that for a 403 or a 500 goes and fixes the wrong thing.
    for status in ["403 Forbidden", "500 Internal Server Error"] {
        let refusal = crate::connect(&remote_endpoint(answering(status).await, TOKEN))
            .await
            .err()
            .expect("that is not a websocket server");

        assert!(
            matches!(refusal, ClientError::Handshake { .. }),
            "{status} is a peer that does not speak this, not a refused token: {refusal:?}"
        );
    }
}

#[tokio::test]
async fn a_peer_that_hangs_up_mid_handshake_is_a_handshake_failure() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let address = listener.local_addr().expect("its address");
    tokio::spawn(async move {
        // Accept and go. Nothing is said, which is what a peer speaking something else looks like.
        let _ = listener.accept().await;
    });

    let refusal = crate::connect(&remote_endpoint(address, TOKEN))
        .await
        .err()
        .expect("nothing answered the handshake");

    assert!(
        matches!(refusal, ClientError::Handshake { .. }),
        "a peer that says nothing is a handshake that did not happen: {refusal:?}"
    );
}

#[tokio::test]
async fn a_token_that_cannot_be_a_header_is_refused_before_anything_is_sent() {
    let shutdown = CancellationToken::new();
    let (address, accepting) = serving_remotely(&shutdown).await;

    // A token file read whole, newline and all — the ordinary way this happens.
    let refusal = crate::connect(&remote_endpoint(address, "a-shared-secret\n"))
        .await
        .err()
        .expect("a newline cannot go in a header value");

    assert!(
        matches!(refusal, ClientError::TokenNotPresentable),
        "refused as what it is, rather than sent as half a header: {refusal:?}"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

/// Write down a wire, shut it, and answer with everything the far end read before end-of-file.
///
/// The far end reading EOF at all is the assertion: a `Wire` that answered `Ok` for a shutdown without
/// passing it on would leave a server waiting forever on a client that had already gone. Every arm has
/// to be checked separately — `Wire` is an adapter, and an adapter is exactly the kind of code where
/// one arm quietly does something else.
async fn write_then_shut<R>(mut wire: Wire, reader: R) -> Vec<u8>
where
    R: std::future::Future<Output = Vec<u8>> + Send + 'static,
{
    let reading = tokio::spawn(reader);
    wire.write_all(b"half a message").await.expect("the write");
    wire.shutdown().await.expect("the shutdown");
    tokio::time::timeout(crate::harness::PATIENCE, reading)
        .await
        .expect("the peer reaches end-of-file rather than waiting on a client that is gone")
        .expect("without panicking")
}

async fn read_to_end<S: tokio::io::AsyncRead + Unpin>(mut stream: S) -> Vec<u8> {
    let mut read = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut read)
        .await
        .expect("a readable stream");
    read
}

#[tokio::test]
async fn shutting_a_remote_wire_down_shuts_the_stream_under_it_down() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let address = listener.local_addr().expect("its address");
    let wire = cdc_client::dial::open(&remote_endpoint(address, TOKEN))
        .await
        .expect("the port is being served");

    let read = write_then_shut(wire, async move {
        let (stream, _) = listener.accept().await.expect("the connection");
        read_to_end(stream).await
    })
    .await;

    assert_eq!(read, b"half a message");
}

#[tokio::test]
async fn shutting_a_local_wire_down_shuts_the_stream_under_it_down() {
    let directory = short_tempdir();
    let path = directory.path().join("s.sock");
    let listener = tokio::net::UnixListener::bind(&path).expect("the socket binds");
    let wire = cdc_client::dial::open(&Endpoint::Local(path))
        .await
        .expect("the socket is being served");

    let read = write_then_shut(wire, async move {
        let (stream, _) = listener.accept().await.expect("the connection");
        read_to_end(stream).await
    })
    .await;

    assert_eq!(read, b"half a message");
}

#[tokio::test]
async fn shutting_an_embedded_wire_down_shuts_the_pipe_under_it_down() {
    let (wire, served) = Wire::duplex();

    let read = write_then_shut(wire, read_to_end(served)).await;

    assert_eq!(read, b"half a message");
}

#[tokio::test]
async fn an_address_that_cannot_form_a_url_is_a_handshake_failure_rather_than_a_panic() {
    // `open` refuses this one first in practice — nothing connects to "a b c" — so what is being
    // checked is that the arm behind it is an arm and not an `unwrap`. Which stream it was handed does
    // not matter, because the URL is refused before a byte is written.
    let (wire, _served) = Wire::duplex();
    let endpoint = Endpoint::Remote {
        address: "a b c".to_string(),
        token: SecretString::from(TOKEN.to_string()),
        tls: None,
    };

    let refusal = cdc_client::dial::handshake(&endpoint, wire)
        .await
        .expect_err("that is not a url");

    let ClientError::Handshake { endpoint, .. } = refusal else {
        panic!("a url that will not parse is a handshake failure: {refusal:?}");
    };
    assert_eq!(endpoint, "ws://a b c", "and it says which endpoint it was");
}

#[test]
fn an_endpoint_says_where_it_points_and_what_to_ask_for() {
    let local = Endpoint::Local(std::path::PathBuf::from("/run/cdc/server.sock"));
    let remote = Endpoint::Remote {
        address: "example.test:9000".to_string(),
        token: SecretString::from("unused"),
        tls: None,
    };

    assert_eq!(local.to_string(), "unix:/run/cdc/server.sock");
    assert_eq!(remote.to_string(), "ws://example.test:9000");
    // **A LOCAL ENDPOINT ON WINDOWS IS A PIPE, AND SAYING `unix:` THERE IS A LIE A PERSON READS.**
    // Found by running this terminal on win11 for the first time: the chrome read
    // `unix:\\.\pipe\cdc-server`. The scheme is decided by the ADDRESS rather than by the target,
    // so it is one rule, portable, and checkable from here.
    assert_eq!(
        Endpoint::Local(std::path::PathBuf::from(r"\\.\pipe\cdc-server")).to_string(),
        r"pipe:\\.\pipe\cdc-server"
    );
    // The local socket's authority was already settled by dialling the path, so it asks for the same
    // `localhost` every other client of this protocol asks for — including the server's own tests.
    assert_eq!(local.url(), "ws://localhost/");
    assert_eq!(remote.url(), "ws://example.test:9000/");
}

#[tokio::test]
async fn every_transport_names_itself() {
    let (embedded, _served) = Wire::duplex();

    assert_eq!(embedded.transport(), "embedded");
    // The other two are named by the clients that dial them, above — a `Wire` cannot be built for
    // either without something on the far end.
}

/// A server on a TCP port serving a certificate, and the material a client needs to trust it.
async fn serving_securely(
    shutdown: &CancellationToken,
) -> (
    std::net::SocketAddr,
    crate::harness::Certified,
    tokio::task::JoinHandle<()>,
) {
    let material = crate::harness::certified(&["localhost"]);
    let tls = cdc_server::listen::tls::ServerTls::from_pem(
        material.certificate.as_bytes(),
        material.key.as_bytes(),
    )
    .expect("a certificate and its own key");
    let admitted = Admitted::admit(Listen {
        local: None,
        remote: Some(Remote {
            address: "127.0.0.1:0".parse().expect("an address"),
            token: Token::new(TOKEN),
            tls: Some(tls),
        }),
    })
    .expect("a remote listener with a token is admitted");
    let serving = Serving::bind(Shared::new(server(seeded()), shutdown.clone()), &admitted)
        .await
        .expect("the port binds");
    let address = serving.remote_address().expect("the port it actually got");
    (address, material, tokio::spawn(serving.run()))
}

/// An endpoint reaching that port over TLS, trusting exactly what it is handed.
///
/// **`localhost:<port>` rather than the address the listener reported**, because a certificate is
/// issued for a NAME and `127.0.0.1` is not the one in it. That is the shape a real invocation has too:
/// `--remote engine.example:9091` verifies the name, however DNS resolved it.
fn secure_endpoint(address: std::net::SocketAddr, token: &str, trusting: &str) -> Endpoint {
    Endpoint::Remote {
        address: format!("localhost:{}", address.port()),
        token: SecretString::from(token.to_string()),
        tls: Some(
            ClientTls::new(
                &format!("localhost:{}", address.port()),
                &Trust::Pem(trusting.as_bytes().to_vec()),
            )
            .expect("a name and a certificate to trust"),
        ),
    }
}

#[tokio::test]
async fn a_client_over_wss_reaches_the_same_protocol() {
    // The claim `wss://` is for, from the client's end: the same first frame and the same state a
    // plaintext client is handed, because TLS is a layer under the stream and nothing above `Wire`
    // knows it is there. It does NOT make the flush delegation load-bearing, though the sentence that
    // used to sit here said so: a socket with room in it takes every byte inside `poll_write`, so
    // nothing is left for a flush to push and a flush that did nothing would pass this unchanged. What
    // discriminates is `a_secure_wire_flushes_the_ciphertext_its_socket_would_not_take`, below.
    let shutdown = CancellationToken::new();
    let (address, material, accepting) = serving_securely(&shutdown).await;

    let mut client = crate::connect(&secure_endpoint(address, TOKEN, &material.certificate))
        .await
        .expect("the certificate is trusted and the token is right");

    assert_eq!(
        client.transport(),
        "remote+tls",
        "and a person is told both things about their own session"
    );
    let snapshot = crate::handed_state(crate::frame(&mut client).await);
    assert_eq!(
        snapshot.connections.len(),
        1,
        "the same state a plaintext client is handed: {snapshot:?}"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn a_command_and_its_reply_cross_the_encrypted_wire() {
    // A round trip rather than an arrival, and the difference is what it exercises: sending is the half
    // that has to push ciphertext OUT, so a `Wire` that answered `Ok` for a write or a flush without
    // passing it on would be a client whose commands are never asked.
    let shutdown = CancellationToken::new();
    let (address, material, accepting) = serving_securely(&shutdown).await;
    let mut client = crate::connect(&secure_endpoint(address, TOKEN, &material.certificate))
        .await
        .expect("attached");
    crate::frame(&mut client).await;

    let id = client
        .send(cdc_server::protocol::Command::ListConnections)
        .await
        .expect("the frame is sent");
    let response = crate::reply_to(&mut client, &id).await;

    assert_eq!(response.id, id, "the answer to the command that was asked");
    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn a_certificate_this_client_will_not_trust_is_told_apart_from_an_absent_server() {
    // The distinction this variant exists for, and it is the same shape as `Unauthorized` against
    // `Unreachable`: one is a server to go and start, the other is a certificate to go and fix.
    // Reporting the second as the first sends somebody looking for a process that is running fine.
    let shutdown = CancellationToken::new();
    let (address, _material, accepting) = serving_securely(&shutdown).await;
    let stranger = crate::harness::certified(&["localhost"]);

    let refusal = crate::connect(&secure_endpoint(address, TOKEN, &stranger.certificate))
        .await
        .err()
        .expect("that is not the certificate this server serves");

    let ClientError::Untrusted { endpoint, .. } = refusal else {
        panic!("an untrusted certificate is its own answer: {refusal:?}");
    };
    assert_eq!(
        endpoint,
        format!("wss://localhost:{}", address.port()),
        "and it says where, in the scheme it was actually speaking"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn a_plaintext_client_cannot_reach_a_wss_listener() {
    // The other direction of the same wrap: a `ws://` client sends an HTTP request where a ClientHello
    // belongs. It must not become a client, and it must not be reported as a token problem.
    let shutdown = CancellationToken::new();
    let (address, _material, accepting) = serving_securely(&shutdown).await;

    let refusal = crate::connect(&remote_endpoint(address, TOKEN))
        .await
        .err()
        .expect("this listener speaks TLS");

    assert!(
        !matches!(refusal, ClientError::Unauthorized { .. }),
        "the token was never the problem: {refusal:?}"
    );

    shutdown.cancel();
    accepting.await.expect("a graceful shutdown");
}

#[tokio::test]
async fn shutting_a_secure_wire_down_shuts_the_stream_under_it_down() {
    // The fourth arm of the adapter, held to the same standard as the other three: `Wire` is exactly the
    // kind of code where one arm quietly does something else, and the `Secure` one reaches its stream
    // through a `Box`. **Against a bare TLS server rather than a `cdc-server`**, the way the other three
    // are against bare listeners — what is under test is the stream, not the protocol over it.
    //
    // It also asserts something the plaintext arms cannot: rustls reports an abrupt close as an ERROR,
    // so a `poll_shutdown` that answered `Ok` without sending `close_notify` fails this read rather than
    // quietly reaching end-of-file.
    let material = crate::harness::certified(&["localhost"]);
    let acceptor = cdc_server::listen::tls::ServerTls::from_pem(
        material.certificate.as_bytes(),
        material.key.as_bytes(),
    )
    .expect("a certificate and its own key")
    .acceptor();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a port");
    let address = listener.local_addr().expect("its address");
    let endpoint = secure_endpoint(address, TOKEN, &material.certificate);
    // Both halves at once: the TLS handshake needs the far end accepting while this one connects.
    let (opened, served) = tokio::join!(cdc_client::dial::open(&endpoint), async {
        let (stream, _) = listener.accept().await.expect("the connection");
        acceptor.accept(stream).await.expect("the TLS handshake")
    });
    let wire = opened.expect("the port is being served");

    let read = write_then_shut(wire, read_to_end(served)).await;

    assert_eq!(read, b"half a message");
}

/// A socket buffer small enough that a write can outrun it.
///
/// **Set on the socket before it is connected, and on BOTH ends**, because that is the only lever that
/// works here — this is written down because three other arrangements were tried first. A megabyte
/// written to a peer that is not reading vanishes into a send buffer that auto-tunes to four; bounding
/// only the RECEIVER changes nothing, because the sender's own buffer still takes everything; and
/// twenty-four megabytes does leave a tail but takes long enough that the failure it produces is a
/// timeout rather than an assertion. Setting `SO_SNDBUF` or `SO_RCVBUF` explicitly turns auto-tuning
/// off, and the kernel doubles what it is given, so this is the real bound within a factor of two.
const A_BOUNDED_SOCKET_BUFFER: u32 = 16 * 1024;

/// Where the fill loop gives up.
///
/// Past this the ARRANGEMENT has failed rather than the code — with both buffers bounded, a write blocks
/// inside a few hundred kilobytes. A loop with no ceiling is a test that hangs a mutation worker instead
/// of failing it, which is the trap this tree has now paid for five units running.
const MORE_THAN_A_BOUNDED_SOCKET_CAN_HOLD: usize = 4 * 1024 * 1024;

/// A TCP listener whose accepted sockets cannot absorb everything written to them.
///
/// The bound is set on the LISTENER because an accepted socket inherits it, and tokio offers no way to
/// set it afterwards.
fn bounded_listener() -> tokio::net::TcpListener {
    let socket = tokio::net::TcpSocket::new_v4().expect("a socket");
    socket
        .set_recv_buffer_size(A_BOUNDED_SOCKET_BUFFER)
        .expect("a bounded receive buffer");
    socket
        .bind("127.0.0.1:0".parse().expect("an address"))
        .expect("the bind");
    socket.listen(1).expect("the listen")
}

/// Read exactly this many bytes, or panic saying how far it got.
async fn read_exactly<S: tokio::io::AsyncRead + Unpin>(mut stream: S, count: usize) -> usize {
    let mut arrived = vec![0u8; count];
    tokio::io::AsyncReadExt::read_exact(&mut stream, &mut arrived)
        .await
        .expect("the peer receives every byte that was written to it")
}

#[tokio::test]
async fn a_secure_wire_flushes_the_ciphertext_its_socket_would_not_take() {
    // **The one arrangement that can tell `Wire`'s flush from a no-op**, and it exists because the
    // delegation used to be neither. Three of the four streams under this enum hold no buffer of their
    // own — a `TcpStream`, a `UnixStream` and a `DuplexStream` all answer `Ok(())` — so a `poll_flush`
    // that did nothing was the same behaviour, and it was excluded from the mutation gate as equivalent
    // on exactly that reasoning. `Wire::Secure` falsified it: a rustls session holds the ciphertext a
    // full socket would not take, and flushing is the only thing that pushes it. A client whose last
    // frame stayed in that buffer is a client whose command is never asked, and no other test here can
    // see it, because a socket that never fills never leaves anything behind to push.
    let material = crate::harness::certified(&["localhost"]);
    let acceptor = cdc_server::listen::tls::ServerTls::from_pem(
        material.certificate.as_bytes(),
        material.key.as_bytes(),
    )
    .expect("a certificate and its own key")
    .acceptor();
    let listener = bounded_listener();
    let address = listener.local_addr().expect("its address");
    let dialling = tokio::net::TcpSocket::new_v4().expect("a socket");
    dialling
        .set_send_buffer_size(A_BOUNDED_SOCKET_BUFFER)
        .expect("a bounded send buffer");
    // The trust decision is the production one; only the SOCKET is this test's. Both halves at once, or
    // neither completes: a TLS handshake needs the far end accepting while this one connects.
    let trust = ClientTls::new(
        &format!("localhost:{}", address.port()),
        &Trust::Pem(material.certificate.clone().into_bytes()),
    )
    .expect("a name and a certificate to trust");
    let (secured, served) = tokio::join!(
        async {
            let stream = dialling.connect(address).await.expect("the port answers");
            trust
                .connector()
                .connect(trust.name(), stream)
                .await
                .expect("the TLS handshake")
        },
        async {
            let (stream, _) = listener.accept().await.expect("the connection");
            acceptor.accept(stream).await.expect("the TLS handshake")
        }
    );
    let mut wire = Wire::Secure(Box::new(secured));

    // Write until the socket refuses. `Pending` IS the state this needs: the send buffer is full and
    // rustls is holding ciphertext it could not push, which is the only state in which flushing does
    // anything observable. Nothing is reading yet, so nothing drains while this runs.
    let chunk = vec![b'x'; 16 * 1024];
    let mut sent = 0usize;
    let mut blocked = false;
    std::future::poll_fn(|context| {
        while !blocked && sent < MORE_THAN_A_BOUNDED_SOCKET_CAN_HOLD {
            match std::pin::Pin::new(&mut wire).poll_write(context, &chunk) {
                std::task::Poll::Ready(Ok(0)) | std::task::Poll::Pending => blocked = true,
                std::task::Poll::Ready(Ok(written)) => sent += written,
                std::task::Poll::Ready(Err(error)) => return std::task::Poll::Ready(Err(error)),
            }
        }
        std::task::Poll::Ready(Ok(()))
    })
    .await
    .expect("a write is taken or refused, never failed");
    assert!(
        blocked,
        "the socket buffers were not the bound this test needs: {sent} bytes went in without one refusing"
    );
    // Only now does the peer read, so what reaches it after this point is what the flush pushed.
    let reading = tokio::spawn(read_exactly(served, sent));

    tokio::time::timeout(crate::harness::PATIENCE, wire.flush())
        .await
        .expect("a flush against a peer that is draining completes")
        .expect("the flush");

    let read = tokio::time::timeout(crate::harness::PATIENCE, reading)
        .await
        .expect("every byte written arrives once it has been flushed, and the tail only then")
        .expect("without panicking");
    assert_eq!(
        read, sent,
        "the whole of what was written, including the part no `poll_write` could push"
    );
}

#[test]
fn an_endpoint_over_tls_says_so_in_its_scheme() {
    // A person reading a status bar has to be able to tell the two apart without remembering which
    // flags they typed, so the scheme follows the transport rather than being decoration.
    let secured = Endpoint::Remote {
        address: "example.test:9000".to_string(),
        token: SecretString::from("unused"),
        tls: Some(
            ClientTls::new("example.test:9000", &Trust::Roots).expect("a name and the roots"),
        ),
    };

    assert_eq!(secured.to_string(), "wss://example.test:9000");
    assert_eq!(secured.url(), "wss://example.test:9000/");
}
