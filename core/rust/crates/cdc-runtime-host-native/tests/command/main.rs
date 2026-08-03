//! The real exec capability (-6).
//!
//! These run actual processes. They use `/bin/sh`, `sleep` and `cat` rather than an engine, so they
//! are hermetic — a machine without podman still proves the capability spawns, times out, redacts and
//! reaps.

// Two more claims about THIS adapter, each too large to share a file: that a secret never reaches
// a log line, and that an abandoned attempt leaves no child process behind.
mod connection;
mod secrets;

use std::time::Duration;

use cdc_runtime::capabilities::command::{Command, CommandError, Retry, StdioSource};
use cdc_runtime::capabilities::command::{HostCommand, ReadinessCheck, ServiceId, ServiceOpts};
use cdc_runtime_host_native::command::TokioCommand;

fn sh(script: &str) -> HostCommand {
    HostCommand::new("/bin/sh", &["-c", script])
}

#[tokio::test]
async fn run_captures_stdout_stderr_and_the_exit_code() {
    let outcome = TokioCommand::default()
        .run(&sh("echo out; echo err 1>&2; exit 3"))
        .await
        .expect("the command runs");

    assert_eq!(outcome.code, 3);
    assert_eq!(outcome.stdout.trim(), "out");
    assert_eq!(outcome.stderr.trim(), "err");
    assert!(!outcome.success());
}

#[tokio::test]
async fn run_writes_stdin_and_closes_it() {
    // `cat` never exits until its stdin is closed, so this also proves the pipe is dropped.
    let mut spec = HostCommand::new("cat", &[]);
    spec.input = Some("piped secret".to_string());

    let outcome = TokioCommand::default().run(&spec).await.expect("cat runs");

    assert_eq!(outcome.stdout, "piped secret");
    assert!(outcome.success());
}

#[tokio::test]
async fn a_missing_program_is_a_spawn_error_not_a_panic() {
    let outcome = TokioCommand::default()
        .run(&HostCommand::new("cdc-no-such-program", &[]))
        .await;

    assert!(
        matches!(outcome, Err(CommandError::Spawn { .. })),
        "got {outcome:?}"
    );
}

#[tokio::test]
async fn a_timeout_is_reported_and_the_child_is_killed() {
    let mut spec = sh("sleep 30");
    spec.timeout = Some(Duration::from_millis(100));

    let outcome = TokioCommand::default().run(&spec).await;

    assert!(
        matches!(outcome, Err(CommandError::Timeout { .. })),
        "got {outcome:?}"
    );
}

/// A shell that starts a background process, records its pid where a test can read it, and then waits
/// forever. The pid lands via a RENAME so a reader cannot see the file before its contents.
fn sh_with_grandchild(pidfile: &std::path::Path, announce: &str) -> HostCommand {
    sh(&format!(
        "sleep 300 & echo $! > {0}.tmp; mv {0}.tmp {0}; echo {announce}; wait",
        pidfile.display()
    ))
}

fn grandchild_pid(pidfile: &std::path::Path) -> u32 {
    std::fs::read_to_string(pidfile)
        .expect("the pid file is readable")
        .trim()
        .parse()
        .expect("a pid was written")
}

#[tokio::test]
async fn a_timed_out_command_takes_its_process_tree_with_it() {
    // Every `ssh` this core runs is bounded (`SSH_COMMAND_TIMEOUT`), so the timeout is a path OUT
    // of a connection attempt like any other and it must not be the one that leaks.
    let directory = tempfile::tempdir().expect("temp dir");
    let pidfile = directory.path().join("grandchild.pid");
    let mut spec = sh_with_grandchild(&pidfile, "started");
    spec.timeout = Some(Duration::from_millis(300));

    let outcome = TokioCommand::default().run(&spec).await;

    assert!(
        matches!(outcome, Err(CommandError::Timeout { .. })),
        "got {outcome:?}"
    );
    let grandchild = grandchild_pid(&pidfile);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !process_is_alive(grandchild),
        "pid {grandchild} outlived the command that timed out"
    );
}

