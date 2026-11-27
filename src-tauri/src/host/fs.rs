// FileSystem host port — the Rust side of IFileSystem.

use std::path::Path;

/// Write a file hardened to owner-only, creating parents. mode(0o600) only applies to a NEWLY created file (and is
/// masked by umask); set_permissions afterward forces exactly 0600 on both new and pre-existing files, matching the
/// Node impl's explicit chmodSync. On Windows there is no unix mode, so the hardening is best-effort.
fn write_private_file(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents).map_err(|e| e.to_string())
    }
}

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
/// (credentials and permission records, which must never be world-readable).
#[tauri::command]
pub fn fs_write_private_text_file(path: String, contents: String) -> Result<(), String> {
    write_private_file(Path::new(&path), &contents)
}

/// The named-pipe filesystem, which Windows lets you LIST.
const WINDOWS_PIPE_DIRECTORY: &str = r"\\.\pipe\";

/// The pipe's own name when this path is a Windows named pipe — `utils:getWindowsPipeName`.
///
/// The predicate has to run before the name is read, or a POSIX path that merely contains a `pipe/`
/// directory would be treated as one.
fn windows_pipe_name(path: &str) -> Option<&str> {
    let normalized = path.trim().replace('\\', "/").to_ascii_lowercase();
    let is_pipe = normalized.starts_with("npipe://")
        || normalized.starts_with("//./pipe/")
        || normalized.starts_with("//?/pipe/");
    if !is_pipe {
        return None;
    }
    let separators = |it: char| it == '/' || it == '\\';
    let mut segments = path.trim().trim_end_matches(separators).rsplit(separators);
    let name = segments.next()?;
    let parent = segments.next()?;
    (!name.is_empty() && parent.eq_ignore_ascii_case("pipe")).then_some(name)
}

/// A named pipe cannot be answered by `exists`, and getting it wrong is not harmless.
///
/// `Path::exists` is `metadata().is_ok()`, and on Windows that OPENS the path — opening a pipe means
/// becoming a CLIENT of it. Measured against a live Docker Desktop on Windows 11: the check consumed
/// one of the server's instances, and a pipe whose instances are all busy then reads as ABSENT. So the
/// answer is racy and destructive. Listing the pipe filesystem answers it and touches nothing.
#[tauri::command]
pub fn fs_is_file_present(path: String) -> bool {
    if let Some(name) = windows_pipe_name(&path) {
        let Ok(entries) = std::fs::read_dir(WINDOWS_PIPE_DIRECTORY) else {
            return false;
        };
        return entries.flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(name)
        });
    }
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
