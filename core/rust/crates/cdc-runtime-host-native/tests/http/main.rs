//! One HTTP/1.1 exchange over a real socket (`src/http.rs`).
//!
//! The capability's whole job is to answer "is the engine serving", so what has to be pinned is the
//! difference between the answers it can give: a listener that replies, a path with nothing behind
//! it, a peer that hangs up without replying, and a transport this host does not speak. The engine's
//! own semantics are not here — `2xx` versus a body of `OK` is
//! [`cdc_runtime::capabilities::http::HttpResponse::ok`]'s, and the connection's verdict is the
//! machine's.
//!
//! The listener is a real `UnixListener` writing a canned reply, which is what makes this a test of
//! the wire format rather than of a mock's agreement with itself.

use std::path::Path;
use std::time::Duration;

use cdc_runtime::capabilities::http::{Endpoint, Http, HttpError, HttpRequest};
use cdc_runtime_host_native::http::TokioHttp;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// How long a test will wait for one piece of a stream before calling it stuck. See [`drain`].
const STREAM_DEADLINE: std::time::Duration = std::time::Duration::from_secs(2);

/// One piece of a stream as TEXT, or a failure — never an indefinite wait. See [`drain`] for the clock.
///
/// The carrier answers bytes; every test in this file but [`framing`] is about a text body, so the
/// decode is here rather than at each assertion.
async fn next_bounded(
    open: &mut cdc_runtime::capabilities::http::HttpStreamOpen,
) -> Option<String> {
    tokio::time::timeout(STREAM_DEADLINE, open.body.next_chunk())
        .await
        .expect("the stream neither delivered nor ended")
        .expect("a healthy stream")
        .map(|chunk| String::from_utf8_lossy(&chunk).into_owned())
}

/// Serve exactly one connection, reply with `raw`, and hand back what the request looked like.
///
/// The request is returned rather than asserted here so each test states its own expectation, and the
/// task is detached: nothing else may await it, or a test that fails would hang instead of failing.
fn serve_once(socket: &Path, raw: &'static str) -> tokio::sync::oneshot::Receiver<String> {
    let listener = tokio::net::UnixListener::bind(socket).expect("bind the test socket");
    let (sender, receiver) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        // Read only what is there: the client sends `Connection: close` but does not close its own
        // half, so reading to end would deadlock against a client waiting for this reply.
        let mut buffer = vec![0_u8; 1024];
        let read = stream.read(&mut buffer).await.unwrap_or(0);
        let _ = sender.send(String::from_utf8_lossy(&buffer[..read]).into_owned());
        let _ = stream.write_all(raw.as_bytes()).await;
        let _ = stream.flush().await;
    });
    receiver
}

/// A temp directory SHORT enough to hold a bindable socket.
///
/// Not `tempfile::tempdir()`: that honours `TMPDIR`, and `make mutation` repoints it into
/// `core/rust/target/mutants/tmp/` — a prefix over 100 characters on its own. **A unix socket path is
/// capped near 104 bytes**, so the bind fails there while passing under a plain `cargo test`, which is
/// a test that only breaks inside a gate. `/tmp` directly keeps it inside the cap wherever it runs.
fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("cdc-http-")
        .tempdir_in("/tmp")
        .expect("temp dir")
}

fn socket_in(directory: &tempfile::TempDir) -> std::path::PathBuf {
    directory.path().join("e.sock")
}

#[tokio::test]
async fn a_listener_that_answers_gives_back_its_status_and_body() {
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nOK",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 200);
    assert_eq!(response.body, "OK", "everything after the blank line");
    let request = asked.await.expect("the listener recorded the request");
    assert!(
        request.starts_with("GET /_ping HTTP/1.1\r\n"),
        "the readiness route, on the wire: {request:?}"
    );
    assert!(
        request.contains("Host: d\r\n"),
        "HTTP/1.1 requires a Host and a unix socket has no name: {request:?}"
    );
    assert!(
        request.contains("Connection: close\r\n"),
        "end-of-stream is what makes the body readable without framing: {request:?}"
    );
}

