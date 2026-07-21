// Native host-I/O commands for the Tauri shell. Platform + FileSystem mirror src/platform/node/node.ts enough
// for the shared renderer to keep reading window.Platform/window.FS, while command_execute is the buffered
// process primitive used by src/platform/tauri/exec/commander.ts. Streaming process I/O lives in process.rs;
// SSH/WSL bridge I/O lives in bridge.rs/proxy.rs; terminal/window/logging shell actions live in shell.rs.

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

// Platform

/// Mirror of `os.type()` as the renderer's OperatingSystem enum values (Linux / Darwin / Windows_NT).
#[tauri::command]
pub fn get_os_type() -> String {
    if cfg!(target_os = "linux") {
        "Linux".into()
    } else if cfg!(target_os = "macos") {
        "Darwin".into()
    } else if cfg!(target_os = "windows") {
        "Windows_NT".into()
    } else {
        "unknown".into()
    }
}

/// Mirror of Node's `os.arch()` naming (x64 / arm64 / ia32), NOT Rust's (x86_64 / aarch64).
#[tauri::command]
pub fn get_os_arch() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64".into(),
        "aarch64" => "arm64".into(),
        "x86" => "ia32".into(),
        other => other.to_string(),
    }
}

/// The Darwin kernel major version on macOS (e.g. "24.3.0" → 24), else None. Mirrors the Electron host's
/// CURRENT_DARWIN_MAJOR (Number.parseInt(os.release().split(".")[0])), which gates Apple-Container networks
/// (full only on Darwin ≥ 25 / macOS 26). Off Darwin it is None so the renderer keeps the feature gated.
#[tauri::command]
pub fn get_darwin_major() -> Option<u32> {
    darwin_major()
}

#[cfg(target_os = "macos")]
fn darwin_major() -> Option<u32> {
    // SAFETY: uname() fills `info`; on success `release` is a NUL-terminated C string we only read.
    let mut info: libc::utsname = unsafe { std::mem::zeroed() };
    if unsafe { libc::uname(&mut info) } != 0 {
        return None;
    }
    let release = unsafe { std::ffi::CStr::from_ptr(info.release.as_ptr()) }.to_str().ok()?;
    parse_darwin_major(release)
}

#[cfg(not(target_os = "macos"))]
fn darwin_major() -> Option<u32> {
    None
}

/// Leading integer of a Darwin kernel release string ("24.3.0" → 24). Split out so it is unit-testable off macOS.
#[cfg(any(target_os = "macos", all(test, unix)))]
fn parse_darwin_major(release: &str) -> Option<u32> {
    release.split('.').next()?.trim().parse::<u32>().ok()
}

#[tauri::command]
pub fn get_env_var(name: String) -> Option<String> {
    std::env::var(&name).ok()
}

#[tauri::command]
pub fn get_home_dir() -> String {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").unwrap_or_default()
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").unwrap_or_default()
    }
}

/// Base directory for native file/dir pickers. In development the dev binary sets its cwd to the repo root
/// (see run()), so this is the bundled sample dir; when packaged it is the app install dir. Mirrors the
/// Electron windowManager base so both backends start pickers in the same place.
#[tauri::command]
pub fn get_picker_base_dir() -> String {
    #[cfg(debug_assertions)]
    {
        std::env::current_dir()
            .map(|p| {
                p.join("support")
                    .join("image-builders")
                    .to_string_lossy()
                    .into_owned()
            })
            .unwrap_or_default()
    }
    #[cfg(not(debug_assertions))]
    {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_string_lossy().into_owned()))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn is_flatpak() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }
    if std::env::var("FLATPAK_ID").is_ok() {
        return true;
    }
    Path::new("/.flatpak-info").exists()
}

/// Mirror of Platform.getUserDataPath(): explicit override → else per-OS config dir + "container-desktop".
#[tauri::command]
pub fn get_user_data_path() -> String {
    if let Ok(explicit) = std::env::var("CONTAINER_DESKTOP_USER_DATA_DIR") {
        if !explicit.is_empty() {
            let p = Path::new(&explicit);
            if p.is_absolute() {
                return explicit;
            }
            if let Ok(cwd) = std::env::current_dir() {
                return cwd.join(&explicit).to_string_lossy().into_owned();
            }
            return explicit;
        }
    }
    let home = get_home_dir();
    let app = "container-desktop";
    #[cfg(target_os = "windows")]
    {
        format!("{home}\\AppData\\Roaming\\{app}")
    }
    #[cfg(target_os = "macos")]
    {
        format!("{home}/Library/Application Support/{app}")
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
            if !xdg.is_empty() {
                return format!("{xdg}/{app}");
            }
        }
        format!("{home}/.config/{app}")
    }
}

