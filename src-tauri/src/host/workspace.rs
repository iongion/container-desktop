// Workspace host port — the IWorkspaceAccess capability.
//
// The confined project folder the AI workspace tools act on. Confinement is enforced HERE, host-side: every path is
// resolved lexically against the root AND canonicalized, so neither `..` nor a symlink can escape. The webview
// supplies `root` from the user's AI settings (trusted); the MODEL supplies the relative path (untrusted).
// Mirrors the Go WorkspaceService so both shells behave identically.

use regex::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use super::command::{run_command, ExecOptions};

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
const WORKSPACE_EXEC_ENV_ALLOWLIST: [&str; 10] = [
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ", "SHELL",
];

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
        return Err(
            "No workspace is configured. Choose a workspace folder in Settings → AI.".to_string(),
        );
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
        let abs_dir = if rel_dir.is_empty() {
            root_real.to_path_buf()
        } else {
            root_real.join(&rel_dir)
        };
        let entries = match std::fs::read_dir(&abs_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if WORKSPACE_IGNORES.contains(&name.as_str()) {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name
            } else {
                format!("{rel_dir}/{name}")
            };
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
        return Err(
            "editFile: oldString is not unique; add surrounding context or set replaceAll"
                .to_string(),
        );
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
pub fn workspace_write_new(root: String, path: String, contents: String) -> Result<String, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, &path, false)?;
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&abs)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Ok("exists".to_string());
        }
        Err(error) => return Err(error.to_string()),
    };
    if let Err(error) = file.write_all(contents.as_bytes()) {
        drop(file);
        let _ = std::fs::remove_file(&abs);
        return Err(error.to_string());
    }
    Ok("created".to_string())
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
    let (after, replacements) = apply_string_edit(
        &before,
        &old_string,
        &new_string,
        replace_all.unwrap_or(false),
    )?;
    std::fs::write(&abs, &after).map_err(|e| e.to_string())?;
    Ok(WorkspaceEditResult {
        path,
        before,
        after,
        replacements,
    })
}

#[tauri::command]
pub fn workspace_list(
    root: String,
    path: Option<String>,
) -> Result<Vec<WorkspaceDirEntry>, String> {
    let root_real = canonical_root(&root)?;
    let abs = confine(&root_real, path.as_deref().unwrap_or("."), true)?;
    let mut out: Vec<WorkspaceDirEntry> = Vec::new();
    for entry in std::fs::read_dir(&abs)
        .map_err(|e| e.to_string())?
        .flatten()
    {
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
    Ok(WorkspaceStat {
        path,
        kind: kind.to_string(),
        size: meta.len(),
        modified_ms,
    })
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
    let limit = max_results
        .unwrap_or(DEFAULT_GREP_RESULTS)
        .min(HARD_MAX_GREP_RESULTS);
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
pub async fn workspace_exec(
    root: String,
    program: String,
    args: Vec<String>,
) -> Result<WorkspaceExecResult, String> {
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
mod tests {
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
        assert_eq!(
            apply_string_edit("a foo b", "foo", "bar", false).unwrap(),
            ("a bar b".to_string(), 1)
        );
        assert!(apply_string_edit("abc", "x", "y", false).is_err());
        assert!(apply_string_edit("x x x", "x", "y", false).is_err());
        assert_eq!(
            apply_string_edit("x x x", "x", "y", true).unwrap(),
            ("y y y".to_string(), 3)
        );
        assert!(apply_string_edit("abc", "", "y", false).is_err());
    }

    #[test]
    fn write_new_never_overwrites_an_existing_file() {
        let dir = std::env::temp_dir().join(format!("cw-rs-write-new-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test workspace");
        let root = dir.to_string_lossy().to_string();

        assert_eq!(
            workspace_write_new(
                root.clone(),
                "rules/project.md".to_string(),
                "first".to_string()
            )
            .unwrap(),
            "created"
        );
        assert_eq!(
            workspace_write_new(
                root.clone(),
                "rules/project.md".to_string(),
                "second".to_string()
            )
            .unwrap(),
            "exists"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("rules/project.md")).unwrap(),
            "first"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
