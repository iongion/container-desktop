//! The real exec capability, on tokio.
//!
//! `src-tauri/src/host/{command,shell,process}.rs` is prior art and was read for the platform edge
//! cases already discovered — it is not imported. That code is Tauri-coupled, and the two may
//! converge later as its own decision.
//!
//! Secrets: `command.input` is written to the child and never logged. Every log line here carries
//! the launcher and its args only, which is where the design's rule is enforced.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, PoisonError};

use async_trait::async_trait;
use cdc_runtime::capabilities::command::{Chunk, Command, CommandError, StdioSource, StreamHandle};
use cdc_runtime::capabilities::command::{
    CommandExecutionResult, HostCommand, ReadinessCheck, ServiceId, ServiceOpts,
};
use cdc_runtime::capabilities::http::{Endpoint, Http, HttpHeader, HttpRequest};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::mpsc;

#[derive(Debug, Default)]
pub struct TokioCommand {
    /// Services this capability is holding open. Dropping it kills them all — the orphan —
    /// because every child is spawned with `kill_on_drop`, which is what `build` sets and what
    /// `dropping_the_command_reaps_its_services` pins. A second teardown in a `Drop` here would read
    /// as the thing that reaps them while doing nothing that is not already done.
    children: Mutex<HashMap<ServiceId, Child>>,
}

impl TokioCommand {
    /// The service table, even if a thread panicked while holding it.
    ///
    /// A poisoned lock must not stop a teardown: what is behind it is a map of LIVE children, and
    /// refusing to look at it is exactly how the orphan the design names gets left behind.
    fn children(&self) -> std::sync::MutexGuard<'_, HashMap<ServiceId, Child>> {
        self.children.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The pid of a running service. For tests and for a status view; nothing decides on it.
    pub fn service_pid(&self, id: &ServiceId) -> Option<u32> {
        self.children().get(id)?.id()
    }

    fn build(command: &HostCommand) -> tokio::process::Command {
        let mut builder = tokio::process::Command::new(&command.launcher);
        builder
            .args(&command.args)
            .stdin(if command.input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &command.cwd {
            builder.current_dir(cwd);
        }
        for (key, value) in &command.env {
            builder.env(key, value);
        }
        // Its own process group, so a later `kill` can take the whole tree rather than just the
        // shell that spawned it. See the note on `kill`.
        #[cfg(unix)]
        builder.process_group(0);
        builder
    }

    fn spawn(command: &HostCommand) -> Result<Child, CommandError> {
        tracing::debug!(launcher = %command.launcher, args = ?command.args, "exec");
        Self::build(command)
            .spawn()
            .map_err(|source| CommandError::Spawn {
                launcher: command.launcher.clone(),
                source,
            })
    }
}

/// Write `command.input`, when there is one, and close the pipe.
///
/// It takes the whole command rather than the string because `build` pipes stdin only when the
/// command carries input: asking for the pipe separately would mean handling a "there is input but no
/// pipe" case that cannot happen.
async fn write_input(child: &mut Child, command: &HostCommand) -> Result<(), CommandError> {
    let (Some(input), Some(mut pipe)) = (&command.input, child.stdin.take()) else {
        return Ok(());
    };
    pipe.write_all(input.as_bytes())
        .await
        .context("writing stdin")?;
    // Dropping the pipe closes it; `cat` and `login --password-stdin` both block until it does.
    drop(pipe);
    Ok(())
}

/// `?` with the operation named.
///
/// One conversion rather than the four identical `map_err` closures it replaces — the operation is
/// the whole value of `CommandError::Io`, and four copies is four chances to name the wrong one.
trait IoContext<T> {
    fn context(self, operation: &'static str) -> Result<T, CommandError>;
}

impl<T> IoContext<T> for std::io::Result<T> {
    fn context(self, operation: &'static str) -> Result<T, CommandError> {
        self.map_err(|source| CommandError::Io { operation, source })
    }
}

#[async_trait]
impl Command for TokioCommand {
    async fn run(&self, command: &HostCommand) -> Result<CommandExecutionResult, CommandError> {
        let mut child = TokioCommand::spawn(command)?;
        write_input(&mut child, command).await?;

        let finished = match command.timeout {
            Some(timeout) => {
                // Read before the await, because `wait_with_output` consumes the child and the group
                // still has to be reachable afterwards.
                let group = child.id();
                match tokio::time::timeout(timeout, child.wait_with_output()).await {
                    Ok(finished) => finished,
                    Err(_) => {
                        // `kill_on_drop` takes the direct child as the future is dropped, and stops
                        // there. Every `ssh` here is bounded, so a timeout is a routine path out of a
                        // connection attempt and must not be the one that leaks a tree.
                        terminate_group(group);
                        return Err(CommandError::Timeout {
                            launcher: command.launcher.clone(),
                            timeout,
                        });
                    }
                }
            }
            None => child.wait_with_output().await,
        };

        let output = finished.context("waiting for the process")?;
        Ok(CommandExecutionResult {
            code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        })
    }

