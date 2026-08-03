//! Secrets never reach a log line — the first of two enforcement points.
//!
//! `HostExecOptions.input` exists so `login --password-stdin` and `cat > ca.crt` keep a token out of
//! the process list. That guarantee is worthless if the exec capability then prints it while tracing the
//! call, and a leak into a log file is not fixable after the fact.
//!
//! The second enforcement point is the corpus recorder, covered by
//! `cdc-runtime/tests/corpus.rs:transcripts_carry_no_secrets` and by the TypeScript recorder's
//! own test.

use std::io::Write;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use cdc_runtime::capabilities::command::Command;
use cdc_runtime::capabilities::command::HostCommand;
use cdc_runtime_host_native::command::TokioCommand;
use tracing_subscriber::fmt::MakeWriter;

const SECRET: &str = "hunter2-super-secret-token";

/// The buffer the installed subscriber is writing into right now, if a test holds the capture.
static SINK: Mutex<Option<Arc<Mutex<Vec<u8>>>>> = Mutex::new(None);

/// Held for as long as one test is capturing, so two of them cannot interleave into one buffer.
static CAPTURING: Mutex<()> = Mutex::new(());

/// **A GLOBAL subscriber, not a thread-local default.** `tracing::subscriber::set_default` is scoped to
/// the calling thread, and `TokioCommand::run` may emit its trace from a worker — so the event went to no
/// subscriber at all whenever the task happened to move, and the capture came back empty. That is a test
/// that fails on timing rather than on behaviour; it was observed failing inside a full `test-core` run
/// and passing alone.
fn capture() -> Capture {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    let held = CAPTURING.lock().expect("capturing");
    INSTALLED.get_or_init(|| {
        tracing::subscriber::set_global_default(
            tracing_subscriber::fmt()
                .with_writer(Tee)
                .with_max_level(tracing::Level::TRACE)
                .finish(),
        )
        .expect("nothing else installs a global subscriber in this binary");
    });
    let buffer = Arc::new(Mutex::new(Vec::new()));
    *SINK.lock().expect("sink") = Some(Arc::clone(&buffer));
    Capture {
        buffer,
        _held: held,
    }
}

/// One test's exclusive claim on the trace output.
struct Capture {
    buffer: Arc<Mutex<Vec<u8>>>,
    _held: MutexGuard<'static, ()>,
}

impl Capture {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.buffer.lock().expect("log buffer")).into_owned()
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        *SINK.lock().expect("sink") = None;
    }
}

/// Forwards whatever the global subscriber writes into the buffer the current test installed, and
/// discards it when no test is capturing.
#[derive(Clone, Copy)]
struct Tee;

impl Write for Tee {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if let Some(sink) = SINK.lock().expect("sink").as_ref() {
            sink.lock().expect("log buffer").extend_from_slice(buf);
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> MakeWriter<'a> for Tee {
    type Writer = Self;

    fn make_writer(&'a self) -> Self::Writer {
        *self
    }
}

#[tokio::test]
async fn a_piped_secret_is_delivered_to_the_process_but_never_traced() {
    let captured = capture();

    let mut spec = HostCommand::new("cat", &[]);
    spec.input = Some(SECRET.to_string());
    let outcome = TokioCommand::default().run(&spec).await.expect("cat runs");

    // It reached the process — the guarantee is about the LOG, not about delivery.
    assert_eq!(outcome.stdout, SECRET);

    let log = captured.text();
    assert!(
        log.contains("cat"),
        "the call itself must still be traceable, got: {log}"
    );
    assert!(
        !log.contains(SECRET),
        "stdin leaked into the trace output: {log}"
    );
}

#[tokio::test]
async fn a_secret_in_argv_is_the_callers_mistake_and_is_traced() {
    // Stated so nobody reads the guarantee as wider than it is: the capability protects `stdin`. Anything
    // put in argv is already in the process list before this code sees it, and pretending otherwise
    // by scrubbing log lines would hide a real defect at the call site.
    let captured = capture();

    let _ = TokioCommand::default()
        .run(&HostCommand::new("echo", &["--password", SECRET]))
        .await;

    assert!(
        captured.text().contains(SECRET),
        "argv is traced as it was given, got: {}",
        captured.text()
    );
}