// FileSystem

#[tauri::command]
pub fn fs_read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Like fs_write_text_file but hardens the file to owner-only — the Rust side of IFileSystem.writePrivateTextFile
/// (AI credentials / permissions / knowledge, which must never be world-readable). Mirrors the Node impl
/// (platform/node/node.ts: writeFileSync mode 0o600 + chmodSync 0o600). On Windows there is no unix mode, so the
/// write is best-effort — exactly the parity Node gives, where the numeric mode is a no-op on that platform.
#[tauri::command]
pub fn fs_write_private_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        // mode(0o600) only applies to a NEWLY created file (and is masked by umask); set_permissions afterward
        // forces exactly 0600 on both new and pre-existing files, matching the Node impl's explicit chmodSync.
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, contents).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_is_file_present(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_mkdir(path: String, recursive: Option<bool>) -> Result<(), String> {
    if recursive.unwrap_or(true) {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::create_dir(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_rename(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

// Command (process exec)

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
pub async fn run_command(program: &str, args: &[String], options: ExecOptions) -> CommandExecutionResult {
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
        Some(ms) if ms > 0 => match tokio::time::timeout(std::time::Duration::from_millis(ms), run).await {
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
        },
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
        ExecOptions { cwd, env: env.unwrap_or_default(), clear_env: isolate.unwrap_or(false), timeout_ms, input },
    )
    .await
}

// DNS resolution (host capability)

/// Resolve a hostname to its IP addresses. A generic host DNS capability — the AI web-search SSRF guard
/// (runtimes/agent/webSearch.ts) consumes it to reject private/loopback targets, but nothing here is AI-specific.
#[tauri::command]
pub async fn dns_lookup(hostname: String) -> Result<Vec<String>, String> {
    // lookup_host wants a "host:port" target; port 0 is fine, we only use the resolved IPs.
    let addrs = tokio::net::lookup_host((hostname.as_str(), 0u16)).await.map_err(|e| e.to_string())?;
    let mut ips: Vec<String> = addrs.map(|addr| addr.ip().to_string()).collect();
    ips.sort();
    ips.dedup();
    Ok(ips)
}

// Workspace (the IWorkspaceAccess host port)
//
// The confined project folder the AI workspace tools act on. Confinement is enforced HERE, host-side: every path is
// resolved lexically against the root AND canonicalized, so neither `..` nor a symlink can escape. The webview
// supplies `root` from the user's AI settings (trusted); the MODEL supplies the relative path (untrusted).
// Mirrors platform/electron/capabilities/workspaceAccess.ts so both shells behave identically.

const WORKSPACE_IGNORES: [&str; 2] = [".git", "node_modules"];
const MAX_WALK_FILES: usize = 20_000;
const MAX_GLOB_RESULTS: usize = 1_000;
const DEFAULT_GREP_RESULTS: usize = 200;
const HARD_MAX_GREP_RESULTS: usize = 1_000;
const MAX_GREP_FILE_BYTES: u64 = 1_000_000;
const MAX_GREP_LINE_CHARS: usize = 500;
const MAX_EXEC_OUTPUT_BYTES: usize = 64 * 1024;
const WORKSPACE_EXEC_TIMEOUT_MS: u64 = 120_000;
/// Only these process-env keys reach an exec'd command — enough for dev tools without forwarding secrets.
const WORKSPACE_EXEC_ENV_ALLOWLIST: [&str; 10] =
    ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ", "SHELL"];

#[derive(Serialize)]
pub struct WorkspaceDirEntry {
    pub name: String,
    pub kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStat {
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified_ms: f64,
}

#[derive(Serialize)]
pub struct WorkspaceEditResult {
    pub path: String,
    pub before: String,
    pub after: String,
    pub replacements: u32,
}

#[derive(Serialize)]
pub struct WorkspaceGrepMatch {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Serialize)]
pub struct WorkspaceExecResult {
    pub program: String,
    pub args: Vec<String>,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

/// Resolve `.` / `..` purely lexically, without touching the filesystem.
fn normalize_lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    if root.trim().is_empty() {
        return Err("No workspace is configured. Choose a workspace folder in Settings → AI.".to_string());
    }
    std::fs::canonicalize(root).map_err(|e| format!("workspace root is unavailable: {e}"))
}

/// Lexical guard + realpath canonicalization — where `..` / symlink escapes are stopped. `Path::starts_with` is
/// component-wise, so a sibling like `/ws-evil` is never treated as inside `/ws`.
fn confine(root_real: &Path, requested: &str, must_exist: bool) -> Result<PathBuf, String> {
    let lexical = normalize_lexical(&root_real.join(requested));
    if !lexical.starts_with(root_real) {
        return Err(format!("Path escapes the workspace: {requested}"));
    }
    match std::fs::canonicalize(&lexical) {
        Ok(real) => {
            if !real.starts_with(root_real) {
                return Err(format!("Path escapes the workspace: {requested}"));
            }
            Ok(real)
        }
        Err(_) => {
            if must_exist {
                return Err(format!("Path not found in the workspace: {requested}"));
            }
            if let Some(parent) = lexical.parent() {
                if let Ok(parent_real) = std::fs::canonicalize(parent) {
                    if !parent_real.starts_with(root_real) {
                        return Err(format!("Path escapes the workspace: {requested}"));
                    }
                }
            }
            Ok(lexical)
        }
    }
}

/// Translate a glob (`*` within a segment, `**` across segments, `?` one non-slash char) into an anchored regex.
fn glob_to_regex(pattern: &str) -> Result<Regex, String> {
    let chars: Vec<char> = pattern.chars().collect();
    let mut source = String::from("^");
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '*' {
            if i + 1 < chars.len() && chars[i + 1] == '*' {
                source.push_str(".*");
                i += 1;
                if i + 1 < chars.len() && chars[i + 1] == '/' {
                    i += 1;
                }
            } else {
                source.push_str("[^/]*");
            }
        } else if c == '?' {
            source.push_str("[^/]");
        } else {
            if "\\^$.|+()[]{}".contains(c) {
                source.push('\\');
            }
            source.push(c);
        }
        i += 1;
    }
    source.push('$');
    Regex::new(&source).map_err(|e| e.to_string())
}

/// Workspace-relative file paths (POSIX separators), skipping the ignore set and capped at MAX_WALK_FILES.
fn walk_files(root_real: &Path) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut stack: Vec<String> = vec![String::new()];
    while let Some(rel_dir) = stack.pop() {
        let abs_dir = if rel_dir.is_empty() { root_real.to_path_buf() } else { root_real.join(&rel_dir) };
        let entries = match std::fs::read_dir(&abs_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if WORKSPACE_IGNORES.contains(&name.as_str()) {
                continue;
            }
            let rel = if rel_dir.is_empty() { name } else { format!("{rel_dir}/{name}") };
            match entry.file_type() {
                Ok(file_type) if file_type.is_dir() => stack.push(rel),
                Ok(file_type) if file_type.is_file() => {
                    files.push(rel);
                    if files.len() >= MAX_WALK_FILES {
                        return files;
                    }
                }
                _ => {}
            }
        }
    }
    files
}

/// Replace `old_string` with `new_string`; without `replace_all` it must occur exactly once (unambiguous).
fn apply_string_edit(
    content: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<(String, u32), String> {
    if old_string.is_empty() {
        return Err("editFile: oldString must not be empty".to_string());
    }
    if replace_all {
        let count = content.matches(old_string).count() as u32;
        if count == 0 {
            return Err("editFile: oldString not found in the file".to_string());
        }
        return Ok((content.replace(old_string, new_string), count));
    }
    let first = content
        .find(old_string)
        .ok_or_else(|| "editFile: oldString not found in the file".to_string())?;
    if content[first + old_string.len()..].contains(old_string) {
        return Err("editFile: oldString is not unique; add surrounding context or set replaceAll".to_string());
    }
    let mut after = String::with_capacity(content.len());
    after.push_str(&content[..first]);
    after.push_str(new_string);
    after.push_str(&content[first + old_string.len()..]);
    Ok((after, 1))
}

fn cap_output(text: String) -> (String, bool) {
    if text.len() <= MAX_EXEC_OUTPUT_BYTES {
        (text, false)
    } else {
        (text.chars().take(MAX_EXEC_OUTPUT_BYTES).collect(), true)
    }
}

#[tauri::command]
pub fn workspace_root(root: String) -> Result<String, String> {
    Ok(canonical_root(&root)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_read(root: String, path: String) -> Result<String, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, true)?;
    std::fs::read_to_string(&abs).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_write(root: String, path: String, contents: String) -> Result<(), String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, false)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_edit(
    root: String,
    path: String,
    old_string: String,
    new_string: String,
    replace_all: Option<bool>,
) -> Result<WorkspaceEditResult, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, true)?;
    let before = std::fs::read_to_string(&abs).map_err(|e| e.to_string())?;
    let (after, replacements) = apply_string_edit(&before, &old_string, &new_string, replace_all.unwrap_or(false))?;
    std::fs::write(&abs, &after).map_err(|e| e.to_string())?;
    Ok(WorkspaceEditResult { path, before, after, replacements })
}

#[tauri::command]
pub fn workspace_list(root: String, path: Option<String>) -> Result<Vec<WorkspaceDirEntry>, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, path.as_deref().unwrap_or("."), true)?;
    let mut out: Vec<WorkspaceDirEntry> = Vec::new();
    for entry in std::fs::read_dir(&abs).map_err(|e| e.to_string())?.flatten() {
        let kind = match entry.file_type() {
            Ok(file_type) if file_type.is_symlink() => "symlink",
            Ok(file_type) if file_type.is_dir() => "directory",
            Ok(file_type) if file_type.is_file() => "file",
            _ => "other",
        };
        out.push(WorkspaceDirEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            kind: kind.to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn workspace_stat(root: String, path: String) -> Result<WorkspaceStat, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, true)?;
    let meta = std::fs::metadata(&abs).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        "directory"
    } else if meta.is_file() {
        "file"
    } else {
        "other"
    };
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0);
    Ok(WorkspaceStat { path, kind: kind.to_string(), size: meta.len(), modified_ms })
}

