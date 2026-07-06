// The remote-connection data plane — the Rust side of the SSH/WSL dial-stdio bridges (ports
// src/platform/node/exec/{ssh-transport,ssh-stdio-bridge,wsl-relay}.ts). Owned by Rust so a webview reload never
// tears a live connection down.
//
// It is deliberately ENGINE-AGNOSTIC: the shared JS builders (buildSSHArgs / buildSSHTunnelArgs /
// buildWSLDialStdioArgs) stay the single source of truth for the argv and hand this layer a BridgeSpec of just
// { kind, key, localAddress, launcher, argv }. Two kinds cover every remote:
//   - "stdio": a local listener (Unix socket on Linux/macOS, named pipe on Windows) that, per incoming
//     connection, spawns `launcher argv` (e.g. `ssh <alias> -- docker system dial-stdio`, or `wsl.exe … dial-stdio`)
//     and shuttles RAW bytes both ways — the dial-stdio bridge. No TCP, nothing decoded.
//   - "tunnel": a long-lived `ssh -NL <local>:<remote> <alias>` child; the local socket it forwards is dialed
//     once it appears.
// The engine-API client (proxy.rs, reqwest) then dials `localAddress`. Bridges are cached by `key` (the remote
// relay for SSH, the connection id for WSL) so a reconnect reuses the live one.

use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use serde::Deserialize;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

// Built by the JS binding (src/platform/tauri/exec/proxy-request.ts buildBridgeSpec); camelCase over the invoke boundary.
#[derive(Deserialize, Clone)]
pub struct BridgeSpec {
    kind: String,
    key: String,
    #[serde(rename = "localAddress")]
    local_address: String,
    launcher: String,
    argv: Vec<String>,
}

enum BridgeKind {
    // The accept loop for a "stdio" listener (aborting it stops accepting new connections).
    Stdio(JoinHandle<()>),
    // The long-lived `ssh -NL` child for a "tunnel".
    Tunnel(tokio::process::Child),
}

struct BridgeEntry {
    // Unix only: the socket path to unlink on teardown (see stop_bridge). A Windows named pipe is not a
    // filesystem entry, so there is nothing to remove and the field is cfg'd out rather than left dead.
    #[cfg(unix)]
    local_address: String,
    kind: BridgeKind,
}

#[derive(Default)]
pub struct BridgeState {
    // Keyed by BridgeSpec.key. A tokio Mutex (not std) because ensure() holds it across the tunnel's await to
    // serialize concurrent first-requests for the same connection (avoids a double-bind race).
    bridges: Mutex<HashMap<String, BridgeEntry>>,
}

/// Ensure the connection's bridge is up and return the LOCAL socket/pipe path proxy.rs should dial. Reuses a
/// cached bridge (reconnect after a webview reload hits this path). Errors surface to the JS binding, which
/// shapes them into a __proxyError envelope.
pub async fn ensure_bridge(spec: &BridgeSpec, state: &BridgeState) -> Result<String, String> {
    if spec.local_address.is_empty() {
        return Err("bridge localAddress is empty (the remote connection has no local forward socket)".into());
    }
    let mut bridges = state.bridges.lock().await;
    if bridges.contains_key(&spec.key) {
        return Ok(spec.local_address.clone());
    }
    let entry = match spec.kind.as_str() {
        "stdio" => start_stdio_bridge(spec)?,
        "tunnel" => start_tunnel(spec).await?,
        other => return Err(format!("unknown bridge kind: {other}")),
    };
    bridges.insert(spec.key.clone(), entry);
    Ok(spec.local_address.clone())
}

/// StopConnectionServices — tear down a connection's bridge by cache key (relay for SSH, connection id for
/// WSL). The JS binding calls it for both candidate keys; the non-matching one is a no-op.
#[tauri::command]
pub async fn proxy_bridge_stop(key: String, state: State<'_, BridgeState>) -> Result<(), ()> {
    stop_bridge(&key, &state).await;
    Ok(())
}