#[tokio::test]
async fn abandoning_a_stream_takes_its_process_tree_with_it() {
    // `abandoning_a_stream_mid_flight_leaves_nothing_running` proves the direct child goes. What it
    // cannot see is the tree behind it, which `kill_on_drop` does not touch.
    let directory = tempfile::tempdir().expect("temp dir");
    let pidfile = directory.path().join("grandchild.pid");

    let mut handle = TokioCommand::default()
        .stream(&sh_with_grandchild(&pidfile, "started"))
        .await
        .expect("the command streams");
    let chunk = handle.next_chunk().await.expect("it announces itself");
    assert_eq!(chunk.data.trim(), "started");
    let grandchild = grandchild_pid(&pidfile);

    drop(handle);
    tokio::time::sleep(Duration::from_millis(200)).await;

    assert!(
        !process_is_alive(grandchild),
        "pid {grandchild} outlived the stream that started it"
    );
}

#[tokio::test]
async fn a_process_killed_by_a_signal_has_no_exit_code_and_reports_minus_one() {
    // `status.code()` is None for a signalled process. The oracle's result carries a number, so the
    // capability has to choose one — and it must not be 0, which would read as success.
    let outcome = TokioCommand::default()
        .run(&sh("kill -9 $$"))
        .await
        .expect("the command runs");

    assert_eq!(outcome.code, -1);
    assert!(!outcome.success());
}

#[tokio::test]
async fn stdin_that_the_process_will_never_read_is_an_error_rather_than_a_hang() {
    // The child exits before draining the pipe, so the write fails once the buffer is full. Reporting
    // it matters: `login --password-stdin` silently not receiving its token looks like a bad password.
    let mut spec = sh("exit 0");
    spec.input = Some("x".repeat(4 * 1024 * 1024));

    let outcome = TokioCommand::default().run(&spec).await;

    assert!(
        matches!(
            outcome,
            Err(CommandError::Io {
                operation: "writing stdin",
                ..
            })
        ),
        "got {outcome:?}"
    );
}

#[tokio::test]
async fn cwd_and_env_are_applied() {
    let mut spec = sh("pwd; printf %s \"$CDC_PROBE\"");
    spec.cwd = Some("/tmp".to_string());
    spec.env = vec![("CDC_PROBE".to_string(), "set".to_string())];

    let outcome = TokioCommand::default().run(&spec).await.expect("runs");

    assert!(outcome.stdout.starts_with("/tmp"), "got {}", outcome.stdout);
    assert!(outcome.stdout.trim_end().ends_with("set"));
}

#[tokio::test]
async fn stream_tags_each_chunk_with_its_source_and_then_exits() {
    let mut handle = TokioCommand::default()
        .stream(&sh("echo one; echo two 1>&2"))
        .await
        .expect("the command streams");

    let mut stdout = String::new();
    let mut stderr = String::new();
    while let Some(chunk) = handle.next_chunk().await {
        match chunk.source {
            StdioSource::Stdout => stdout.push_str(&chunk.data),
            StdioSource::Stderr => stderr.push_str(&chunk.data),
        }
    }

    assert_eq!(stdout.trim(), "one");
    assert_eq!(stderr.trim(), "two");
    assert_eq!(handle.wait().await.expect("exit status").code, 0);
}

#[tokio::test]
async fn a_streamed_command_reports_its_own_exit_code() {
    // Asserted as a NUMBER rather than as `!success()`: a handle that reported zero for everything
    // would pass a success check on a command that failed.
    let mut handle = TokioCommand::default()
        .stream(&sh("exit 3"))
        .await
        .expect("the command streams");
    while handle.next_chunk().await.is_some() {}

    assert_eq!(handle.wait().await.expect("exit status").code, 3);
}

#[tokio::test]
async fn a_streamed_process_killed_by_a_signal_reports_minus_one() {
    let mut handle = TokioCommand::default()
        .stream(&sh("kill -9 $$"))
        .await
        .expect("the command streams");
    while handle.next_chunk().await.is_some() {}

    assert_eq!(handle.wait().await.expect("exit status").code, -1);
}

#[tokio::test]
async fn waiting_twice_for_the_same_stream_is_an_error_rather_than_a_second_answer() {
    let mut handle = TokioCommand::default()
        .stream(&sh("exit 0"))
        .await
        .expect("the command streams");
    while handle.next_chunk().await.is_some() {}
    handle.wait().await.expect("the first wait answers");

    let outcome = handle.wait().await;

    assert!(
        matches!(outcome, Err(CommandError::Io { .. })),
        "got {outcome:?}"
    );
}

