// FileSystem host port — the Rust side of IFileSystem. src-wails/fs_service.go must behave identically.

use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemDirEntry {
    name: String,
    kind: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemStat {
    kind: String,
    size: u64,
    modified_ms: u64,
}

fn metadata_kind(metadata: &std::fs::Metadata) -> String {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_file() {
        "file"
    } else if file_type.is_dir() {
        "directory"
    } else {
        "other"
    }
    .to_string()
}

/// The directory holding the container agent's env files. One of them carries a provider key, substituted in
/// THIS process by keychain_write_secret_file — so the web view may ask for it to be written and may learn its
/// path, but must never read it back. Every web-view-reachable read below refuses it.
pub fn agent_secrets_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(crate::host::platform::get_user_data_path()).join("agent")
}

/// True when `path` resolves inside the protected agent directory. Compared after normalising both sides, so
/// a `..` walk or a symlinked parent cannot step around it.
fn is_agent_secret(path: &Path) -> bool {
    let dir = agent_secrets_dir();
    let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let dir_resolved = dir.canonicalize().unwrap_or(dir);
    resolved.starts_with(&dir_resolved)
}

fn refuse_agent_secret(path: &Path) -> Result<(), String> {
    if is_agent_secret(path) {
        return Err("this path is not readable from the web view".into());
    }
    Ok(())
}

/// Write a file hardened to owner-only, creating parents. Shared by fs_write_private_text_file and by the
/// keychain's secret-substituting writer, so both produce the same 0600 guarantee.
pub fn write_private_file(path: &Path, contents: &str) -> Result<(), String> {
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
    refuse_agent_secret(Path::new(&path))?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_text_file(path: String, contents: String) -> Result<(), String> {
    refuse_agent_secret(Path::new(&path))?;
    if let Some(parent) = Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Like fs_write_text_file but hardens the file to owner-only — the Rust side of IFileSystem.writePrivateTextFile
/// (AI credentials / permissions / knowledge, which must never be world-readable). The file is created 0o600 and
/// chmod'ed 0o600. On Windows there is no unix mode, so the hardening is best-effort and the write still succeeds.
#[tauri::command]
pub fn fs_write_private_text_file(path: String, contents: String) -> Result<(), String> {
    refuse_agent_secret(Path::new(&path))?;
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
        file.write_all(contents.as_bytes())
            .map_err(|e| e.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, contents).map_err(|e| e.to_string())
    }
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
    refuse_agent_secret(Path::new(&old_path))?;
    refuse_agent_secret(Path::new(&new_path))?;
    std::fs::rename(&old_path, &new_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_list_directory(path: String) -> Result<Vec<FileSystemDirEntry>, String> {
    std::fs::read_dir(path)
        .map_err(|e| e.to_string())?
        .map(|entry| {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = std::fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            Ok(FileSystemDirEntry {
                name: entry.file_name().to_string_lossy().to_string(),
                kind: metadata_kind(&metadata),
            })
        })
        .collect()
}

#[tauri::command]
pub fn fs_lstat(path: String) -> Result<FileSystemStat, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0);
    Ok(FileSystemStat {
        kind: metadata_kind(&metadata),
        size: metadata.len(),
        modified_ms,
    })
}

#[tauri::command]
pub fn fs_real_path(path: String) -> Result<String, String> {
    std::fs::canonicalize(path)
        .map(|value| value.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_is_path_within(root: String, path: String) -> Result<bool, String> {
    let canonical_root = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let canonical_path = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    Ok(canonical_path.starts_with(canonical_root))
}