/// Tear a connection's bridge down (StopConnectionServices / disconnect). No-op if absent.
pub async fn stop_bridge(key: &str, state: &BridgeState) {
    let entry = state.bridges.lock().await.remove(key);
    if let Some(entry) = entry {
        match entry.kind {
            BridgeKind::Stdio(task) => task.abort(),
            BridgeKind::Tunnel(mut child) => {
                let _ = child.kill().await;
            }
        }
        #[cfg(unix)]
        {
            let _ = std::fs::remove_file(&entry.local_address);
        }
    }
}

#[cfg(unix)]
fn start_stdio_bridge(spec: &BridgeSpec) -> Result<BridgeEntry, String> {
    // A stale Unix socket from a crashed run makes bind() fail with EADDRINUSE — remove it first (a Windows
    // pipe path is not a filesystem entry, so this is unix-only).
    let _ = std::fs::remove_file(&spec.local_address);
    let listener = tokio::net::UnixListener::bind(&spec.local_address).map_err(|e| e.to_string())?;
    let launcher = spec.launcher.clone();
    let argv = spec.argv.clone();
    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let launcher = launcher.clone();
                    let argv = argv.clone();
                    tokio::spawn(bridge_unix_connection(stream, launcher, argv));
                }
                Err(_) => break,
            }
        }
    });
    Ok(BridgeEntry { local_address: spec.local_address.clone(), kind: BridgeKind::Stdio(task) })
}

// Windows: the local end is a named pipe (Windows Docker over SSH, and every WSL relay). Named pipes are
// one-server-instance-per-client, so pre-create the next instance before handing off each connection.
#[cfg(windows)]
fn start_stdio_bridge(spec: &BridgeSpec) -> Result<BridgeEntry, String> {
    use tokio::net::windows::named_pipe::ServerOptions;
    let pipe_name = spec.local_address.clone();
    let launcher = spec.launcher.clone();
    let argv = spec.argv.clone();
    // Create the first instance up front so the pipe exists before we return (a client can connect at once).
    let first = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_name)
        .map_err(|e| e.to_string())?;
    let task = tokio::spawn(async move {
        let mut server = first;
        loop {
            if server.connect().await.is_err() {
                break;
            }
            // Pre-create the NEXT instance so a subsequent client isn't refused while this one is bridged.
            let next = match ServerOptions::new().create(&pipe_name) {
                Ok(next) => next,
                Err(_) => break,
            };
            let connected = std::mem::replace(&mut server, next);
            let launcher = launcher.clone();
            let argv = argv.clone();
            tokio::spawn(bridge_named_pipe_connection(connected, launcher, argv));
        }
    });
    Ok(BridgeEntry { kind: BridgeKind::Stdio(task) })
}

