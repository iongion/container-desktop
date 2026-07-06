// The process port — the Rust side of ICommand's ExecuteStreaming + ExecuteAsBackgroundService (and the
// process registry Kill operates on). Mirrors the shape of proxy.rs: a spawned child streams its raw
// stdout/stderr/exit/close/error events over a Tauri Channel, and a registry lets the JS side kill it by a
// generated processId token (the renderer can no longer hold a Node ChildProcess).
//
// ONE command — process_spawn — backs BOTH ExecuteStreaming and ExecuteAsBackgroundService; the difference
// is entirely JS-side (src/platform/tauri/exec/commander.ts): ExecuteStreaming re-synthesizes a StreamHandle, while
// ExecuteAsBackgroundService runs the readiness/retry loop (opts.checkStatus is a JS closure — a ProxyRequest
// ping — so the loop CANNOT move to Rust). Rust only spawns, streams, and kills.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::async_runtime;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::AsyncReadExt;
use tokio::sync::mpsc;

// Input

#[derive(Deserialize)]
pub struct SpawnPayload {
    launcher: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    // Overrides layered onto the inherited parent env (matches the TS-side processSpawnPayload merge).
    env: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
pub struct KillPayload {
    #[serde(rename = "processId")]
    process_id: String,
    signal: Option<String>,
}

// Output

#[derive(Serialize)]
pub struct SpawnResult {
    #[serde(rename = "processId")]
    process_id: String,
    pid: Option<u32>,
}

// Pushed over the Channel; the JS binding maps it 1:1 onto the StreamHandle/service emitter events:
// data → {from,data} · exit → {code,signal} · close → {code} · error → {type,error}.
#[derive(Clone, Serialize)]
pub(crate) struct ProcessEvent {
    #[serde(rename = "processId")]
    process_id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signal: Option<String>,
    #[serde(rename = "errorType", skip_serializing_if = "Option::is_none")]
    error_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}
impl ProcessEvent {
    fn base(process_id: &str, event_type: &str) -> Self {
        Self {
            process_id: process_id.into(),
            event_type: event_type.into(),
            from: None,
            data: None,
            code: None,
            signal: None,
            error_type: None,
            error: None,
        }
    }
    fn data(process_id: &str, from: &str, data: String) -> Self {
        let mut event = Self::base(process_id, "data");
        event.from = Some(from.into());
        event.data = Some(data);
        event
    }
    fn exit(process_id: &str, code: Option<i32>, signal: Option<String>) -> Self {
        let mut event = Self::base(process_id, "exit");
        event.code = code;
        event.signal = signal;
        event
    }
    fn close(process_id: &str, code: Option<i32>) -> Self {
        let mut event = Self::base(process_id, "close");
        event.code = code;
        event
    }
}

// State: the live-process registry (kill by processId token)

type Registry = Arc<Mutex<HashMap<String, mpsc::UnboundedSender<i32>>>>;

#[derive(Default)]
pub struct ProcessState {
    children: Registry,
    counter: AtomicU64,
}
impl ProcessState {
    fn next_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed) + 1;
        format!("proc-{n}")
    }
    fn register(&self, id: String, kill_tx: mpsc::UnboundedSender<i32>) {
        self.children.lock().unwrap().insert(id, kill_tx);
    }
    // Deliver a signal number to the process's pump task (which performs the platform-specific kill). A no-op
    // if the process already exited (its entry self-removed).
    fn signal(&self, id: &str, sig: i32) {
        if let Some(tx) = self.children.lock().unwrap().get(id) {
            let _ = tx.send(sig);
        }
    }
}

// Commands