#[tokio::test]
async fn abandoning_a_stream_mid_flight_leaves_nothing_running() {
    // The pump has nowhere to send once the handle is dropped, and it must stop rather than hold the
    // child open reading a pipe nobody will drain.
    let mut handle = TokioCommand::default()
        .stream(&sh("i=0; while :; do echo chunk-$i; i=$((i+1)); done"))
        .await
        .expect("the command streams");
    assert!(handle.next_chunk().await.is_some(), "it produces output");

    drop(handle);
    tokio::time::sleep(Duration::from_millis(200)).await;

    // Nothing to assert on the handle — it is gone. What must be true is that the shell it started
    // is gone too, which `kill_on_drop` is responsible for.
    let running = std::process::Command::new("pgrep")
        .args(["-f", "while :; do echo chunk-"])
        .output()
        .expect("pgrep runs");
    assert!(
        !running.status.success(),
        "the abandoned shell is still running: {}",
        String::from_utf8_lossy(&running.stdout)
    );
}

#[tokio::test]
async fn spawn_service_waits_for_its_readiness_probe() {
    // The ENGINE comes up late rather than the file appearing late, because that is what a service
    // does and what the check now asks. A `touch` satisfies a presence check and a bare `bind`
    // satisfies a connect; only an answer satisfies this.
    let directory = short_tempdir();
    let socket = directory.path().join("ready.sock");
    let command = TokioCommand::default();
    let id = ServiceId("probe".to_string());
    let listening = {
        let socket = socket.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            answer_one_ping(&socket).await;
        })
    };

    command
        .spawn_service(
            &id,
            &sh("sleep 30"),
            &ServiceOpts {
                retry: Retry {
                    count: 50,
                    wait: Duration::from_millis(20),
                },
                check_status: pinging(&socket.to_string_lossy()),
            },
        )
        .await
        .expect("the service becomes ready");

    assert!(
        listening.is_finished(),
        "readiness returned before anything was listening"
    );
    command.kill(&id).await.expect("the service stops");
}

#[tokio::test]
async fn something_that_answers_but_is_not_the_engine_is_not_ready() {
    // **Both halves of the verdict, because either alone lets something through.** The oracle's is
    // `status === 2xx` (axios rejects the rest before the line runs) AND `data === "OK"`
    // (`host-client.ts`), and this is the case that needs the second: a captive portal or a proxy
    // answering `200` with an HTML page is reachable, well-formed and not an engine. The other
    // direction — a `500` whose body happens to read `OK` — is the same mistake mirrored.
    for (status, body) in [
        ("200 OK", "<html>no engine here</html>"),
        ("500 Oops", "OK"),
    ] {
        let directory = short_tempdir();
        let socket = directory.path().join("wrong.sock");
        // Bound HERE, before the service is spawned: this case has one poll in its budget, and a
        // probe that found nothing listening would report not-ready without ever reaching the verdict.
        let listener = tokio::net::UnixListener::bind(&socket).expect("the fixture binds");
        let answering = tokio::spawn(async move { answer_one(listener, status, body).await });
        let command = TokioCommand::default();
        let id = ServiceId("wrong".to_string());

        let outcome = command
            .spawn_service(
                &id,
                &sh("sleep 30"),
                &ServiceOpts {
                    retry: Retry {
                        count: 1,
                        wait: Duration::from_millis(10),
                    },
                    check_status: pinging(&socket.to_string_lossy()),
                },
            )
            .await;

        assert!(
            matches!(outcome, Err(CommandError::NotReady { count: 1, .. })),
            "{status} / {body}: {outcome:?}"
        );
        answering.abort();
    }
}