#[tokio::test]
async fn a_status_that_is_not_200_is_still_an_answer() {
    // Podman replies `204` to routes the oracle is happy with. Whether that counts as serving is
    // `HttpResponse::ok`'s decision, not this layer's — here it must simply survive parsing.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "HTTP/1.1 204 No Content\r\n\r\n");

    let response = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 204);
    assert!(response.body.is_empty());
    assert!(response.ok(), "2xx is serving");
}

#[tokio::test]
async fn a_body_is_sent_with_its_length() {
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let asked = serve_once(&socket, "HTTP/1.1 200 OK\r\n\r\n{}");

    let response = TokioHttp
        .request(&HttpRequest {
            endpoint: Endpoint::UnixSocket(socket.to_string_lossy().into_owned()),
            method: "POST".to_string(),
            path: "/containers/create".to_string(),
            headers: Vec::new(),
            body: Some(r#"{"Image":"alpine"}"#.to_string()),
            timeout: None,
        })
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 200);
    let request = asked.await.expect("the listener recorded the request");
    assert!(
        request.starts_with("POST /containers/create HTTP/1.1\r\n"),
        "{request:?}"
    );
    assert!(
        request.contains("Content-Length: 18\r\n"),
        "the byte count, not the character count: {request:?}"
    );
    assert!(
        request.ends_with("\r\n\r\n{\"Image\":\"alpine\"}"),
        "the body follows the blank line and nothing follows the body: {request:?}"
    );
}

#[tokio::test]
async fn a_path_with_nothing_behind_it_is_unreachable() {
    // The false-ready case, at the capability's own level: the address is perfectly well-formed and
    // there is no listener. Nothing is bound, so this is what a stale forward socket produces too.
    let directory = short_tempdir();
    let socket = socket_in(&directory);

    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect_err("nothing is listening");

    assert!(
        matches!(error, HttpError::Unreachable { .. }),
        "not reachable, and not a malformed reply: {error:?}"
    );
}

#[tokio::test]
async fn a_file_that_is_not_a_socket_is_unreachable_rather_than_a_panic() {
    // What `a_service_that_cannot_be_spawned_at_all…` walks into: the settings name a path that
    // exists and is a regular file, so the presence check passes and the connect cannot.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    std::fs::write(&socket, "not a socket").expect("write the file");

    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect_err("a regular file cannot be connected to");

    assert!(matches!(error, HttpError::Unreachable { .. }), "{error:?}");
}

#[tokio::test]
async fn a_peer_that_hangs_up_without_replying_is_malformed_not_unreachable() {
    // The connection WAS made, which is the difference that matters: the address is right and the
    // thing behind it is not speaking HTTP. Naming it "unreachable" would send someone to check a
    // path that is already correct.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "");

    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect_err("no status line came back");

    match error {
        HttpError::Malformed { reason, .. } => {
            assert!(reason.contains("closed without a reply"), "{reason}");
        }
        other => panic!("expected a malformed reply, got {other:?}"),
    }
}

#[tokio::test]
async fn a_reply_that_is_not_http_is_malformed() {
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "SSH-2.0-OpenSSH_9.6\r\n");

    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect_err("that is not a status line");

    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

/// The one Windows rule that is portable code, and the reason it is.
///
/// A pipe whose instances are all taken is a HEALTHY engine under load. Reading that as "unreachable"
/// reports it down — the same false negative `is_file_present` used to produce by deciding presence
/// with an open. Only Windows raises os error 231, but the DECISION is compiled everywhere on purpose:
/// behind a `cfg(windows)`, `cargo mutants` would report every mutant of it MISSED (nothing here
/// compiles the block), so `==` could become `!=` and no gate would notice.
#[test]
fn only_a_busy_pipe_is_worth_waiting_for() {
    use cdc_runtime_host_native::http::is_pipe_busy;

    assert!(
        is_pipe_busy(&std::io::Error::from_raw_os_error(231)),
        "ERROR_PIPE_BUSY — the engine is there, every instance is taken"
    );
    for other in [2, 231 + 1, 231 - 1, 5] {
        assert!(
            !is_pipe_busy(&std::io::Error::from_raw_os_error(other)),
            "os error {other} is not a reason to retry: file-not-found and access-denied must fail fast"
        );
    }
    assert!(
        !is_pipe_busy(&std::io::Error::other("no os error at all")),
        "an error with no os code cannot be the busy one"
    );
}

