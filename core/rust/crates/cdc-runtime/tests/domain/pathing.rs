//! Path joining and absoluteness — `domain/pathing.rs`.
//!
//! The OS is a PARAMETER, and that is the only reason the Windows rules are checkable at all: nobody
//! here can run them. So they are asserted by value, per OS, rather than through a caller that
//! happens to exercise one branch.

use cdc_runtime::domain::pathing::{
    expand_home, has_drive_letter_prefix, is_absolute, join, normalize_separators, separator,
};
use cdc_runtime::domain::types::os::OperatingSystem;

#[test]
fn only_windows_separates_with_a_backslash() {
    assert_eq!(separator(OperatingSystem::WindowsNt), '\\');
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        assert_eq!(separator(os), '/', "{os:?}");
    }
}

#[test]
fn joining_rewrites_the_segments_separators_to_the_target_os() {
    // A Windows path built from a `/`-joined literal still comes out with backslashes, which is what
    // `path.join` in Node does and what the registry lookup depends on.
    assert_eq!(
        join(
            OperatingSystem::WindowsNt,
            "C:\\Program Files\\Podman",
            "resources/bin"
        ),
        "C:\\Program Files\\Podman\\resources\\bin"
    );
    assert_eq!(
        join(OperatingSystem::Linux, "/usr/local", "bin/podman"),
        "/usr/local/bin/podman"
    );
}

#[test]
fn joining_collapses_the_separators_the_two_halves_already_carry() {
    // Exactly one separator, whichever side supplied it — a doubled one reaches a shell as a
    // different path on Windows and as the same one on POSIX, so it cannot be left to luck.
    assert_eq!(
        join(OperatingSystem::Linux, "/usr/local/", "/bin"),
        "/usr/local/bin"
    );
    assert_eq!(
        join(OperatingSystem::Linux, "/usr/local", "bin"),
        "/usr/local/bin"
    );
    assert_eq!(
        join(OperatingSystem::WindowsNt, "C:\\Podman\\", "\\bin"),
        "C:\\Podman\\bin"
    );
}

#[test]
fn normalising_rewrites_every_separator_and_nothing_else() {
    assert_eq!(
        normalize_separators(OperatingSystem::WindowsNt, "a/b\\c/d"),
        "a\\b\\c\\d"
    );
    assert_eq!(
        normalize_separators(OperatingSystem::Linux, "a/b\\c/d"),
        "a/b/c/d"
    );
    assert_eq!(
        normalize_separators(OperatingSystem::Linux, "no-separators-here"),
        "no-separators-here"
    );
}

#[test]
fn a_leading_slash_is_absolute_everywhere_and_a_drive_letter_only_on_windows() {
    assert!(is_absolute(OperatingSystem::Linux, "/run/podman.sock"));
    assert!(is_absolute(OperatingSystem::WindowsNt, "/run/podman.sock"));
    assert!(!is_absolute(OperatingSystem::Linux, "run/podman.sock"));

    // The same string, and the answer differs by OS — which is the whole reason the OS is passed in.
    assert!(is_absolute(OperatingSystem::WindowsNt, "C:\\podman.exe"));
    assert!(!is_absolute(OperatingSystem::Linux, "C:\\podman.exe"));
    // A UNC root, which has no drive letter.
    assert!(is_absolute(
        OperatingSystem::WindowsNt,
        "\\\\.\\pipe\\docker_engine"
    ));
    assert!(!is_absolute(
        OperatingSystem::Linux,
        "\\\\.\\pipe\\docker_engine"
    ));
}

#[test]
fn a_drive_letter_needs_a_letter_a_colon_and_a_separator() {
    assert!(has_drive_letter_prefix("C:\\podman"));
    assert!(has_drive_letter_prefix("c:/podman"));
    assert!(
        !has_drive_letter_prefix("1:\\podman"),
        "a digit is not a drive"
    );
    assert!(
        !has_drive_letter_prefix("C:podman"),
        "a relative drive path is not absolute"
    );
    assert!(
        !has_drive_letter_prefix("C"),
        "and a truncated one must not panic"
    );
    assert!(!has_drive_letter_prefix(""));
}

#[test]
fn home_expands_from_a_tilde_or_the_first_dollar_home() {
    // Both spellings appear in `~/.ssh/config` and both reach an `IdentityFile`.
    assert_eq!(
        expand_home("~/.ssh/id_ed25519", "/home/tester"),
        "/home/tester/.ssh/id_ed25519"
    );
    assert_eq!(
        expand_home("$HOME/.ssh/id_ed25519", "/home/tester"),
        "/home/tester/.ssh/id_ed25519"
    );
    assert_eq!(
        expand_home("/etc/ssh/id_ed25519", "/home/tester"),
        "/etc/ssh/id_ed25519",
        "a path that needs nothing is returned unchanged"
    );
}

#[test]
fn only_the_first_dollar_home_is_substituted() {
    // `String.replace` with a string argument substitutes the FIRST occurrence only, and the port
    // matches it rather than quietly improving on it.
    assert_eq!(
        expand_home("$HOME/a/$HOME/b", "/home/tester"),
        "/home/tester/a/$HOME/b"
    );
}

#[test]
fn a_tilde_is_expanded_only_at_the_start() {
    assert_eq!(
        expand_home("/etc/~/keys", "/home/tester"),
        "/etc/~/keys",
        "a tilde mid-path is a directory name, not the home directory"
    );
}