#[tokio::test]
async fn a_socket_that_accepts_and_never_answers_is_not_ready() {
    // **The whole of what asking the ENGINE buys, and the case a connect cannot see.** A bound socket
    // with nobody serving it accepts and then says nothing: that is `ssh -NL` whose channel the remote
    // refused, and a `podman system service` between binding and serving. A connect calls both of them
    // ready, and the very next request answers `API_UNREACHABLE` — a connection reported up and then
    // immediately down, which is what this check was one question short of.
    //
    // One attempt, because a poll that gets no answer costs the request's own 3s ceiling and this test
    // is about the verdict rather than about the budget.
    let directory = short_tempdir();
    let socket = directory.path().join("mute.sock");
    let listener = tokio::net::UnixListener::bind(&socket).expect("the fixture binds");
    let accepting = tokio::spawn(async move {
        // Accepted and then held, deliberately: dropping it would close the connection, which IS an
        // answer of a kind and would let the probe fail for the wrong reason.
        let accepted = listener.accept().await;
        std::future::pending::<()>().await;
        drop(accepted);
    });
    let command = TokioCommand::default();
    let id = ServiceId("mute".to_string());

    let outcome = command
        .spawn_service(
            &id,
            &sh("sleep 30"),
            &ServiceOpts {
                retry: Retry {
                    count: 1,
                    wait: Duration::from_millis(10),
                },
                check_status: pinging(&socket.to_string_lossy()),
            },
        )
        .await;

    assert!(
        matches!(outcome, Err(CommandError::NotReady { count: 1, .. })),
        "a socket that accepts is not an engine that answers: {outcome:?}"
    );
    accepting.abort();
}

#[tokio::test]
async fn a_readiness_probe_can_be_a_command_because_a_guest_socket_is_not_a_local_path() {
    // What the WSL transport needs: a service started inside a scope binds its socket in the GUEST,
    // where `PathExists` can see nothing. The probe is a command the transport built, and only its
    // EXIT CODE decides — a probe that runs and says no is not readiness.
    let directory = tempfile::tempdir().expect("temp dir");
    let socket = directory.path().join("ready.sock");
    let command = TokioCommand::default();
    let id = ServiceId("scoped".to_string());

    command
        .spawn_service(
            &id,
            &sh(&format!("sleep 0.2; touch {}; sleep 30", socket.display())),
            &ServiceOpts {
                retry: Retry {
                    count: 50,
                    wait: Duration::from_millis(20),
                },
                check_status: ReadinessCheck::CommandSucceeds {
                    command: sh(&format!("test -f {}", socket.display())),
                },
            },
        )
        .await
        .expect("the service becomes ready once its probe exits 0");

    assert!(
        socket.exists(),
        "readiness returned before the probe could pass"
    );
    command.kill(&id).await.expect("the service stops");
}

#[tokio::test]
async fn a_readiness_probe_that_cannot_be_spawned_at_all_is_not_readiness() {
    // The same answer as a probe that ran and refused: neither is evidence that anything is
    // listening, and treating an unspawnable probe as ready would publish a data plane on hope.
    let command = TokioCommand::default();
    let id = ServiceId("unprobeable".to_string());

    let outcome = command
        .spawn_service(
            &id,
            &sh("sleep 30"),
            &ServiceOpts {
                retry: Retry {
                    count: 2,
                    wait: Duration::from_millis(10),
                },
                check_status: ReadinessCheck::CommandSucceeds {
                    command: HostCommand::new("/cdc/no/such/probe", &[]),
                },
            },
        )
        .await;

    assert!(
        matches!(outcome, Err(CommandError::NotReady { count: 2, .. })),
        "got {outcome:?}"
    );
}

#[tokio::test]
async fn spawn_service_gives_up_after_the_bounded_retry() {
    let command = TokioCommand::default();
    let id = ServiceId("never".to_string());

    let outcome = command
        .spawn_service(
            &id,
            &sh("sleep 30"),
            &ServiceOpts {
                retry: Retry {
                    count: 3,
                    wait: Duration::from_millis(10),
                },
                check_status: pinging("/cdc/never/appears.sock"),
            },
        )
        .await;

    assert!(
        matches!(outcome, Err(CommandError::NotReady { count: 3, .. })),
        "got {outcome:?}"
    );
    // And it must not leave the process behind after giving up.
    assert!(matches!(
        command.kill(&id).await,
        Err(CommandError::UnknownService(_))
    ));
}

#[tokio::test]
async fn stopping_a_service_that_was_never_started_is_an_error_the_caller_can_see() {
    // The teardown path a cancelled attempt takes: the machine addresses its service by NAME whether
    // or not anything got as far as spawning one, so this answer has to be a value the caller can
    // read — `stop_api` turns it into `false` — and never a panic.
    let command = TokioCommand::default();

    let error = command
        .kill(&ServiceId("never".to_string()))
        .await
        .expect_err("there is nothing to stop");

    assert!(
        matches!(error, CommandError::UnknownService(id) if id.0 == "never"),
        "the refusal names what was asked for"
    );
}