#[tokio::test]
async fn a_chunked_reply_is_decoded_because_docker_desktop_sends_one() {
    // NOT a hypothetical. These are the bytes a live Docker Desktop on Windows 11 answers `GET /_ping`
    // with over `\\.\pipe\dockerDesktopLinuxEngine`: a chunk of size 2 carrying `OK`, then the
    // terminator. Podman answers `OK` bare and Docker on a Linux socket sends `Content-Length: 2`, so
    // no fixture on the original platforms could have caught it — and readiness is `body == "OK"`, so
    // undecoded framing reports a healthy engine as down.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 200);
    assert_eq!(
        response.body, "OK",
        "the framing is transport, not content — the caller compares this against the engine's own word"
    );
}

#[tokio::test]
async fn a_multi_chunk_reply_is_reassembled_in_order() {
    // One chunk is the case Docker happens to send; the decoder has to be a decoder, not a special
    // case for it. A chunk-size line may also carry an extension after `;`, which is not part of it.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;x=1\r\nhello\r\n1\r\n \r\n5\r\nworld\r\n0\r\n\r\n",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect("the listener answered");

    assert_eq!(response.body, "hello world");
}

#[tokio::test]
async fn a_chunked_body_that_does_not_decode_is_malformed_rather_than_passed_on() {
    // A truncated reply must not reach the caller as a body it might compare against `"OK"`. The
    // connection was made and the answer is unusable, which is exactly what `Malformed` means.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\nOK\r\n",
    );

    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect_err("the framing promises nine bytes and delivers two");

    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

#[tokio::test]
async fn an_unframed_reply_is_left_exactly_as_it_came() {
    // The other half of the branch: podman sends `OK` with no framing at all, and a decoder that ran
    // anyway would find no chunk header and refuse a perfectly good answer.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");

    let response = TokioHttp
        .request(&HttpRequest::ping(Endpoint::UnixSocket(
            socket.to_string_lossy().into_owned(),
        )))
        .await
        .expect("the listener answered");

    assert_eq!(response.body, "OK");
}

#[cfg(unix)]
#[tokio::test]
async fn a_named_pipe_is_refused_on_this_host_rather_than_reported_down() {
    // `tokio::net::windows::named_pipe` does not exist on this target. A host that answered
    // "unreachable" would report a working Windows engine as down, which is why the refusal is its
    // own variant — and why the gap is named in the module rather than half-written.
    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::NamedPipe(
            r"\\.\pipe\docker_engine".to_string(),
        )))
        .await
        .expect_err("this host does not speak that transport");

    assert!(
        matches!(error, HttpError::Unsupported(Endpoint::NamedPipe(_))),
        "{error:?}"
    );
}

/// Serve one connection, writing `parts` with a pause between them.
///
/// The pause is what makes a read boundary land inside a frame: without it the kernel coalesces the
/// writes and the decoder never sees a partial chunk header, which is the case a streaming decoder
/// exists for. It stays small — this is the only place in the suite that costs real time.
fn serve_parts(socket: &Path, parts: &'static [&'static str]) {
    let listener = tokio::net::UnixListener::bind(socket).expect("bind the test socket");
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 1024];
        let _ = stream.read(&mut buffer).await;
        for part in parts {
            let _ = stream.write_all(part.as_bytes()).await;
            let _ = stream.flush().await;
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
    });
}

