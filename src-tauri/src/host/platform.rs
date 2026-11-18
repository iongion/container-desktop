// Platform host port — what the shared renderer reads as window.Platform (os type/arch, env, home, user-data dir,
// flatpak, darwin major).

use std::path::{Path, PathBuf};

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

/// The Darwin kernel major version on macOS (e.g. "24.3.0" → 24), else None. Mirrors the JS host's
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
    let release = unsafe { std::ffi::CStr::from_ptr(info.release.as_ptr()) }
        .to_str()
        .ok()?;
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
/// shared windowManager base so both backends start pickers in the same place.
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

const USER_DATA_OVERRIDE: &str = "CONTAINER_DESKTOP_USER_DATA_DIR";

/// The user-data override, absolute: a relative one is taken from `cwd` when there is one. None when unset or empty.
fn user_data_override(explicit: Option<&str>, cwd: Option<&Path>) -> Option<PathBuf> {
    let explicit = Path::new(explicit.filter(|value| !value.is_empty())?);
    if explicit.is_absolute() {
        return Some(explicit.to_path_buf());
    }
    Some(cwd.map_or_else(|| explicit.to_path_buf(), |cwd| cwd.join(explicit)))
}

/// Whether this run's user data is overridden: an isolated run (the WebDriver harness) that must leave the real app's
/// state alone.
pub fn user_data_is_overridden() -> bool {
    std::env::var_os(USER_DATA_OVERRIDE).is_some_and(|value| !value.is_empty())
}

fn webview_data_dir_from(explicit: Option<&str>, cwd: Option<&Path>) -> Option<PathBuf> {
    user_data_override(explicit, cwd).map(|dir| dir.join("webview"))
}

/// The webview's own storage (localStorage, HTTP cache) when the user-data dir is overridden, so an isolated run
/// (the WebDriver harness) never reads or writes the real app's. None keeps the platform default.
pub fn webview_data_dir() -> Option<PathBuf> {
    let explicit = std::env::var(USER_DATA_OVERRIDE).ok();
    webview_data_dir_from(explicit.as_deref(), std::env::current_dir().ok().as_deref())
}

/// Mirror of Platform.getUserDataPath(): explicit override → else per-OS config dir + "container-desktop".
#[tauri::command]
pub fn get_user_data_path() -> String {
    let explicit = std::env::var(USER_DATA_OVERRIDE).ok();
    if let Some(dir) = user_data_override(explicit.as_deref(), std::env::current_dir().ok().as_deref()) {
        return dir.to_string_lossy().into_owned();
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

#[cfg(all(test, unix))]
mod tests {
    use super::{parse_darwin_major, webview_data_dir_from};
    use std::path::{Path, PathBuf};

    // An isolated run (the WebDriver harness sets CONTAINER_DESKTOP_USER_DATA_DIR) gives the webview its own
    // storage under that dir, so it never reads or writes the real app's localStorage and HTTP cache.
    #[test]
    fn webview_data_dir_lives_under_an_overridden_user_data_dir() {
        let cwd = Path::new("/work");
        assert_eq!(
            webview_data_dir_from(Some("/tmp/e2e"), Some(cwd)),
            Some(PathBuf::from("/tmp/e2e/webview"))
        );
        assert_eq!(
            webview_data_dir_from(Some("webdriver/.e2e-user-data"), Some(cwd)),
            Some(PathBuf::from("/work/webdriver/.e2e-user-data/webview"))
        );
    }

    // Without the override the platform default stays: a normal launch keeps the storage it always had.
    #[test]
    fn webview_data_dir_is_the_platform_default_without_an_override() {
        assert_eq!(webview_data_dir_from(None, Some(Path::new("/work"))), None);
        assert_eq!(webview_data_dir_from(Some(""), Some(Path::new("/work"))), None);
    }

    // Parses the Darwin kernel major from uname's release string — the value that gates
    // Apple-Container networks. Only the parse is platform-independent (uname itself is macOS-only).
    #[test]
    fn parse_darwin_major_reads_the_kernel_release_prefix() {
        assert_eq!(parse_darwin_major("24.3.0"), Some(24));
        assert_eq!(parse_darwin_major("25"), Some(25));
        assert_eq!(parse_darwin_major(""), None);
        assert_eq!(parse_darwin_major("x.y"), None);
    }
}
