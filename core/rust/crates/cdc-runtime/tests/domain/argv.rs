//! The argv rules.
//!
//! These are *decisions*, not capability mechanics, so they live in the pure kernel where the corpus can
//! reach them. Each is a direct port with a named oracle, and each branch is exercised — a rule
//! nobody has seen reject something is not known to work.

use std::time::Duration;

use cdc_runtime::domain::argv::{
    SSH_COMMAND_TIMEOUT, SSH_CONNECT_TIMEOUT_SECONDS, is_windows_program_path,
    parse_program_version, quote_scope_program,
};

// `detector.ts:isWindowsProgramPath`

#[test]
fn a_drive_letter_a_dot_exe_or_a_backslash_marks_a_windows_path() {
    assert!(is_windows_program_path(
        "C:\\Program Files\\Docker\\docker.exe"
    ));
    assert!(is_windows_program_path("D:/tools/podman"));
    assert!(is_windows_program_path("podman.exe"));
    assert!(is_windows_program_path("bin\\podman"));
}

#[test]
fn posix_paths_are_not_windows_paths() {
    assert!(!is_windows_program_path("/usr/bin/podman"));
    assert!(!is_windows_program_path("podman"));
    assert!(!is_windows_program_path("/opt/my app/podman"));
}

#[test]
fn a_drive_letter_must_actually_be_a_letter() {
    // `1:/opt/podman` has the SHAPE of a drive-rooted path but is not one. Reading it as Windows
    // would quote it for `cmd.exe` on the way to a machine running a POSIX shell.
    assert!(!is_windows_program_path("1:/opt/podman"));
    assert!(is_windows_program_path("D:/opt/podman"));
}

// `transports/ssh.ts:quoteScopeProgram`

#[test]
fn a_spaced_windows_path_is_quoted() {
    assert_eq!(
        quote_scope_program("C:\\Program Files\\Docker\\docker.exe"),
        "\"C:\\Program Files\\Docker\\docker.exe\""
    );
}

#[test]
fn a_spaced_posix_path_is_left_alone() {
    // The remote shell is not cmd.exe, and quoting here would break it.
    assert_eq!(
        quote_scope_program("/opt/my app/podman"),
        "/opt/my app/podman"
    );
}

#[test]
fn a_windows_path_without_spaces_is_left_alone() {
    assert_eq!(
        quote_scope_program("C:\\bin\\docker.exe"),
        "C:\\bin\\docker.exe"
    );
}

#[test]
fn an_already_quoted_program_is_not_quoted_twice() {
    assert_eq!(
        quote_scope_program("\"C:\\Program Files\\Docker\\docker.exe\""),
        "\"C:\\Program Files\\Docker\\docker.exe\""
    );
}

// `detector.ts:parseProgramVersion` — the third space-separated token of the first comma-separated
// field. Both engines' real output shapes are covered because they differ.

#[test]
fn podman_version_output_parses() {
    assert_eq!(
        parse_program_version("podman version 5.6.2"),
        Some("5.6.2".to_string())
    );
}

#[test]
fn docker_version_output_drops_the_build_field() {
    assert_eq!(
        parse_program_version("Docker version 28.1.1, build 4eba377"),
        Some("28.1.1".to_string())
    );
}

#[test]
fn apple_container_puts_a_word_where_the_third_token_rule_expects_the_version() {
    // **Read off a real Mac, which is the only thing that could settle it**: `container --version`
    // prints `container CLI version 1.1.0 (build: release, commit: unspeci)`. The banner carries an
    // extra word before `version`, so the third-token rule returns the word "version" itself and that
    // is what a connection publishes as its engine's version. The fixture in
    // `machine/availability.rs` guessed this shape and said so; the guess was right and the rule is
    // wrong, in this port and in `detector.ts` alike.
    assert_eq!(
        parse_program_version("container CLI version 1.1.0 (build: release, commit: unspeci)"),
        Some("1.1.0".to_string())
    );
}

#[test]
fn surrounding_whitespace_is_trimmed_before_and_after() {
    assert_eq!(
        parse_program_version("  podman version 5.6.2\n"),
        Some("5.6.2".to_string())
    );
}

#[test]
fn a_banner_that_never_says_version_keeps_the_positional_third_token() {
    // The half of the rule the `version`-word fix left untested, and the one that matters most: a
    // banner that does NOT name itself that way still has to parse, or the fix would have broken all
    // of them silently. The rule is literally "the third token" — `nth(2)`, not "the one that looks
    // like a number" — so this is what it answers, and asserting the actual token is the point.
    assert_eq!(
        parse_program_version("nerdctl v2.0.0 linux/arm64"),
        Some("linux/arm64".to_string())
    );
    assert_eq!(
        parse_program_version("Apptainer runtime 1.3.4"),
        Some("1.3.4".to_string())
    );
}

#[test]
fn a_banner_that_ends_on_the_word_version_names_no_version() {
    // A truncated banner: the word is there and nothing follows it. It must NOT fall through to the
    // positional reading — for `container CLI version` the third token IS the word `version`, so
    // falling through answers `version` and re-creates the defect the word rule removed. Found by
    // covering the two lines the fix left uncovered, which is why the list is worth diffing.
    assert_eq!(parse_program_version("container CLI version"), None);
    assert_eq!(parse_program_version("podman version"), None);
}

#[test]
fn output_without_a_third_token_yields_nothing() {
    assert_eq!(parse_program_version(""), None);
    assert_eq!(parse_program_version("two words"), None);
    assert_eq!(parse_program_version("   "), None);
}

#[test]
fn the_ssh_timeouts_are_specified_values_not_incidental_ones() {
    assert_eq!(SSH_CONNECT_TIMEOUT_SECONDS, 15);
    assert_eq!(SSH_COMMAND_TIMEOUT, Duration::from_secs(20));
}