#[tokio::test]
async fn killing_a_service_takes_the_whole_process_tree() {
    // The orphan in the shape `ssh -NL` actually produces one: the direct child is not the
    // only process the service started. Killing just that child reparents the rest to init, where
    // nothing holds a handle to them and nothing will ever stop them.
    let directory = tempfile::tempdir().expect("temp dir");
    let pidfile = directory.path().join("grandchild.pid");
    let command = TokioCommand::default();
    let id = ServiceId("tree".to_string());

    // Written to a temporary name and RENAMED, so the readiness probe cannot observe the file
    // between its creation and the pid landing in it.
    command
        .spawn_service(
            &id,
            &sh(&format!(
                "sleep 300 & echo $! > {0}.tmp; mv {0}.tmp {0}; wait",
                pidfile.display()
            )),
            &ServiceOpts {
                retry: Retry {
                    count: 50,
                    wait: Duration::from_millis(20),
                },
                // The subject here is the process TREE, and the pid file is only a sequencing
                // signal. Asked as a command, because a file appearing is exactly what a command can
                // answer and never what a socket check can.
                check_status: ReadinessCheck::CommandSucceeds {
                    command: sh(&format!("test -s {}", pidfile.display())),
                },
            },
        )
        .await
        .expect("the service becomes ready");
    let grandchild: u32 = std::fs::read_to_string(&pidfile)
        .expect("the pid file is readable")
        .trim()
        .parse()
        .expect("a pid was written");

    command.kill(&id).await.expect("the service stops");
    tokio::time::sleep(Duration::from_millis(200)).await;

    assert!(
        !process_is_alive(grandchild),
        "pid {grandchild} outlived the service that started it"
    );
}

#[tokio::test]
async fn a_socket_file_nothing_is_listening_on_is_not_ready() {
    // A REAL GAP, CLOSED — and it was not academic. Neither `ssh` nor `podman` unlinks the
    // socket it bound when it is killed (verified live for OpenSSH 10.2 under SIGTERM and SIGKILL, and
    // for podman under this app's own SIGKILL teardown), so the file left behind used to satisfy a
    // presence check on the very first attempt. What followed was a connection reported `ready` over a
    // dead socket, and then `API_UNREACHABLE` from the probe that dialled it for real — which is exactly
    // what a live server run on this machine produced, on every connect after the first.
    //
    // The oracle never had the hole: `services.ts:startTunnel` polls `GET /_ping` and calls a tunnel
    // ready only when the ENGINE answers. This asks one question short of that — whether anything
    // ACCEPTS — and the API probe immediately afterwards asks the rest.
    let directory = short_tempdir();
    let stale = directory.path().join("stale.sock");
    std::fs::write(&stale, "").expect("a socket file a previous forward left behind");
    let command = TokioCommand::default();
    let id = ServiceId("stale".to_string());

    let outcome = command
        .spawn_service(
            &id,
            // A service that exits immediately and binds nothing: every reason to call it not ready.
            &sh("exit 1"),
            &ServiceOpts {
                retry: Retry {
                    count: 3,
                    wait: Duration::from_millis(10),
                },
                check_status: pinging(&stale.to_string_lossy()),
            },
        )
        .await;

    assert!(
        matches!(outcome, Err(CommandError::NotReady { count: 3, .. })),
        "a corpse is not a server: {outcome:?}"
    );
}

#[tokio::test]
async fn dropping_the_command_reaps_its_services() {
    // The failure mode, made checkable: an `ssh -NL` that outlives its connection.
    let directory = tempfile::tempdir().expect("temp dir");
    let marker = directory.path().join("alive");
    let script = format!(
        "touch {}; while true; do sleep 0.05; done",
        marker.display()
    );

    let probe_pid = {
        let command = TokioCommand::default();
        let id = ServiceId("reaped".to_string());
        command
            .spawn_service(
                &id,
                &sh(&script),
                &ServiceOpts {
                    retry: Retry {
                        count: 50,
                        wait: Duration::from_millis(20),
                    },
                    check_status: ReadinessCheck::CommandSucceeds {
                        command: sh(&format!("test -f {}", marker.display())),
                    },
                },
            )
            .await
            .expect("ready");
        command
            .service_pid(&id)
            .expect("a spawned service has a pid")
    };

    // Give the reaper a moment; process teardown is not instantaneous.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(
        !process_is_alive(probe_pid),
        "pid {probe_pid} outlived the command that spawned it"
    );
}