/// Accept the connection and never answer, holding it open.
///
/// What a wedged engine looks like, and the only way to reach the deadline: a listener that CLOSES
/// gives end-of-stream instead, which is a different answer entirely.
fn serve_nothing(socket: &Path) {
    let listener = tokio::net::UnixListener::bind(socket).expect("bind the test socket");
    tokio::spawn(async move {
        let Ok((mut stream, _)) = listener.accept().await else {
            return;
        };
        let mut buffer = vec![0_u8; 1024];
        let _ = stream.read(&mut buffer).await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
}

fn unix(socket: &std::path::Path) -> Endpoint {
    Endpoint::UnixSocket(socket.to_string_lossy().into_owned())
}

/// Open a stream against `socket`, or fail rather than wait for one.
///
/// The same clock and the same reason as [`drain`], one step earlier: the OPEN reads the head, so a
/// mutant that stops the request reaching the peer — `wire_format -> String::new()` is one — leaves
/// this waiting on a listener that will never answer. `stream` carries no deadline of its own by
/// design, so an unbounded open here times a mutation worker out instead of failing in two seconds.
async fn opened(socket: &Path) -> cdc_runtime::capabilities::http::HttpStreamOpen {
    tokio::time::timeout(
        STREAM_DEADLINE,
        TokioHttp.stream(&HttpRequest::ping(unix(socket))),
    )
    .await
    .expect("the stream never opened")
    .expect("the listener answered")
}

/// More pieces than any fixture here sends, and the bound a drain gives up at.
const MOST_CHUNKS: usize = 64;

/// Read a stream to its end, refusing to accumulate without a bound.
///
/// **The bound is not tidiness, it is what stops a test from taking the machine down.** A mutant that
/// removes a loop's exit — `fill -> Ok(true)` is one — makes the body yield forever, and an unbounded
/// `while let` then allocates until the kernel OOM-kills the whole cgroup, which under `cargo mutants`
/// is the run's own scope and every sibling job in it. Measured: 11 GB and a killed run. Bounded, the
/// same mutant fails in milliseconds. `Harness::follow_retries` bounds its cascade for this reason.
async fn drain(
    open: &mut cdc_runtime::capabilities::http::HttpStreamOpen,
) -> Result<Vec<String>, HttpError> {
    let mut delivered = Vec::new();
    loop {
        assert!(
            delivered.len() <= MOST_CHUNKS,
            "the stream never ended: {delivered:?}"
        );
        // **A clock, not just a counter, and the counter above cannot replace it.** A mutant that makes
        // `fill` always report progress loops INSIDE `next_chunk`, which never returns — so no bound on
        // what has been delivered is ever reached, and the mutant times a mutation worker out instead of
        // failing this test. `cargo mutants` reports a timeout separately from a miss and takes 30s to
        // reach it; failing here takes two.
        let next = tokio::time::timeout(STREAM_DEADLINE, open.body.next_chunk())
            .await
            .expect("the stream neither delivered nor ended");
        match next? {
            Some(chunk) => delivered.push(String::from_utf8_lossy(&chunk).into_owned()),
            None => return Ok(delivered),
        }
    }
}

#[tokio::test]
async fn the_reason_phrase_and_the_headers_come_back_with_the_status() {
    // `CommandProxyResponse` carries `statusText` and `headers` because a client rebuilds the error its
    // own HTTP library would have raised, and there is nowhere else to get either. A parser that read
    // only the code would leave a forwarded 404 with no message and no content type.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nApi-Version: 1.41\r\n\r\n{}",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 404);
    assert_eq!(response.status_text, "Not Found");
    assert_eq!(
        response.headers,
        vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Api-Version".to_string(), "1.41".to_string()),
        ],
        "in the order they arrived, and with nothing invented"
    );
}

#[tokio::test]
async fn a_reply_with_no_reason_phrase_is_still_a_reply() {
    // HTTP/1.1 allows an empty reason phrase, and a parser that required one would refuse an engine
    // that is answering perfectly well.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "HTTP/1.1 200\r\n\r\nOK");

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(response.status, 200);
    assert_eq!(response.status_text, "");
    assert_eq!(response.body, "OK");
}

#[tokio::test]
async fn the_headers_a_caller_asks_for_are_sent_and_the_ones_this_client_owns_are_not() {
    // `Content-Type` reaches the engine because Docker and Podman require it on a write. `Connection`
    // and `Content-Length` do NOT, whatever the caller says: the first is what makes end-of-stream mean
    // end-of-body here, and a length that disagrees with the bytes is request smuggling.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let asked = serve_once(&socket, "HTTP/1.1 200 OK\r\n\r\n{}");

    let mut request = HttpRequest::ping(unix(&socket));
    request.headers = vec![
        ("Content-Type".to_string(), "application/json".to_string()),
        ("X-Registry-Auth".to_string(), "token".to_string()),
        ("Connection".to_string(), "keep-alive".to_string()),
        ("content-length".to_string(), "999".to_string()),
    ];
    TokioHttp
        .request(&request)
        .await
        .expect("the listener answered");

    let sent = asked.await.expect("the listener recorded the request");
    assert!(
        sent.contains("Content-Type: application/json\r\n"),
        "{sent:?}"
    );
    assert!(sent.contains("X-Registry-Auth: token\r\n"), "{sent:?}");
    assert!(!sent.contains("keep-alive"), "{sent:?}");
    assert!(!sent.contains("999"), "{sent:?}");
    assert!(
        sent.contains("Connection: close\r\n"),
        "and this client's own is still there: {sent:?}"
    );
}

#[tokio::test]
async fn a_host_the_caller_names_replaces_the_placeholder() {
    // `http://d` for Podman, `http://localhost` for Docker and Apple. The placeholder exists because a
    // unix socket has no name and HTTP/1.1 needs the header — it is a fallback, never an override.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let asked = serve_once(&socket, "HTTP/1.1 200 OK\r\n\r\nOK");

    let mut request = HttpRequest::ping(unix(&socket));
    request.headers = vec![("Host".to_string(), "localhost".to_string())];
    TokioHttp
        .request(&request)
        .await
        .expect("the listener answered");

    let sent = asked.await.expect("the listener recorded the request");
    assert!(sent.contains("Host: localhost\r\n"), "{sent:?}");
    assert!(
        !sent.contains("Host: d\r\n"),
        "one Host, and it is the caller's: {sent:?}"
    );
}

#[tokio::test]
async fn a_deadline_the_caller_names_is_what_bounds_the_request() {
    // A forwarded request carries the caller's timeout; only when it names none does the oracle's
    // 3000ms apply. A listener that accepts and never answers is what a wedged engine looks like.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    serve_nothing(&socket);

    let mut request = HttpRequest::ping(unix(&socket));
    request.timeout = Some(Duration::from_millis(60));
    let error = TokioHttp
        .request(&request)
        .await
        .expect_err("nothing came back");

    match error {
        HttpError::Unreachable { reason, .. } => {
            assert!(
                reason.contains("60ms"),
                "the caller's deadline, not 3000: {reason}"
            );
        }
        other => panic!("expected a timeout, got {other:?}"),
    }
}

#[tokio::test]
async fn a_stream_delivers_the_body_as_it_arrives_rather_than_at_the_end() {
    // The whole reason `stream` exists beside `request`. A log follow that only produced its body once
    // the engine closed would be a download, and the engine never closes.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    serve_parts(
        &socket,
        &["HTTP/1.1 200 OK\r\n\r\nfirst\n", "second\n", "third\n"],
    );

    let mut open = opened(&socket).await;

    assert_eq!(open.status, 200);
    let delivered = drain(&mut open).await.expect("the stream is healthy");
    assert!(
        delivered.len() > 1,
        "a single chunk means the body was collected, not streamed: {delivered:?}"
    );
    assert_eq!(delivered.concat(), "first\nsecond\nthird\n");
}

