//! `Endpoint::Stdio` — HTTP/1.1 over a spawned child's stdin and stdout.
//!
//! Driven with REAL child processes rather than a fake duplex, for the same reason the socket cases use
//! a real `UnixListener`: what is pinned here is that this host can speak the same wire format down a
//! pipe pair it created, and a fake stream would only prove the parser agrees with itself.
//!
//! What NO test here can prove is `wsl.exe` — whether it passes an argv through unmangled and whether
//! `system dial-stdio` answers the way a socket does. That is `tests/live_wsl.rs`, against a real
//! distribution.

use cdc_runtime::capabilities::http::{Endpoint, Http, HttpError, HttpRequest};
use cdc_runtime_host_native::http::TokioHttp;

/// What a test that SPAWNS gives the child, and it is bounded from both sides.
///
/// Above the 3s default, because a spawn on a machine also running a mutation battery has taken longer
/// than that and reported load as a defect. **Below `cargo mutants`' own 30s timeout**, because a
/// mutant that removes a loop bound must FAIL this test rather than time the worker out — a timeout is
/// reported separately from a miss and is far slower to discover.
const SPAWN_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// A command whose stdin and stdout carry the exchange — `<engine> system dial-stdio`.
///
/// Driven with a REAL child process rather than a fake stream, for the same reason the socket cases
/// use a real `UnixListener`: what is being pinned is that this host can speak HTTP/1.1 down a pipe
/// pair it created, and a fake duplex would only prove the parser agrees with itself.
fn dial_stdio(script: &str) -> Endpoint {
    Endpoint::Stdio(vec![
        "/bin/sh".to_string(),
        "-c".to_string(),
        script.to_string(),
    ])
}

#[tokio::test]
async fn a_command_endpoint_exchanges_over_the_childs_stdin_and_stdout() {
    // The request goes down stdin and the reply comes back up stdout. `cat > /dev/null` is what makes
    // this a real exchange rather than a child that answers before being asked: without a reader the
    // client's write would fill the pipe buffer and block.
    let response = TokioHttp
        .request(&HttpRequest::ping(dial_stdio(
            "timeout 5 sed -n '1,4p;4q' >/dev/null; printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'",
        )))
        .await
        .expect("the child answered");

    assert_eq!(response.status, 200);
    assert_eq!(response.body, "OK", "the readiness verdict is the BODY");
}

#[tokio::test]
async fn a_command_endpoint_is_sent_the_request_the_caller_built() {
    // The bytes on stdin are the bytes on any other transport — one wire format, whatever carries it.
    // The child echoes what it was sent back as the body, so the assertion is on the real request.
    //
    // **It reads a BOUNDED number of lines and must.** This client does not close its write half after
    // the request — it behaves exactly as it does on a socket, where `Connection: close` makes the
    // SERVER close — so a child that read to end-of-file would wait for one that never comes. A real
    // `system dial-stdio` relays in both directions and never waits for EOF either; this is a property
    // of the transport worth pinning, because the first draft of this test hung on it for 3 seconds and
    // reported itself as an unreachable engine.
    let response = TokioHttp
        .request(&HttpRequest::ping(dial_stdio(
            "body=$(timeout 5 sed -n '1,3p;3q' || true); printf 'HTTP/1.1 200 OK\r\nContent-Length: %s\r\n\r\n%s' ${#body} \"$body\"",
        )))
        .await
        .expect("the child answered");

    assert!(
        response.body.starts_with("GET /_ping HTTP/1.1"),
        "the request line reached the child: {:?}",
        response.body
    );
    assert!(
        response.body.contains("Connection: close"),
        "and the framing rule this client owns: {:?}",
        response.body
    );
}

#[tokio::test]
async fn a_command_that_cannot_be_started_is_unreachable_and_names_itself() {
    // The engine is not down — there is nothing to run. Reported as `Unreachable` because that is what
    // a caller can act on, and the endpoint travels with it so the argv is visible.
    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::Stdio(vec![
            "/nonexistent/wsl.exe".to_string(),
            "--distribution".to_string(),
        ])))
        .await
        .expect_err("nothing to spawn");

    assert!(
        matches!(error, HttpError::Unreachable { .. }),
        "a launcher that is not there: {error:?}"
    );
}