#[cfg(windows)]
async fn bridge_named_pipe_connection(
    pipe: tokio::net::windows::named_pipe::NamedPipeServer,
    launcher: String,
    argv: Vec<String>,
) {
    let mut cmd = tokio::process::Command::new(&launcher);
    cmd.args(&argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // Per-connection ssh/wsl relay must not flash a console window on Windows.
    crate::spawn_hidden::no_window_tokio(&mut cmd);
    let spawned = cmd.spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => return,
    };
    let (Some(child_stdin), Some(child_stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill().await;
        return;
    };
    let (pipe_read, pipe_write) = tokio::io::split(pipe);
    // Drop child_stdin on the client-side EOF (a pipe closes by dropping the fd, not shutdown); half-close the
    // pipe's write half on the daemon-side EOF. Mirrors the Unix handler.
    let up = async move {
        let mut pipe_read = pipe_read;
        let mut child_stdin = child_stdin;
        let _ = tokio::io::copy(&mut pipe_read, &mut child_stdin).await;
        drop(child_stdin);
    };
    let down = async move {
        let mut child_stdout = child_stdout;
        let mut pipe_write = pipe_write;
        let _ = tokio::io::copy(&mut child_stdout, &mut pipe_write).await;
        let _ = pipe_write.shutdown().await;
    };
    tokio::join!(up, down);
    let _ = child.kill().await;
}

// Per incoming local connection: spawn `launcher argv`, then pipe RAW bytes socket↔child-stdio in both
// directions until each side hits EOF (mirrors Node's `.pipe()` half-close forwarding). Nothing is decoded.
#[cfg(unix)]
async fn bridge_unix_connection(stream: tokio::net::UnixStream, launcher: String, argv: Vec<String>) {
    let spawned = tokio::process::Command::new(&launcher)
        .args(&argv)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => return,
    };
    let (Some(child_stdin), Some(child_stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill().await;
        return;
    };
    let (sock_read, sock_write) = stream.into_split();
    // client → daemon; when the socket read hits EOF (client done) DROP the child's stdin — a pipe signals EOF
    // only by closing the write fd (shutdown() is a no-op on a pipe), so the daemon sees the request end.
    let up = async move {
        let mut sock_read = sock_read;
        let mut child_stdin = child_stdin;
        let _ = tokio::io::copy(&mut sock_read, &mut child_stdin).await;
        drop(child_stdin);
    };
    // daemon → client; on EOF (or a write to a closed socket) half-close the socket (a socket DOES honor
    // shutdown). A live stream (/events, logs?follow) keeps this running until the client disconnects.
    let down = async move {
        let mut child_stdout = child_stdout;
        let mut sock_write = sock_write;
        let _ = tokio::io::copy(&mut child_stdout, &mut sock_write).await;
        let _ = sock_write.shutdown().await;
    };
    tokio::join!(up, down);
    let _ = child.kill().await;
}

async fn start_tunnel(spec: &BridgeSpec) -> Result<BridgeEntry, String> {
    #[cfg(unix)]
    let _ = std::fs::remove_file(&spec.local_address);
    let mut cmd = tokio::process::Command::new(&spec.launcher);
    cmd.args(&spec.argv)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // The long-lived `ssh -NL` child must not flash a console window on Windows.
    crate::spawn_hidden::no_window_tokio(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    // `ssh -NL` binds the local forward socket only after the connection + forward are established — poll until
    // it appears (~5s), failing fast if the ssh child exits first (auth/host error).
    for _ in 0..50 {
        if std::path::Path::new(&spec.local_address).exists() {
            return Ok(BridgeEntry {
                #[cfg(unix)]
                local_address: spec.local_address.clone(),
                kind: BridgeKind::Tunnel(child),
            });
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = child.kill().await;
    Err("ssh -NL tunnel: local forward socket did not appear".into())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Verify the generic stdio bridge end-to-end WITHOUT ssh/docker: `cat` stands in for the dial-stdio process
    // (it echoes stdin→stdout), so bytes written to the local socket must come back — proving accept → spawn →
    // raw bidirectional byte-shuttle + half-close teardown. Also covers cache reuse + stop_bridge cleanup.
    #[tokio::test]
    async fn stdio_bridge_round_trips_bytes_through_the_spawned_process() {
        let state = BridgeState::default();
        let sock = std::env::temp_dir().join(format!("cd-bridge-test-{}.sock", std::process::id()));
        let sock_str = sock.to_string_lossy().into_owned();
        let spec = BridgeSpec {
            kind: "stdio".into(),
            key: "conn-1".into(),
            local_address: sock_str.clone(),
            launcher: "cat".into(),
            argv: vec![],
        };

        assert_eq!(ensure_bridge(&spec, &state).await.unwrap(), sock_str);
        // Same key ⇒ reuse (no re-bind); would error with EADDRINUSE if it rebound.
        assert_eq!(ensure_bridge(&spec, &state).await.unwrap(), sock_str);

        let mut client = tokio::net::UnixStream::connect(&sock_str).await.unwrap();
        client.write_all(b"hello dial-stdio").await.unwrap();
        client.shutdown().await.unwrap(); // half-close → cat sees EOF, flushes, exits
        let mut echoed = Vec::new();
        client.read_to_end(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"hello dial-stdio");

        stop_bridge("conn-1", &state).await;
        assert!(!std::path::Path::new(&sock_str).exists()); // teardown removed the socket
    }
}
