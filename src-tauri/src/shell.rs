// Native-shell commands (Phase D): the Rust side of the window/lifecycle integrations the webview reaches
// through MessageBus channels — reveal the storage folder, toggle devtools, open an external URL (gated
// JS-side by the shared urlPolicy), and launch a per-OS terminal. Ports src/platform/node/node.ts launchTerminal
// + the shell.openPath/openExternal handlers from src/platform/electron/main.ts.

use std::path::Path;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

// Mirrors env/Types.ts CommandExecutionResult so the renderer's `output.success` checks (Application.ts:485,
// podman.ts:364) work unchanged.
#[derive(Serialize)]
pub struct LaunchResult {
    pid: Option<u32>,
    code: Option<i32>,
    success: bool,
    stdout: String,
    stderr: String,
    command: String,
}

/// openStorageFolder — reveal the user-data dir (where the shared config lives) in the OS file manager. Uses
/// the SAME path get_user_data_path computes, so it's the dir the app actually reads/writes.
#[tauri::command]
pub fn open_storage_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::host::get_user_data_path();
    let _ = std::fs::create_dir_all(&dir);
    app.opener().open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

/// Open an external URL in the OS browser. The webview gates this with the shared urlPolicy.shouldOpenExternally
/// BEFORE invoking, so this only ever receives vetted URLs.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Toggle the webview devtools (the footer console button). Always available because the `tauri` crate is built
/// with the `devtools` feature (prod-enabled, matching Electron's unconditional devTools:true).
#[tauri::command]
pub fn toggle_devtools(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

// logging (logging:apply / open / reveal — loggingIpc.ts + electronLogMain.ts return shapes)

// userData/logs/container-desktop.log (getLogFilePath, electronLogMain.ts:32-34).
fn log_file_path() -> std::path::PathBuf {
    Path::new(&crate::host::get_user_data_path()).join("logs").join("container-desktop.log")
}

#[derive(Serialize)]
pub struct LogApplyResult {
    #[serde(rename = "logFile")]
    log_file: String,
}

/// logging:apply — the log level is applied renderer-side (the in-realm logger); this returns the file path.
/// (The Rust file-transport that actually writes entries to this path is a follow-up.)
#[tauri::command]
pub fn logging_apply() -> LogApplyResult {
    LogApplyResult { log_file: log_file_path().to_string_lossy().into_owned() }
}

// { ok, reason?: "missing" | "error", detail? } (electronLogMain.ts:87-102).
#[derive(Serialize)]
pub struct LogOpResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}
impl LogOpResult {
    fn missing() -> Self {
        Self { ok: false, reason: Some("missing".into()), detail: None }
    }
    fn ok() -> Self {
        Self { ok: true, reason: None, detail: None }
    }
    fn error(detail: String) -> Self {
        Self { ok: false, reason: Some("error".into()), detail: Some(detail) }
    }
}

/// logging:open — open the log file in the default viewer (missing → {ok:false, reason:"missing"}).
#[tauri::command]
pub fn logging_open(app: AppHandle) -> LogOpResult {
    let path = log_file_path();
    if !path.exists() {
        return LogOpResult::missing();
    }
    match app.opener().open_path(path.to_string_lossy().to_string(), None::<&str>) {
        Ok(()) => LogOpResult::ok(),
        Err(err) => LogOpResult::error(err.to_string()),
    }
}

/// logging:reveal — reveal the log file in the OS file manager.
#[tauri::command]
pub fn logging_reveal(app: AppHandle) -> LogOpResult {
    let path = log_file_path();
    if !path.exists() {
        return LogOpResult::missing();
    }
    match app.opener().reveal_item_in_dir(path.to_string_lossy().to_string()) {
        Ok(()) => LogOpResult::ok(),
        Err(err) => LogOpResult::error(err.to_string()),
    }
}

// launch_terminal (port of platform/node/node.ts)

#[derive(Deserialize)]
pub struct TerminalLaunch {
    launcher: String,
    #[serde(default)]
    args: Vec<String>,
    title: Option<String>,
}

/// Launch a system terminal running `launcher args…`. Per-OS (Terminal.app via osascript / Windows Terminal /
/// a probed Linux emulator), mirroring node.ts:279-323 exactly.
#[tauri::command]
pub fn launch_terminal(payload: TerminalLaunch) -> LaunchResult {
    let title = payload.title.unwrap_or_else(|| "Container Desktop".into());
    #[cfg(target_os = "macos")]
    {
        let _ = &title;
        launch_terminal_macos(&payload.launcher, &payload.args)
    }
    #[cfg(target_os = "windows")]
    {
        launch_terminal_windows(&payload.launcher, &payload.args, &title)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        launch_terminal_linux(&payload.launcher, &payload.args, &title)
    }
}