#[tokio::test]
async fn an_empty_command_is_refused_rather_than_spawned() {
    // An `Endpoint::Stdio` with no argv has no program to run. Refused as unsupported rather than
    // reported unreachable, because "there is no engine there" would be a claim about the world and
    // this is a claim about the request.
    let error = TokioHttp
        .request(&HttpRequest::ping(Endpoint::Stdio(Vec::new())))
        .await
        .expect_err("there is no program in an empty argv");

    assert!(
        matches!(error, HttpError::Unsupported(Endpoint::Stdio(_))),
        "an argv with no program: {error:?}"
    );
}

#[tokio::test]
async fn a_bridge_that_fails_reports_what_it_said_rather_than_an_empty_reply() {
    // **The failure this transport actually has.** `wsl.exe` with a distribution that is not there
    // exits having written the reason to STDERR and nothing to stdout, so a client reading only stdout
    // sees a clean EOF and calls it "closed without a reply" — which sends whoever is debugging to look
    // at the engine instead of at the message that already explained it.
    let error = TokioHttp
        .request(&HttpRequest::ping(dial_stdio(
            "exec 0<&-; echo 'There is no distribution with the supplied name.' >&2; exit 1",
        )))
        .await
        .expect_err("the bridge failed");

    // Both halves, because either alone passes for the wrong reason: `Unsupported`'s own message
    // interpolates the ARGV, and the argv here contains the sentence the child was told to print.
    assert!(
        matches!(error, HttpError::Unreachable { .. }),
        "the bridge started and then failed, which is not a transport this host cannot speak: {error:?}"
    );
    let reason = match &error {
        HttpError::Unreachable { reason, .. } => reason.clone(),
        other => unreachable!("{other:?}"),
    };
    assert!(
        reason.contains("no distribution with the supplied name"),
        "the child's own explanation reaches the caller: {reason}"
    );
}

#[tokio::test]
async fn a_streamed_command_endpoint_delivers_its_pieces_and_closes() {
    // A log follow over a bridge is the same shape as one over a socket: chunks, then end-of-stream
    // when the child exits. `stream` is untimed, so what ends it is the process.
    let mut open = TokioHttp
        .stream(&HttpRequest::ping(dial_stdio(
            "timeout 5 sed -n '1,4p;4q' >/dev/null; printf 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n6\r\nsecond\r\n0\r\n\r\n'",
        )))
        .await
        .expect("the child answered");

    let mut pieces = Vec::new();
    while let Some(chunk) = super::next_bounded(&mut open).await {
        pieces.push(chunk);
        if pieces.len() > 8 {
            break;
        }
    }

    assert_eq!(pieces.concat(), "firstsecond");
}

#[tokio::test]
async fn a_utf16_failure_from_wsl_reaches_a_person_as_words() {
    // **Found against a real `wsl.exe` on win11, and nothing hermetic could have found it.** A missing
    // distribution is reported on STDOUT — not stderr — and in UTF-16LE, which is the same encoding
    // that makes `wsl -l -v` unreadable without PowerShell. So the reason arrived as
    // `T\0h\0e\0r\0e\0 \0i\0s\0 \0n\0o\0 ...`: technically delivered, and unreadable.
    //
    // The bytes are `printf`ed here exactly as wsl.exe wrote them.
    // A generous deadline, and it is not decoration: this test SPAWNS, and the 3s default turned a
    // correct refusal into "no answer within 3000ms" once, on a machine that was also running a
    // mutation battery. A timeout that a busy machine can trip is a test that reports load as a defect.
    let mut request = HttpRequest::ping(dial_stdio(
        r"printf 'T\0h\0e\0r\0e\0 \0i\0s\0 \0n\0o\0 \0d\0i\0s\0t\0r\0i\0b\0u\0t\0i\0o\0n\0.\0'",
    ));
    request.timeout = Some(SPAWN_DEADLINE);
    let error = TokioHttp
        .request(&request)
        .await
        .expect_err("that is not HTTP");

    let reason = format!("{error}");
    assert!(
        reason.contains("There is no distribution."),
        "the sentence reaches a person: {reason}"
    );
}