/// Spawn a child, stream its stdout/stderr/exit/close events over the Channel, and register it for kill.
/// Returns the processId token + pid immediately (before the process finishes).
#[tauri::command]
pub async fn process_spawn(
    payload: SpawnPayload,
    channel: Channel<ProcessEvent>,
    state: State<'_, ProcessState>,
) -> Result<SpawnResult, String> {
    let mut command = tokio::process::Command::new(&payload.launcher);
    command.args(&payload.args);
    if let Some(cwd) = payload.cwd.as_deref() {
        if !cwd.is_empty() {
            command.current_dir(cwd);
        }
    }
    if let Some(env) = &payload.env {
        for (key, value) in env {
            command.env(key, value);
        }
    }
    // Streamed children must not flash a console window on Windows.
    crate::spawn_hidden::no_window_tokio(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Safety net: if the pump task is dropped without a clean exit, the child is SIGKILLed.
        .kill_on_drop(true);
    let child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let process_id = state.next_id();
    let (kill_tx, kill_rx) = mpsc::unbounded_channel::<i32>();
    state.register(process_id.clone(), kill_tx);
    async_runtime::spawn(run_process(
        child,
        kill_rx,
        channel,
        process_id.clone(),
        pid.unwrap_or(0),
        state.children.clone(),
    ));
    Ok(SpawnResult { process_id, pid })
}

/// Kill a registered process by token (routes BOTH Command.Kill(child) and the wrapper child.kill()).
/// Signal defaults to SIGTERM; SIGKILL/SIGINT accepted. No-op if the process already exited.
#[tauri::command]
pub fn process_kill(payload: KillPayload, state: State<'_, ProcessState>) {
    state.signal(&payload.process_id, parse_signal(payload.signal.as_deref()));
}

// Pump

async fn run_process(
    mut child: tokio::process::Child,
    mut kill_rx: mpsc::UnboundedReceiver<i32>,
    channel: Channel<ProcessEvent>,
    process_id: String,
    pid: u32,
    registry: Registry,
) {
    if let Some(stdout) = child.stdout.take() {
        async_runtime::spawn(drain(stdout, "stdout", channel.clone(), process_id.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        async_runtime::spawn(drain(stderr, "stderr", channel.clone(), process_id.clone()));
    }
    // Wait for exit while remaining killable: a kill signal is delivered by pid so it never borrows `child`
    // (which child.wait() holds), keeping both select arms conflict-free.
    let status = loop {
        tokio::select! {
            status = child.wait() => break status,
            maybe_sig = kill_rx.recv() => {
                if let Some(sig) = maybe_sig {
                    deliver_signal(pid, sig);
                }
            }
        }
    };
    let code = status.ok().and_then(|status| status.code());
    let _ = channel.send(ProcessEvent::exit(&process_id, code, None));
    let _ = channel.send(ProcessEvent::close(&process_id, code));
    registry.lock().unwrap().remove(&process_id);
}

async fn drain<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    from: &'static str,
    channel: Channel<ProcessEvent>,
    process_id: String,
) {
    // Raw chunks (not line-split) to mirror Node's stream "data" — preserves \r progress updates in build
    // output. utf8-lossy matches the current string-based contract.
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let text = String::from_utf8_lossy(&buffer[..n]).into_owned();
                let _ = channel.send(ProcessEvent::data(&process_id, from, text));
            }
        }
    }
}

#[cfg(unix)]
fn deliver_signal(pid: u32, sig: i32) {
    // SAFETY: kill() with a valid pid + signal number is sound; ESRCH (already-reaped) is ignored.
    unsafe {
        libc::kill(pid as i32, sig);
    }
}
#[cfg(windows)]
fn deliver_signal(pid: u32, _sig: i32) {
    // No POSIX signals on Windows; terminate the process tree by pid (tokio's kill_on_drop is the backstop).
    let mut cmd = std::process::Command::new("taskkill");
    cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
    crate::spawn_hidden::no_window_std(&mut cmd);
    let _ = cmd.spawn();
}

// Map a signal name/number to its POSIX number (default SIGTERM). On Windows the number is ignored.
fn parse_signal(signal: Option<&str>) -> i32 {
    match signal {
        Some("SIGKILL") | Some("KILL") | Some("9") => 9,
        Some("SIGINT") | Some("INT") | Some("2") => 2,
        Some(other) => other.parse::<i32>().unwrap_or(15),
        None => 15,
    }
}
