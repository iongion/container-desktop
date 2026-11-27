// The PATH a desktop launch is missing. macOS starts an app from Finder or the Dock with launchd's PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so every engine CLI in /usr/local/bin, /opt/homebrew/bin or /opt/podman/bin reads as
// "not found" — Apple's `container`, Homebrew's podman, socktainer and limactl alike. At startup, before any command
// runs, the process PATH gains the usual install dirs that exist and, on macOS when those still hold no engine CLI, the
// user's login-shell PATH; every child (which, the engine CLIs, ssh) inherits it. Entries are only ever appended or
// deduplicated, never dropped.

use std::io::BufRead;
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
#[cfg(target_os = "macos")]
use std::time::Duration;

const MARKER: &str = "__CONTAINER_DESKTOP_ENV__";
const ENGINE_CLIS: [&str; 3] = ["podman", "docker", "container"];
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

/// The shell's output up to and including the closing marker. It stops there: a background job an rc file starts can
/// hold the output open long after the shell has printed the dump.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn read_env_dump(reader: impl BufRead) -> String {
    let mut dump = String::new();
    let mut markers = 0;
    for line in reader.lines().map_while(Result::ok) {
        markers += line.matches(MARKER).count();
        dump.push_str(&line);
        dump.push('\n');
        if markers >= 2 {
            break;
        }
    }
    dump
}

/// True when some PATH directory holds an engine CLI, so asking the login shell would gain nothing.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn has_engine_cli(path: &str) -> bool {
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .any(|dir| ENGINE_CLIS.iter().any(|cli| Path::new(dir).join(cli).is_file()))
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
    let mut child = Command::new(shell)
        .args(["-ilc", script.as_str()])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        // oh-my-zsh: no update prompt or tmux autostart in a non-interactive probe.
        .env("DISABLE_AUTO_UPDATE", "true")
        .env("ZSH_TMUX_AUTOSTART", "false")
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(read_env_dump(std::io::BufReader::new(stdout)));
    });
    let dump = rx.recv_timeout(SHELL_TIMEOUT).ok();
    // The dump is in, or it came too late: whatever the shell still runs is not needed.
    let _ = child.kill();
    let _ = child.wait();
    path_from_env_dump(&dump?)
}

/// Extends the process PATH; call first in `run()`, before any thread or command starts.
pub fn extend_process_path() {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from);
    let existing: Vec<String> = install_dirs(home.as_deref())
        .into_iter()
        .filter(|dir| Path::new(dir).is_dir())
        .collect();
    let merged = merge_path_lists(&[&current, &existing.join(":")]);
    // The login shell loads the user's rc files, up to a second or more, before the window shows: ask it only when the
    // install dirs still leave every engine CLI unfound.
    #[cfg(target_os = "macos")]
    let merged = if needs_login_shell(&current) && !has_engine_cli(&merged) {
        let login = login_shell_path().unwrap_or_default();
        merge_path_lists(&[&login, &merged])
    } else {
        merged
    };
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

    // A reader that fails the test if anything past the closing marker is read: an rc file's background job keeps
    // the real output open, and the probe must not wait for it.
    struct NeverReadPast;
    impl std::io::Read for NeverReadPast {
        fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
            panic!("read past the closing marker");
        }
    }

    #[test]
    fn env_dump_is_read_up_to_the_closing_marker_only() {
        use std::io::Read;
        let head = format!("motd\n{MARKER}\nPATH=/opt/homebrew/bin:/usr/bin\n{MARKER}\n");
        let reader = std::io::BufReader::new(std::io::Cursor::new(head).chain(NeverReadPast));
        let dump = read_env_dump(reader);
        assert_eq!(path_from_env_dump(&dump).as_deref(), Some("/opt/homebrew/bin:/usr/bin"));
    }

    #[test]
    fn engine_cli_is_found_only_in_a_path_dir_that_holds_one() {
        let root = std::env::temp_dir().join(format!("cd-user-path-test-{}", std::process::id()));
        let with_cli = root.join("with");
        let without_cli = root.join("without");
        std::fs::create_dir_all(&with_cli).unwrap();
        std::fs::create_dir_all(&without_cli).unwrap();
        std::fs::write(with_cli.join("podman"), "").unwrap();
        let (with_cli, without_cli) = (with_cli.to_string_lossy(), without_cli.to_string_lossy());
        assert!(has_engine_cli(&format!("{without_cli}:{with_cli}")));
        assert!(!has_engine_cli(&format!("{without_cli}::/nonexistent")));
        let _ = std::fs::remove_dir_all(&root);
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