    async fn stream(&self, command: &HostCommand) -> Result<Box<dyn StreamHandle>, CommandError> {
        let mut child = TokioCommand::spawn(command)?;
        write_input(&mut child, command).await?;

        let (sender, receiver) = mpsc::channel(64);
        let stdout = child.stdout.take().expect("`build` pipes stdout");
        let stderr = child.stderr.take().expect("`build` pipes stderr");
        forward(stdout, StdioSource::Stdout, sender.clone());
        forward(stderr, StdioSource::Stderr, sender);

        Ok(Box::new(TokioStream {
            child: Some(child),
            receiver,
        }))
    }

    async fn spawn_service(
        &self,
        id: &ServiceId,
        command: &HostCommand,
        opts: &ServiceOpts,
    ) -> Result<(), CommandError> {
        let child = TokioCommand::spawn(command)?;
        self.children().insert(id.clone(), child);

        for attempt in 1..=opts.retry.count {
            if self.is_ready(&opts.check_status).await {
                tracing::debug!(service = %id.0, attempt, "service is ready");
                return Ok(());
            }
            tokio::time::sleep(opts.retry.wait).await;
        }

        // Exhausted: tear the process down rather than leaving something running that nobody is
        // holding a handle to.
        let _ = self.kill(id).await;
        Err(CommandError::NotReady {
            launcher: command.launcher.clone(),
            count: opts.retry.count,
        })
    }

