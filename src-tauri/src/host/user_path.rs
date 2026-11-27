// The PATH a desktop launch is missing. macOS starts an app from Finder or the Dock with launchd's PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so every engine CLI in /usr/local/bin, /opt/homebrew/bin or /opt/podman/bin reads as
// "not found" — Apple's `container`, Homebrew's podman, socktainer and limactl alike. At startup, before any command
// runs, the process PATH gains the user's login-shell PATH (macOS) and the usual install dirs that exist; every child
// (which, the engine CLIs, ssh) inherits it. Entries are only ever appended or deduplicated, never dropped.

use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::time::Duration;

const MARKER: &str = "__CONTAINER_DESKTOP_ENV__";
#[cfg(target_os = "macos")]
const SHELL_TIMEOUT: Duration = Duration::from_secs(3);

/// Joins PATH lists in order, keeping each directory's first occurrence and dropping empty entries.
pub(crate) fn merge_path_lists(lists: &[&str]) -> String {
    let mut seen = std::collections::HashSet::new();
    lists
        .iter()
        .flat_map(|list| list.split(':'))
        .filter(|dir| !dir.is_empty() && seen.insert(*dir))
        .collect::<Vec<_>>()
        .join(":")
}

/// The PATH from an `env` dump printed between two markers, ignoring whatever an interactive shell's startup files
/// print around it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn path_from_env_dump(output: &str) -> Option<String> {
    let (_, rest) = output.split_once(MARKER)?;
    let (dump, _) = rest.split_once(MARKER)?;
    dump.lines()
        .find_map(|line| line.strip_prefix("PATH="))
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}

/// True when PATH holds none of the user install dirs: a launchd launch, so the login shell must be asked. A launch
/// from a terminal already carries the user's PATH and skips the shell.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn needs_login_shell(path: &str) -> bool {
    !path
        .split(':')
        .any(|dir| dir == "/usr/local/bin" || dir == "/opt/homebrew/bin")
}

/// The install dirs engines and their tools use on this OS, under `home` where per-user.
pub(crate) fn install_dirs(home: Option<&Path>) -> Vec<String> {
    #[cfg(target_os = "macos")]
    let system = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/podman/bin",
        "/opt/local/bin",
    ];
    #[cfg(not(target_os = "macos"))]
    let system = [
        "/usr/local/bin",
        "/usr/local/sbin",
        "/home/linuxbrew/.linuxbrew/bin",
    ];
    let mut dirs: Vec<String> = system.iter().map(|dir| dir.to_string()).collect();
    if let Some(home) = home {
        dirs.push(home.join(".local/bin").to_string_lossy().into_owned());
    }
    dirs
}

// The user's login-shell PATH, or None when the shell is missing, fails or outlives SHELL_TIMEOUT. `env` prints the
// PATH colon-joined whatever the shell (zsh, bash, fish), and the markers fence off rc-file chatter.
#[cfg(target_os = "macos")]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let script = format!("echo {MARKER}; /usr/bin/env; echo {MARKER}");
    let child = Command::new(shell)
        .args(["-ilc", script.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // oh-my-zsh: no update prompt or tmux autostart in a non-interactive probe.
        .env("DISABLE_AUTO_UPDATE", "true")
        .env("ZSH_TMUX_AUTOSTART", "false")
        .spawn()
        .ok()?;
    let pid = child.id() as libc::pid_t;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(SHELL_TIMEOUT) {
        Ok(Ok(output)) => path_from_env_dump(&String::from_utf8_lossy(&output.stdout)),
        _ => {
            // SAFETY: kill(2) on the shell this function spawned; a stale pid at worst gets ESRCH.
            unsafe { libc::kill(pid, libc::SIGKILL) };
            None
        }
    }
}

/// Extends the process PATH; call first in `run()`, before any thread or command starts.
pub fn extend_process_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let existing: Vec<String> = install_dirs(home.as_deref())
        .into_iter()
        .filter(|dir| Path::new(dir).is_dir())
        .collect();
    let extra = existing.join(":");
    #[cfg(target_os = "macos")]
    let login = if needs_login_shell(&current) {
        login_shell_path().unwrap_or_default()
    } else {
        String::new()
    };
    #[cfg(not(target_os = "macos"))]
    let login = String::new();
    let merged = merge_path_lists(&[&login, &current, &extra]);
    if merged != current {
        std::env::set_var("PATH", merged);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_order_and_first_occurrence() {
        let merged = merge_path_lists(&[
            "/opt/homebrew/bin:/usr/bin",
            "/usr/bin:/bin:/usr/sbin:/sbin",
            "/usr/local/bin:/opt/homebrew/bin",
        ]);
        assert_eq!(merged, "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin");
    }

    #[test]
    fn merge_drops_empty_entries_and_lists() {
        assert_eq!(merge_path_lists(&["", "/usr/bin::/bin:", ""]), "/usr/bin:/bin");
        assert_eq!(merge_path_lists(&["", ""]), "");
    }

    #[test]
    fn env_dump_path_is_read_between_the_markers_only() {
        let output = format!(
            "Welcome to zsh\nPATH=/fake/from/motd\n{MARKER}\nHOME=/Users/me\nPATH=/opt/homebrew/bin:/usr/bin\nSHELL=/bin/zsh\n{MARKER}\nbye\n"
        );
        assert_eq!(path_from_env_dump(&output).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }

    #[test]
    fn env_dump_without_markers_or_path_is_none() {
        assert_eq!(path_from_env_dump("PATH=/usr/bin\n"), None);
        assert_eq!(path_from_env_dump(&format!("{MARKER}\nHOME=/Users/me\n{MARKER}\n")), None);
        assert_eq!(path_from_env_dump(&format!("{MARKER}\nPATH=\n{MARKER}\n")), None);
    }

    #[test]
    fn launchd_path_needs_the_login_shell_and_a_terminal_path_does_not() {
        assert!(needs_login_shell("/usr/bin:/bin:/usr/sbin:/sbin"));
        assert!(needs_login_shell(""));
        assert!(!needs_login_shell("/opt/homebrew/bin:/usr/bin:/bin"));
        assert!(!needs_login_shell("/usr/local/bin:/usr/bin:/bin"));
    }

    #[test]
    fn install_dirs_include_the_per_user_bin_under_home() {
        let dirs = install_dirs(Some(Path::new("/home/me")));
        assert!(dirs.iter().any(|dir| dir == "/home/me/.local/bin"));
        assert!(dirs.iter().any(|dir| dir == "/usr/local/bin"));
        assert!(!install_dirs(None).iter().any(|dir| dir.contains(".local")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn install_dirs_on_macos_cover_homebrew_and_the_podman_installer() {
        let dirs = install_dirs(None);
        assert!(dirs.iter().any(|dir| dir == "/opt/homebrew/bin"));
        assert!(dirs.iter().any(|dir| dir == "/opt/podman/bin"));
    }
}