#[tauri::command]
pub fn workspace_remove(root: String, path: String) -> Result<(), String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, true)?;
    let meta = std::fs::symlink_metadata(&abs).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&abs).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&abs).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn workspace_glob(root: String, pattern: String) -> Result<Vec<String>, String> {
    let root_real = canonical_root(&root)?;
    let matcher = glob_to_regex(&pattern)?;
    let mut found: Vec<String> = Vec::new();
    for rel in walk_files(&root_real) {
        if matcher.is_match(&rel) {
            found.push(rel);
            if found.len() >= MAX_GLOB_RESULTS {
                break;
            }
        }
    }
    Ok(found)
}

#[tauri::command]
pub fn workspace_grep(
    root: String,
    pattern: String,
    glob: Option<String>,
    max_results: Option<usize>,
) -> Result<Vec<WorkspaceGrepMatch>, String> {
    let root_real = canonical_root(&root)?;
    let matcher = Regex::new(&pattern).map_err(|e| e.to_string())?;
    let glob_matcher = match glob.as_deref() {
        Some(value) => Some(glob_to_regex(value)?),
        None => None,
    };
    let limit = max_results.unwrap_or(DEFAULT_GREP_RESULTS).min(HARD_MAX_GREP_RESULTS);
    let mut matches: Vec<WorkspaceGrepMatch> = Vec::new();
    for rel in walk_files(&root_real) {
        if let Some(glob_matcher) = &glob_matcher {
            if !glob_matcher.is_match(&rel) {
                continue;
            }
        }
        let abs = root_real.join(&rel);
        match std::fs::metadata(&abs) {
            Ok(meta) if meta.len() <= MAX_GREP_FILE_BYTES => {}
            _ => continue,
        }
        let content = match std::fs::read_to_string(&abs) {
            Ok(content) => content,
            Err(_) => continue,
        };
        // Cheap binary sniff: skip files containing a NUL byte (expressed numerically, never as a literal).
        if content.as_bytes().contains(&0) {
            continue;
        }
        for (index, line) in content.lines().enumerate() {
            if matcher.is_match(line) {
                matches.push(WorkspaceGrepMatch {
                    path: rel.clone(),
                    line: (index + 1) as u32,
                    text: line.chars().take(MAX_GREP_LINE_CHARS).collect(),
                });
                if matches.len() >= limit {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

#[tauri::command]
pub async fn workspace_exec(root: String, program: String, args: Vec<String>) -> Result<WorkspaceExecResult, String> {
    let root_real = canonical_root(&root)?;
    let mut env: HashMap<String, String> = HashMap::new();
    for key in WORKSPACE_EXEC_ENV_ALLOWLIST {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.to_string(), value);
        }
    }
    let result = run_command(
        &program,
        &args,
        ExecOptions {
            cwd: Some(root_real.to_string_lossy().to_string()),
            env,
            clear_env: true,
            timeout_ms: Some(WORKSPACE_EXEC_TIMEOUT_MS),
            input: None,
        },
    )
    .await;
    let (stdout, stdout_truncated) = cap_output(result.stdout);
    let (stderr, stderr_truncated) = cap_output(result.stderr);
    Ok(WorkspaceExecResult {
        program,
        args,
        code: result.code,
        stdout,
        stderr,
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn confine_accepts_in_root_paths_and_rejects_escapes() {
        let dir = std::env::temp_dir().join("cw-rs-confine");
        let _ = std::fs::create_dir_all(dir.join("src"));
        let root = std::fs::canonicalize(&dir).expect("canonicalize root");

        assert!(confine(&root, "src", true).is_ok());
        assert!(confine(&root, ".", true).is_ok());
        // Internal .. that stays inside is fine.
        assert!(confine(&root, "src/../src", true).is_ok());
        // Escapes are rejected.
        assert!(confine(&root, "../etc/passwd", false).is_err());
        assert!(confine(&root, "..", false).is_err());
        assert!(confine(&root, "/etc/passwd", false).is_err());
    }

    #[test]
    fn glob_to_regex_matches_segments_and_double_star() {
        assert!(glob_to_regex("*.ts").unwrap().is_match("a.ts"));
        assert!(!glob_to_regex("*.ts").unwrap().is_match("sub/a.ts"));
        assert!(glob_to_regex("src/**/*.ts").unwrap().is_match("src/a.ts"));
        assert!(glob_to_regex("src/**/*.ts").unwrap().is_match("src/x/y.ts"));
        assert!(glob_to_regex("**/*.ts").unwrap().is_match("a.ts"));
        assert!(glob_to_regex("a?.ts").unwrap().is_match("ab.ts"));
        assert!(!glob_to_regex("a?.ts").unwrap().is_match("a/.ts"));
    }

    #[test]
    fn apply_string_edit_requires_a_unique_match_unless_replace_all() {
        assert_eq!(apply_string_edit("a foo b", "foo", "bar", false).unwrap(), ("a bar b".to_string(), 1));
        assert!(apply_string_edit("abc", "x", "y", false).is_err());
        assert!(apply_string_edit("x x x", "x", "y", false).is_err());
        assert_eq!(apply_string_edit("x x x", "x", "y", true).unwrap(), ("y y y".to_string(), 3));
        assert!(apply_string_edit("abc", "", "y", false).is_err());
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    // The security property behind command_execute(isolate = true): a secret in the PARENT environment must NOT
    // reach the child, while an explicitly-allowlisted var MUST.
    #[tokio::test]
    async fn command_execute_isolate_clears_inherited_env_but_keeps_the_allowlist() {
        std::env::set_var("HOST_ISOLATED_LEAK_CHECK", "leaked-secret");
        let mut env = HashMap::new();
        // The scrubbed allowlist carries PATH (so `sh` resolves) plus one explicit var.
        env.insert("PATH".to_string(), std::env::var("PATH").unwrap_or_default());
        env.insert("ALLOWED_VAR".to_string(), "present".to_string());

        let out = command_execute(
            "sh".to_string(),
            vec![
                "-c".to_string(),
                "printf 'leak=[%s] allowed=[%s]' \"$HOST_ISOLATED_LEAK_CHECK\" \"$ALLOWED_VAR\"".to_string(),
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
        assert!(out.stdout.contains("leak=[]"), "inherited secret leaked into the isolated child: {}", out.stdout);
        assert!(out.stdout.contains("allowed=[present]"), "allowlisted var missing: {}", out.stdout);
    }

    #[tokio::test]
    async fn command_execute_times_out() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), std::env::var("PATH").unwrap_or_default());
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
        assert!(out.stderr.contains("timed out"), "expected timeout, got: {}", out.stderr);
    }

    // Stdin `input` is piped to the child and the SECRET never appears in argv — the property the registry
    // `login --password-stdin` path relies on. `cat` echoes only what it reads from stdin.
    #[tokio::test]
    async fn command_execute_pipes_stdin_input_and_keeps_it_out_of_argv() {
        let mut env = HashMap::new();
        env.insert("PATH".to_string(), std::env::var("PATH").unwrap_or_default());
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
        assert_eq!(out.stdout, "s3cr3t-token", "stdin was not delivered to the child");
        assert!(!out.command.contains("s3cr3t-token"), "secret leaked into argv/command: {}", out.command);
    }

    // Mirrors Electron's Number.parseInt(os.release().split(".")[0]) — the Darwin kernel major that gates
    // Apple-Container networks. Only the parse is platform-independent (uname itself is macOS-only).
    #[test]
    fn parse_darwin_major_reads_the_kernel_release_prefix() {
        assert_eq!(parse_darwin_major("24.3.0"), Some(24));
        assert_eq!(parse_darwin_major("25"), Some(25));
        assert_eq!(parse_darwin_major(""), None);
        assert_eq!(parse_darwin_major("x.y"), None);
    }
}