    /// Terminate a service, and everything it started.
    ///
    /// The GROUP first, then the child. Killing only the direct child leaves anything IT started
    /// reparented to init, where no handle to it exists anywhere — the orphan. A plain
    /// `ssh -NL` turns out to fork nothing (verified live), but a `ProxyJump` alias makes it spawn a
    /// local `ssh -W`, so the tree is reachable from nothing but the user's own `~/.ssh/config`.
    /// `start_kill` stays because it is what makes the child reapable by the `wait` below — `killpg`
    /// signals, it does not reap.
    async fn kill(&self, id: &ServiceId) -> Result<(), CommandError> {
        let mut child = self
            .children()
            .remove(id)
            .ok_or_else(|| CommandError::UnknownService(id.clone()))?;
        terminate_group(child.id());
        child.start_kill().context("killing the service")?;
        let _ = child.wait().await;
        Ok(())
    }
}

impl Drop for TokioCommand {
    /// `kill_on_drop` reaps each direct child as the map drops, and that is not enough: an abandoned
    /// capability is the same orphan by another route — a panicked or dropped runner whose tree nothing is
    /// left holding. Signalling the group here is the only thing that can still reach it, and it is
    /// sync, which is why a `Drop` can do it at all.
    fn drop(&mut self) {
        for child in self.children().values() {
            terminate_group(child.id());
        }
    }
}

/// SIGKILL a child's whole process group.
///
/// [`TokioCommand::build`] made the child a group LEADER (`process_group(0)`), so its pid IS the group
/// id and this reaches exactly the tree it started, nothing else. It takes the pid rather than the
/// `Child` because one call site no longer HAS the child — `wait_with_output` consumes it, and the
/// group has to outlive that.
///
/// Every failure is ignored on purpose: an absent or untranslatable pid and an already-dead group
/// (`ESRCH`) all mean the same thing — nothing left to kill — and none is worth failing a teardown
/// over.
///
/// SIGKILL rather than SIGTERM, matching what `start_kill` sends the direct child: one signal for the
/// whole tree, and no escalation timer to get wrong. SIGTERM would NOT buy the obvious thing — `ssh`
/// leaves the socket its forward bound in place either way (verified live), so a graceful signal cleans
/// up nothing here. What the leftover file costs is a readiness probe that passes before the next
/// forward binds, and that is `ReadinessCheck::PathExists`'s to fix, not this signal's.
///
/// Called only on the ABNORMAL exits — a kill, a timeout, an abandoned stream, a dropped capability. A
/// command that ran to completion and chose to leave something running behind it is not an orphan.
#[cfg(unix)]
fn terminate_group(pid: Option<u32>) {
    let Some(group) = pid.and_then(|pid| i32::try_from(pid).ok()) else {
        return;
    };
    let _ = nix::sys::signal::killpg(nix::unistd::Pid::from_raw(group), nix::sys::signal::SIGKILL);
}

/// Windows has no process group to signal, and `kill_on_drop` plus `start_kill` are the whole story
/// there. Unverified.
#[cfg(not(unix))]
fn terminate_group(_pid: Option<u32>) {}

impl TokioCommand {
    /// Whether the thing just spawned is up yet.
    ///
    /// A method rather than a free function because one of the two checks is itself a COMMAND: a
    /// service started inside a scope binds its socket in the guest, and asking the scope is the only
    /// way to see it. A refusal to spawn the probe counts as "not ready" — the same answer as a probe
    /// that ran and said no, because neither is evidence that anything is listening.
    async fn is_ready(&self, check: &ReadinessCheck) -> bool {
        match check {
            ReadinessCheck::ApiAnswers { endpoint, headers } => {
                engine_answers(endpoint, headers).await
            }
            ReadinessCheck::CommandSucceeds { command } => self
                .run(command)
                .await
                .is_ok_and(|outcome| outcome.success()),
        }
    }
}

/// Whether the ENGINE answers over `endpoint` — `isApiRunning`, which is what both of the oracle's
/// spawners poll while they wait for a service to come up.
///
/// **A request rather than a connect, and that is the point of the variant.** A connect proves the
/// address ACCEPTS; `ssh -NL` accepts locally with its channel refused by the remote, and a
/// `podman system service` binds its socket before it is serving. Both of those are a connection
/// reported `ready` over an address that answers `API_UNREACHABLE` to the very next request.
///
/// Any failure counts as not-yet — a refusal, a timeout, a reply that is not `2xx`, or a body that is
/// not `OK`. None of them is evidence that the engine is up, and the caller is a poll: whatever this
/// is wrong about now, it will be asked again in a moment.
///
/// A pipe whose every instance is taken is a HEALTHY engine under load, and this waits it out rather
/// than calling it dead — that rule lives in `http::open_named_pipe` and is shared with every other
/// request, which is one more thing this variant no longer has its own copy of.
async fn engine_answers(endpoint: &Endpoint, headers: &[HttpHeader]) -> bool {
    let mut request = HttpRequest::ping(endpoint.clone());
    request.headers = headers.to_vec();
    crate::http::TokioHttp
        .request(&request)
        .await
        .is_ok_and(|response| response.ok() && response.body.trim() == "OK")
}

/// Pump one pipe into the chunk channel, line by line.
fn forward<R>(pipe: R, source: StdioSource, sender: mpsc::Sender<Chunk>)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(pipe).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if sender
                .send(Chunk {
                    source,
                    data: format!("{line}\n"),
                })
                .await
                .is_err()
            {
                return;
            }
        }
    });
}

struct TokioStream {
    child: Option<Child>,
    receiver: mpsc::Receiver<Chunk>,
}

impl Drop for TokioStream {
    /// An abandoned stream is the same orphan as an abandoned service: `kill_on_drop` reaps the direct
    /// child and leaves its tree. A stream that was WAITED for has no child left here, and that is the
    /// normal exit — nothing is killed on it.
    fn drop(&mut self) {
        terminate_group(self.child.as_ref().and_then(Child::id));
    }
}

#[async_trait]
impl StreamHandle for TokioStream {
    async fn next_chunk(&mut self) -> Option<Chunk> {
        self.receiver.recv().await
    }

    async fn wait(&mut self) -> Result<CommandExecutionResult, CommandError> {
        let Some(mut child) = self.child.take() else {
            return Err(CommandError::Io {
                operation: "waiting twice for the same stream",
                source: std::io::Error::other("already waited"),
            });
        };
        let status = child.wait().await.context("waiting for the process")?;
        Ok(CommandExecutionResult {
            code: status.code().unwrap_or(-1),
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}