fn spawn_detached(program: &str, args: &[String]) -> LaunchResult {
    let command = format!("{program} {}", args.join(" "));
    match std::process::Command::new(program).args(args).spawn() {
        Ok(child) => LaunchResult {
            pid: Some(child.id()),
            code: Some(0),
            success: true,
            stdout: String::new(),
            stderr: String::new(),
            command,
        },
        Err(err) => LaunchResult {
            pid: None,
            code: None,
            success: false,
            stdout: String::new(),
            stderr: err.to_string(),
            command,
        },
    }
}

#[cfg(target_os = "macos")]
fn launch_terminal_macos(launcher: &str, args: &[String]) -> LaunchResult {
    let cmd = std::iter::once(launcher.to_string()).chain(args.iter().cloned()).collect::<Vec<_>>().join(" ");
    // escapeAppleScriptString (node.ts:148-150): \ → \\, " → \"
    let escaped = cmd.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!("tell app \"Terminal\" to do script \"{escaped}\"");
    spawn_detached("osascript", &["-e".to_string(), script])
}

#[cfg(target_os = "windows")]
fn launch_terminal_windows(launcher: &str, args: &[String], title: &str) -> LaunchResult {
    let mut wt_args = vec![
        "-w".to_string(),
        "nt".into(),
        "--title".into(),
        title.into(),
        "-p".into(),
        "Command Prompt".into(),
        "-d".into(),
        ".".into(),
        "cmd".into(),
        "/k".into(),
        launcher.into(),
    ];
    wt_args.extend(args.iter().cloned());
    spawn_detached("wt", &wt_args)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_terminal_linux(launcher: &str, args: &[String], title: &str) -> LaunchResult {
    // $TERMINAL first, then the candidate list (node.ts:51-61).
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(pref) = std::env::var("TERMINAL") {
        if !pref.is_empty() {
            candidates.push(pref);
        }
    }
    candidates.extend(
        ["ptyxis", "gnome-terminal", "kgx", "konsole", "kitty", "alacritty", "wezterm", "x-terminal-emulator", "xterm"]
            .iter()
            .map(|s| s.to_string()),
    );
    for candidate in candidates {
        if let Some(resolved) = resolve_executable(&candidate) {
            let name = real_basename(&resolved);
            let term_args = linux_terminal_args(&name, title, launcher, args);
            return spawn_detached(&resolved, &term_args);
        }
    }
    LaunchResult {
        pid: None,
        code: Some(-2),
        success: false,
        stdout: String::new(),
        stderr: "No supported terminal emulator found on PATH".into(),
        command: String::new(),
    }
}

// resolveExecutable (node.ts:77-91): absolute → check X_OK; else walk PATH.
#[cfg(all(unix, not(target_os = "macos")))]
fn resolve_executable(cmd: &str) -> Option<String> {
    let path = Path::new(cmd);
    if path.is_absolute() {
        return is_executable(path).then(|| cmd.to_string());
    }
    for dir in std::env::var("PATH").ok()?.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = Path::new(dir).join(cmd);
        if is_executable(&candidate) {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[cfg(all(unix, not(target_os = "macos")))]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
}

// realpathSync.native + basename (node.ts:93-99): resolve symlinks so the arg template matches the real binary.
#[cfg(all(unix, not(target_os = "macos")))]
fn real_basename(path: &str) -> String {
    let real = std::fs::canonicalize(path).unwrap_or_else(|_| Path::new(path).to_path_buf());
    real.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

// linuxTerminalArgs (node.ts:101-121).
#[cfg(all(unix, not(target_os = "macos")))]
fn linux_terminal_args(name: &str, title: &str, launcher: &str, params: &[String]) -> Vec<String> {
    let title = title.to_string();
    let launcher = launcher.to_string();
    let mut base: Vec<String> = match name {
        "ptyxis" => vec!["--new-window".into(), "-T".into(), title, "--".into(), launcher],
        "gnome-terminal" | "kgx" => vec!["--title".into(), title, "--".into(), launcher],
        "konsole" => vec!["--new-tab".into(), "--title".into(), title, "-e".into(), launcher],
        "kitty" => vec!["--title".into(), title, launcher],
        "alacritty" => vec!["--title".into(), title, "-e".into(), launcher],
        "wezterm" => vec!["start".into(), "--".into(), launcher],
        "xterm" => vec!["-T".into(), title, "-e".into(), launcher],
        _ => vec!["-e".into(), launcher],
    };
    base.extend(params.iter().cloned());
    base
}