#[tokio::test]
async fn a_bridge_that_dies_before_reading_the_request_still_reaches_a_person_as_words() {
    // **The same defect as the test above, on the other exit — and this one takes it deterministically.**
    // `wsl.exe` against a missing distribution exits AT ONCE, so whether its sentence survived came down
    // to whether the request beat the child: win that race and the reason arrives through the response
    // read, lose it and the write fails with `EPIPE`. The `EPIPE` branch used to look for the reason on
    // stderr, where `wsl.exe` never puts it, and reported `Broken pipe (os error 32)` instead — a true
    // description of the pipe and a useless one for a person. It was found as an INTERMITTENT failure of
    // the test above on a loaded machine, and not by design.
    //
    // **A body larger than a pipe buffer is what makes it a rule rather than a race.** A ~60-byte
    // request lands in the 64 KiB buffer before the child has even been scheduled, which is why every
    // ordinary run takes the read path; a body past that cannot be written until somebody READS it, and
    // this child never does — it prints and exits. So the write is still going when the pipe loses its
    // reader, which is `EPIPE`, every time.
    let mut request = HttpRequest::ping(dial_stdio(
        r"printf 'T\0h\0e\0r\0e\0 \0i\0s\0 \0n\0o\0 \0d\0i\0s\0t\0r\0i\0b\0u\0t\0i\0o\0n\0.\0'",
    ));
    request.method = "POST".to_string();
    request.body = Some("x".repeat(256 * 1024));
    request.timeout = Some(SPAWN_DEADLINE);
    let error = TokioHttp
        .request(&request)
        .await
        .expect_err("that is not HTTP");

    let reason = format!("{error}");
    assert!(
        reason.contains("There is no distribution."),
        "however the bridge died, what it printed reaches a person: {reason}"
    );
    assert!(
        !reason.contains("Broken pipe"),
        "and never as the pipe's own words instead of the child's: {reason}"
    );
}

/// The rule [`readable`] states, asked directly.
///
/// Public and unit-tested for the reason `is_pipe_busy` is: it is a RULE, and a rule reachable only
/// through a live `wsl.exe` is a rule no gate here can execute. Three cases, because a comparison
/// asserted in one direction is a comparison that does not distinguish — the same trap this tree has
/// now paid for five units running.
#[test]
fn utf16le_text_is_decoded_and_everything_else_is_left_exactly_alone() {
    // Every second character is a NUL: that IS UTF-16LE ASCII read as UTF-8, and it is the shape a
    // real `wsl.exe` produced on win11.
    assert_eq!(
        cdc_runtime_host_native::http::readable("T\0h\0e\0r\0e\0"),
        "There",
        "the sentence a person needs"
    );
    // A perfectly ordinary head is not touched, or every engine error would be rewritten.
    assert_eq!(
        cdc_runtime_host_native::http::readable("HTTP/1.0 200 OK"),
        "HTTP/1.0 200 OK"
    );
    // A MINORITY of NULs is left alone: binary that is not UTF-16 must survive as itself, and this is
    // the case that tells `<=` from `>=`.
    assert_eq!(
        cdc_runtime_host_native::http::readable("abc\0"),
        "abc\0",
        "one NUL in four is not an encoding, it is a byte"
    );
    // Exactly one character and one NUL. The shortest UTF-16LE string there is, and the ONLY shape that
    // tells `count * 2` from `count + 2` — every longer example agrees.
    assert_eq!(cdc_runtime_host_native::http::readable("a\0"), "a");
}

