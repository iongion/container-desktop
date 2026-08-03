// Command (process exec) host port — the buffered process primitive used by src/platform/tauri/exec/commander.ts.
// Streaming process I/O lives in process.rs; this is the single generic run-to-completion exec.

use serde::Serialize;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

// Mirrors CommandExecutionResult (env/Types.ts), consumed by the Tauri Command.Execute facade.
#[derive(Serialize)]
pub struct CommandExecutionResult {
    pub pid: Option<u32>,
    pub code: Option<i32>,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
}

/// Options for run_command — the single generic exec reused across the ICommand surface.
pub struct ExecOptions {
    pub cwd: Option<String>,
    pub env: HashMap<String, String>,
    /// true → empty the inherited environment BEFORE applying `env` (sandbox isolation); false → layer `env`
    /// onto the inherited environment (Command.Execute's buildSpawnEnv merge semantics).
    pub clear_env: bool,
    /// Wall-clock limit; None or 0 means no limit. On timeout the child is killed and a failed result returned.
    pub timeout_ms: Option<u64>,
    /// Piped to the child's stdin (registry `login --password-stdin`, `cat > ca.crt`) so secrets never appear in
    /// argv or logs. None/empty ⇒ no stdin, identical to the prior behavior.
    pub input: Option<String>,
}

/// Spawn `program args…` to completion and capture stdout/stderr/exit — the ONE place a child process is run
/// for the exec surface. The single command_execute drives both env models through here: isolate=false layers
/// onto the inherited env (Command.Execute), isolate=true clears it + applies a timeout (the sandbox).
/// kill_on_drop avoids orphaning the child if the awaiting IPC future is dropped (webview reload / cancellation).
/// Async so a slow CLI never blocks the webview's IPC thread.
pub async fn run_command(
    program: &str,
    args: &[String],
    options: ExecOptions,
) -> CommandExecutionResult {
    let command = format!("{} {}", program, args.join(" "));
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    if let Some(dir) = options.cwd.as_deref() {
        if !dir.is_empty() {
            cmd.current_dir(dir);
        }
    }
    if options.clear_env {
        cmd.env_clear();
    }
    for (key, value) in &options.env {
        cmd.env(key, value);
    }
    cmd.kill_on_drop(true);
    // A GUI app must not flash a console window per engine CLI call on Windows.
    crate::spawn_hidden::no_window_tokio(&mut cmd);

    // When stdin input is provided (secret-bearing: registry `login --password-stdin`, `cat > ca.crt`), pipe it to
    // the child and collect output via spawn + wait_with_output; the secret reaches the program through the pipe,
    // never argv or logs. Without input this is exactly the prior cmd.output() path.
    let stdin_input = options.input.clone().unwrap_or_default();
    let run = async {
        if stdin_input.is_empty() {
            cmd.output().await
        } else {
            cmd.stdin(Stdio::piped());
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::piped());
            let mut child = cmd.spawn()?;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(stdin_input.as_bytes()).await?;
                stdin.shutdown().await?;
            }
            child.wait_with_output().await
        }
    };
    let outcome = match options.timeout_ms {
        Some(ms) if ms > 0 => {
            match tokio::time::timeout(std::time::Duration::from_millis(ms), run).await {
                Ok(result) => result,
                Err(_) => {
                    return CommandExecutionResult {
                        pid: None,
                        code: None,
                        success: false,
                        stdout: String::new(),
                        stderr: format!("command timed out after {ms}ms"),
                        command,
                    };
                }
            }
        }
        _ => run.await,
    };

    match outcome {
        Ok(output) => CommandExecutionResult {
            pid: None,
            code: output.status.code(),
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
            command,
        },
        Err(err) => CommandExecutionResult {
            pid: None,
            code: None,
            success: false,
            stdout: String::new(),
            stderr: err.to_string(),
            command,
        },
    }
}

/// The ONE exec command. `isolate` picks the env model: false (default — Command.Execute) LAYERS `env` onto the
/// inherited environment; true (the sandbox) CLEARS it first so only the caller's already-scrubbed `env` reaches
/// the child. `timeout_ms` (>0) caps wall-clock. Both models are the same run_command with different ExecOptions —
/// there is no second exec function.
#[tauri::command]
pub async fn command_execute(
    launcher: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    isolate: Option<bool>,
    timeout_ms: Option<u64>,
    input: Option<String>,
) -> CommandExecutionResult {
    run_command(
        &launcher,
        &args,
        ExecOptions {
            cwd,
            env: env.unwrap_or_default(),
            clear_env: isolate.unwrap_or(false),
            timeout_ms,
            input,
        },
    )
    .await
}

#[cfg(all(test, unix))]
mod tests {
    use super::command_execute;
    use std::collections::HashMap;

    // The security property behind command_execute(isolate = true): a secret in the PARENT environment must NOT
    // reach the child, while an explicitly-allowlisted var MUST.
    #[tokio::test]
    async fn command_execute_isolate_clears_inherited_env_but_keeps_the_allowlist() {
        std::env::set_var("HOST_ISOLATED_LEAK_CHECK", "leaked-secret");
        let mut env = HashMap::new();
        // The scrubbed allowlist carries PATH (so `sh` resolves) plus one explicit var.
        env.insert(
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_default(),
        );
        env.insert("ALLOWED_VAR".to_string(), "present".to_string());

        let out = command_execute(
            "sh".to_string(),
            vec![
                "-c".to_string(),
                "printf 'leak=[%s] allowed=[%s]' \"$HOST_ISOLATED_LEAK_CHECK\" \"$ALLOWED_VAR\""
                    .to_string(),
            ],
            None,
            Some(env),
            Some(true),
            None,
            None,
        )
        .await;

        assert!(out.success, "isolated exec failed: {}", out.stderr);
        // Inherited secret is gone (empty), allowlisted var is present.
        assert!(
            out.stdout.contains("leak=[]"),
            "inherited secret leaked into the isolated child: {}",
            out.stdout
        );
        assert!(
            out.stdout.contains("allowed=[present]"),
            "allowlisted var missing: {}",
            out.stdout
        );
    }

    #[tokio::test]
    async fn command_execute_times_out() {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_default(),
        );
        let out = command_execute(
            "sh".to_string(),
            vec!["-c".to_string(), "sleep 5".to_string()],
            None,
            Some(env),
            Some(true),
            Some(100),
            None,
        )
        .await;
        assert!(!out.success);
        assert!(
            out.stderr.contains("timed out"),
            "expected timeout, got: {}",
            out.stderr
        );
    }

    // Stdin `input` is piped to the child and the SECRET never appears in argv — the property the registry
    // `login --password-stdin` path relies on. `cat` echoes only what it reads from stdin.
    #[tokio::test]
    async fn command_execute_pipes_stdin_input_and_keeps_it_out_of_argv() {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            std::env::var("PATH").unwrap_or_default(),
        );
        let out = command_execute(
            "cat".to_string(),
            vec![],
            None,
            Some(env),
            Some(true),
            None,
            Some("s3cr3t-token".to_string()),
        )
        .await;
        assert!(out.success, "stdin exec failed: {}", out.stderr);
        assert_eq!(
            out.stdout, "s3cr3t-token",
            "stdin was not delivered to the child"
        );
        assert!(
            !out.command.contains("s3cr3t-token"),
            "secret leaked into argv/command: {}",
            out.command
        );
    }
}