#[tokio::test]
async fn a_chunked_stream_is_decoded_across_the_reads_it_arrives_in() {
    // The case a whole-body decoder cannot have: a chunk header split between two reads. Docker frames
    // `/events` and container logs this way, so a decoder that assumed a frame was whole would drop
    // the first line of every follow.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    serve_parts(
        &socket,
        &[
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel",
            "lo\r\n6",
            "\r\n world\r\n0\r\n\r\n",
        ],
    );

    let mut open = opened(&socket).await;

    let delivered = drain(&mut open).await.expect("the stream is healthy");
    assert_eq!(delivered, vec!["hello", " world"]);
}

#[tokio::test]
async fn a_head_that_ends_in_bare_newlines_stops_at_the_first_blank_line() {
    // Both spellings of a blank line can be present at once — a head terminated `\n\n` whose BODY then
    // contains `\r\n\r\n`. The earliest one is the head's end; taking the later one swallows the front
    // of the body into the head, and the status line still parses, so nothing else would notice.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nbody\r\n\r\ntail",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(
        response.body, "body\r\n\r\ntail",
        "everything after the FIRST blank line, framing bytes and all"
    );
    assert_eq!(
        response.headers,
        vec![("Content-Type".to_string(), "text/plain".to_string())]
    );
}

#[tokio::test]
async fn a_frame_that_fills_the_buffer_exactly_is_delivered_before_the_stream_dies() {
    // The boundary arithmetic in "is a whole frame here yet", pinned where it is observable: the last
    // read ends EXACTLY on the end of a data chunk and the peer then closes. That chunk is complete
    // and must be delivered — only the frame AFTER it is missing. An off-by-one swallows it and
    // reports the truncation one chunk early, which loses the last line of every log that ends
    // unluckily.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    serve_parts(
        &socket,
        &["HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n"],
    );

    let mut open = opened(&socket).await;

    assert_eq!(
        open.body.next_chunk().await.expect("a whole frame arrived"),
        Some(b"hello".to_vec()),
        "the frame is exactly as long as what is buffered, and it is complete"
    );
    let error = open
        .body
        .next_chunk()
        .await
        .expect_err("and then the peer stopped mid-frame");
    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