/// The rule [`pipes`] states, asked with the one child that can ask it.
///
/// Public and unit-tested for the reason `readable` and `is_pipe_busy` are: `spawn_dial_stdio` asks
/// for all three pipes, so nothing this port spawns can be missing one and no test could reach the
/// rule while it lived inside the spawn. A child started with stdin INHERITED is that case, and only a
/// caller outside the module can build one.
#[tokio::test]
async fn a_bridge_started_without_its_pipes_is_the_transport_failing_to_start() {
    let mut child = tokio::process::Command::new("/bin/sh")
        .args(["-c", "exit 0"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("a child that starts");

    let error = cdc_runtime_host_native::http::pipes(&mut child, &dial_stdio("exit 0"))
        .expect_err("stdin was never piped");

    // `Unreachable` and not `Unsupported`: this host CAN speak stdio, and what failed is the start.
    let reason = match &error {
        HttpError::Unreachable { reason, .. } => reason.clone(),
        other => unreachable!("{other:?}"),
    };
    assert!(
        reason.contains("without the pipes"),
        "the bridge, not the engine: {reason}"
    );
}

#[tokio::test]
async fn a_bridge_given_all_three_pipes_hands_them_over() {
    // The other direction, and it is what tells the rule from a function that always refuses.
    let mut child = tokio::process::Command::new("/bin/sh")
        .args(["-c", "exit 0"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("a child that starts");

    assert!(
        cdc_runtime_host_native::http::pipes(&mut child, &dial_stdio("exit 0")).is_ok(),
        "all three were asked for"
    );
}

#[tokio::test]
async fn a_bridge_that_dies_silently_is_reported_as_no_reply_rather_than_as_nothing() {
    // Nothing on stdout and nothing on stderr. There is no explanation to give, so the honest answer is
    // the one a socket would give — `Malformed`, "closed without a reply" — and NOT an empty error made
    // of the absence of a message.
    let error = TokioHttp
        .request(&HttpRequest::ping(dial_stdio("exec 0<&-; exit 3")))
        .await
        .expect_err("the bridge said nothing at all");

    let reason = format!("{error}");
    assert!(
        reason.contains("closed without a reply") || reason.contains("Broken pipe"),
        "no invented explanation: {reason}"
    );
}

#[tokio::test]
async fn a_finished_command_stream_answers_none_again_rather_than_reading_the_child_twice() {
    // The same rule the socket body is held to. It matters more here: asking twice means polling the
    // stderr drain a second time, and a handle that has already been consumed must answer without
    // panicking and without inventing a reason the first end-of-stream did not have.
    let mut open = TokioHttp
        .stream(&HttpRequest::ping(dial_stdio(
            "timeout 5 sed -n '1,4p;4q' >/dev/null; printf 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK'",
        )))
        .await
        .expect("the child answered");

    // Counted in PIECES rather than in bytes. A body that answers with empty pieces never grows, so a
    // bound on what has been COLLECTED is one a stuck stream walks straight past — measured: with
    // `next_raw` returning an empty piece this loop ran until the mutation worker timed out, while the
    // same mutant answering `"xyzzy"` failed it in milliseconds. `drain` counts for the same reason.
    let mut seen = String::new();
    let mut pieces = 0;
    while let Some(chunk) = super::next_bounded(&mut open).await {
        seen.push_str(&chunk);
        pieces += 1;
        assert!(
            pieces <= super::MOST_CHUNKS,
            "the stream never ended: {seen:?}"
        );
    }
    assert_eq!(seen, "OK");
    assert_eq!(super::next_bounded(&mut open).await, None, "and again");
}

#[tokio::test]
async fn a_bridge_that_dies_mid_request_reports_its_reason_rather_than_a_broken_pipe() {
    // **The write half of the same rule**, and it needs a request too big to disappear into a buffer.
    // A `/_ping` is ~60 bytes and a pipe holds 64 KiB, so it lands whether or not anyone is reading and
    // the failure surfaces on the READ. With a body past that, the write itself blocks and then fails
    // with `EPIPE` the moment the child is gone — which is what a real `wsl.exe` does when the
    // distribution is missing and the request is a container create rather than a ping.
    //
    // Deterministic on purpose: the child closes stdin and exits before reading a byte, so there is no
    // race between the write landing and the process dying.
    let mut request = HttpRequest::ping(dial_stdio(
        "exec 0<&-; echo 'There is no distribution with the supplied name.' >&2; exit 1",
    ));
    request.method = "POST".to_string();
    request.body = Some("x".repeat(256 * 1024));
    request.timeout = Some(SPAWN_DEADLINE);

    let error = TokioHttp
        .request(&request)
        .await
        .expect_err("the bridge died mid-request");

    let reason = format!("{error}");
    assert!(
        reason.contains("no distribution with the supplied name"),
        "the child's own explanation, not `EPIPE`: {reason}"
    );
    assert!(
        !reason.contains("Broken pipe"),
        "and never the syscall's word for it: {reason}"
    );
}

#[tokio::test]
async fn a_bridge_that_dies_mid_request_with_nothing_to_say_reports_the_pipe_itself() {
    // The write half of `a_bridge_that_dies_silently_…`, and the case that says what the rule above is
    // FOR: `EPIPE` is replaced by the child's own words only when there are some. This child closes
    // stdin and exits without a syllable on either channel, so there is nothing to substitute and the
    // pipe's own error is the honest answer — an empty reason made of a missing message would not be.
    let mut request = HttpRequest::ping(dial_stdio("exec 0<&-; exit 3"));
    request.method = "POST".to_string();
    request.body = Some("x".repeat(256 * 1024));
    request.timeout = Some(SPAWN_DEADLINE);

    let error = TokioHttp
        .request(&request)
        .await
        .expect_err("the bridge died mid-request");

    let reason = format!("{error}");
    assert!(
        reason.contains("Broken pipe"),
        "nothing was said, so the write's own failure stands: {reason}"
    );
}