#[tokio::test]
async fn dropping_the_command_reaps_the_whole_tree_too() {
    // `kill_on_drop` reaps the direct child and stops there, so an abandoned capability is the same orphan
    // by another route: a crashed or dropped runner leaves the tree with no handle anywhere.
    let directory = tempfile::tempdir().expect("temp dir");
    let pidfile = directory.path().join("grandchild.pid");

    let grandchild = {
        let command = TokioCommand::default();
        command
            .spawn_service(
                &ServiceId("dropped-tree".to_string()),
                &sh(&format!(
                    "sleep 300 & echo $! > {0}.tmp; mv {0}.tmp {0}; wait",
                    pidfile.display()
                )),
                &ServiceOpts {
                    retry: Retry {
                        count: 50,
                        wait: Duration::from_millis(20),
                    },
                    check_status: ReadinessCheck::CommandSucceeds {
                        command: sh(&format!("test -s {}", pidfile.display())),
                    },
                },
            )
            .await
            .expect("the service becomes ready");
        std::fs::read_to_string(&pidfile)
            .expect("the pid file is readable")
            .trim()
            .parse::<u32>()
            .expect("a pid was written")
    };

    tokio::time::sleep(Duration::from_millis(200)).await;

    assert!(
        !process_is_alive(grandchild),
        "pid {grandchild} outlived the command that started it"
    );
}

/// The readiness question a spawned API service is polled with, addressed at `socket`.
///
/// A helper rather than four literals: the headers are the connection's business and none of these
/// cases is about them, so what a reader sees here is the one thing that differs — the address.
fn pinging(socket: &str) -> ReadinessCheck {
    ReadinessCheck::ApiAnswers {
        endpoint: cdc_runtime::capabilities::http::Endpoint::UnixSocket(socket.to_string()),
        headers: Vec::new(),
    }
}

/// Bind `socket` and answer exactly one `/_ping` the way an engine does.
///
/// One is enough: readiness stops asking the moment it is satisfied, and a server that outlived the
/// check would keep a task alive past the end of the test.
async fn answer_one_ping(socket: &std::path::Path) {
    let listener = tokio::net::UnixListener::bind(socket).expect("the fixture binds");
    answer_one(listener, "200 OK", "OK").await;
}

/// The same, saying whatever the case is about, on a socket the CALLER has already bound.
///
/// Bound by the caller because a test with one poll in its budget races the bind otherwise: the probe
/// finds nothing listening, reports not-ready for the wrong reason, and passes whatever the verdict
/// below it is. That is exactly how a mutant of that verdict survived a test written for it.
async fn answer_one(listener: tokio::net::UnixListener, status: &str, body: &str) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let Ok((mut stream, _)) = listener.accept().await else {
        return;
    };
    let mut request = [0u8; 512];
    let _ = stream.read(&mut request).await;
    let _ = stream
        .write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await;
}

/// A directory under `/tmp`: a unix socket path is capped near 104 bytes, and `make mutation` repoints
/// `TMPDIR` deep inside `target/`.
fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("cdc-cmd-")
        .tempdir_in("/tmp")
        .expect("a short temp dir")
}

fn process_is_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

#[tokio::test]
async fn an_empty_readiness_address_is_never_ready() {
    // Detection not having resolved an address is a real state, and connecting to "" is not a question a
    // platform can answer — so it is answered here, as not ready, rather than as a syscall error.
    let command = TokioCommand::default();
    let id = ServiceId("nowhere".to_string());

    let outcome = command
        .spawn_service(
            &id,
            &sh("sleep 30"),
            &ServiceOpts {
                retry: Retry {
                    count: 2,
                    wait: Duration::from_millis(10),
                },
                check_status: pinging(""),
            },
        )
        .await;

    assert!(
        matches!(outcome, Err(CommandError::NotReady { count: 2, .. })),
        "got {outcome:?}"
    );
}