#[tokio::test]
async fn a_stream_that_stops_mid_frame_is_malformed_rather_than_ended() {
    // A truncated follow must not look like a clean end, or a client stops reassembling and shows a
    // partial log as a whole one.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    serve_parts(
        &socket,
        &["HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n9\r\nOK\r\n"],
    );

    let mut open = opened(&socket).await;

    let error = drain(&mut open)
        .await
        .expect_err("a truncated frame must not read as the end of the body");
    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

#[tokio::test]
async fn a_chunk_size_that_is_not_a_number_is_malformed() {
    // Framing this client cannot read is framing it must not pass on as body.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\nOK\r\n0\r\n\r\n",
    );

    let error = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect_err("`zz` is not a chunk size");

    assert!(matches!(error, HttpError::Malformed { .. }), "{error:?}");
}

#[tokio::test]
async fn a_transfer_encoding_that_only_ends_in_chunked_is_still_chunked() {
    // `gzip, chunked` is legal and chunked is always the last coding applied. An equality test on the
    // whole field would hand the framing bytes to the caller as body.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(response.body, "OK");
}

#[tokio::test]
async fn a_transfer_encoding_that_is_not_chunked_leaves_the_body_alone() {
    // One half of the conjunction: the FIELD is the right one and its value is not chunked, so a body
    // that happens to look like framing is content and must reach the caller as it arrived.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: identity\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(
        response.body, "2\r\nOK\r\n0\r\n\r\n",
        "decoded here, the caller would be handed `OK` for a body that never said so"
    );
}

#[tokio::test]
async fn a_header_that_merely_mentions_chunked_does_not_frame_the_body() {
    // The other half: the VALUE says chunked and the field is not `Transfer-Encoding`. Only that one
    // field describes framing, and reading any other as if it did would decode an ordinary body.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(
        &socket,
        "HTTP/1.1 200 OK\r\nX-Note: chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
    );

    let response = TokioHttp
        .request(&HttpRequest::ping(unix(&socket)))
        .await
        .expect("the listener answered");

    assert_eq!(response.body, "2\r\nOK\r\n0\r\n\r\n");
}

#[tokio::test]
async fn a_stream_that_has_ended_answers_nothing_further() {
    // A terminal answer is terminal. Reading a closed socket again is what turns one dropped
    // connection into a spin.
    let directory = short_tempdir();
    let socket = socket_in(&directory);
    let _asked = serve_once(&socket, "HTTP/1.1 200 OK\r\n\r\nOK");

    let mut open = opened(&socket).await;

    drain(&mut open).await.expect("the stream is healthy");

    assert_eq!(
        open.body.next_chunk().await.expect("still healthy"),
        None,
        "and again"
    );
}

#[tokio::test]
async fn a_tcp_address_is_refused_because_nothing_produces_one() {
    // Not an omission. `api_endpoint` resolves an engine address to a unix socket or a named pipe and
    // never to a host and port, so a dialler here would be outbound network reach this port has no
    // caller for. Refused explicitly, so the day a caller appears the refusal is what changes.
    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::Tcp(
            "127.0.0.1:2375".to_string(),
        )))
        .await
        .expect_err("no caller produces a tcp endpoint");

    assert!(
        matches!(error, HttpError::Unsupported(Endpoint::Tcp(_))),
        "refused, and not attempted: {error:?}"
    );
}

/// What this client will hold — the body a whole-response read collects, and the head above it.
mod bounds;

/// The command transport — one child process, its stdin and stdout, and the failures only it has.
mod stdio;

/// The engine's own framing inside the body, which the carrier must not touch.
mod framing;
