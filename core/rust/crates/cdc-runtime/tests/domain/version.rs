//! Version resolution and its three exceptions.
//!
//! `--version` parsed as the third space-separated token of the first comma-separated field covers
//! every engine. It covers none of `ssh`, `cosign` or `wsl.exe`, and each of those is wrong in a
//! different way — so each is its own function with its own tests rather than a special case buried
//! in one.

use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::version::{parse_cosign_version, program_version, version_probe};

#[test]
fn the_default_probe_is_the_version_flag() {
    assert_eq!(
        version_probe("/usr/bin/podman").argv(),
        ["/usr/bin/podman", "--version"]
    );
}

#[test]
fn ssh_is_probed_with_a_capital_v() {
    // `ssh --version` is an error; `-V` is the flag, and it answers on STDERR.
    assert_eq!(version_probe("/usr/bin/ssh").argv(), ["/usr/bin/ssh", "-V"]);
    assert_eq!(
        version_probe("C:\\Windows\\System32\\OpenSSH\\ssh.exe").argv(),
        ["C:\\Windows\\System32\\OpenSSH\\ssh.exe", "-V"]
    );
}

#[test]
fn ssh_version_is_taken_verbatim_from_stderr() {
    // Not parsed: `OpenSSH_9.6p1, LibreSSL 3.3.6` has no third token that means anything, and the
    // whole banner is what identifies the build.
    let outcome = CommandExecutionResult {
        code: 0,
        stdout: String::new(),
        stderr: "OpenSSH_9.6p1, LibreSSL 3.3.6\n".to_string(),
    };
    assert_eq!(
        program_version("/usr/bin/ssh", &outcome),
        Some("OpenSSH_9.6p1, LibreSSL 3.3.6".to_string())
    );
}

#[test]
fn cosign_is_probed_with_a_subcommand_not_a_flag() {
    assert_eq!(
        version_probe("/usr/bin/cosign").argv(),
        ["/usr/bin/cosign", "version"]
    );
    assert_eq!(
        version_probe("/opt/COSIGN.EXE").argv(),
        ["/opt/COSIGN.EXE", "version"]
    );
}

#[test]
fn cosign_version_comes_from_gitversion_and_never_from_goversion() {
    // The case a naive parse gets wrong: GoVersion is the line directly below GitVersion, and
    // taking the wrong one reports the Go toolchain as the cosign version.
    let banner = "\
  ______   ______     _______. __    _______ .__   __.
 /      | /  __  \\   /       ||  |  /  _____||  \\ |  |

GitVersion:    v2.4.1
GitCommit:     unknown
GitTreeState:  clean
BuildDate:     unknown
GoVersion:     go1.23.2
Compiler:      gc
Platform:      linux/amd64
";
    assert_eq!(parse_cosign_version(banner), "v2.4.1");
    assert_eq!(
        program_version("/usr/bin/cosign", &CommandExecutionResult::ok(banner)),
        Some("v2.4.1".to_string())
    );
}

#[test]
fn a_source_built_cosign_reports_devel() {
    assert_eq!(
        parse_cosign_version("GitVersion: devel\nGoVersion: go1.23.2"),
        "devel"
    );
}

#[test]
fn cosign_output_without_a_gitversion_line_yields_nothing() {
    assert_eq!(parse_cosign_version("GoVersion: go1.23.2"), "");
    // The empty string, not nothing: `parseCosignVersion` returns "" and the oracle assigns it.
    assert_eq!(
        program_version(
            "/usr/bin/cosign",
            &CommandExecutionResult::ok("GoVersion: go1.23.2")
        ),
        Some(String::new())
    );
}

#[test]
fn cosign_reads_stderr_when_stdout_is_empty() {
    let outcome = CommandExecutionResult {
        code: 0,
        stdout: String::new(),
        stderr: "GitVersion:    v2.4.1".to_string(),
    };
    assert_eq!(
        program_version("/usr/bin/cosign", &outcome),
        Some("v2.4.1".to_string())
    );
}

#[test]
fn a_failed_probe_yields_the_empty_string_and_an_unparseable_one_yields_nothing() {
    // Both are "no version" to a reader and they are NOT the same value. `version` starts as "" and
    // is only replaced on success, so a failure keeps the empty string; a success whose output does
    // not parse assigns undefined and the key disappears. The corpus pins this.
    assert_eq!(
        program_version(
            "/usr/bin/podman",
            &CommandExecutionResult::failed(127, "not found")
        ),
        Some(String::new())
    );
    assert_eq!(
        program_version("/usr/bin/podman", &CommandExecutionResult::ok("two words")),
        None
    );
}

#[test]
fn wsl_is_probed_through_powershell_because_it_has_no_version_flag() {
    // `wsl.exe --version` exists on new builds only; the AppX package is what the oracle reads, and
    // the UTF-16 console dance is required or the JSON comes back as mojibake.
    let probe = version_probe("C:\\Windows\\System32\\wsl.exe");
    assert_eq!(probe.launcher, "powershell");
    assert_eq!(probe.args[0], "-Command");
    assert!(
        probe.args[1].contains("MicrosoftCorporationII.WindowsSubsystemforLinux"),
        "the AppX package name is what identifies WSL: {}",
        probe.args[1]
    );
    assert!(probe.args[1].contains("UnicodeEncoding"));
}

#[test]
fn wsl_version_is_read_from_the_appx_json_and_defaults_to_two() {
    let outcome = CommandExecutionResult::ok(
        r#"{"Name":"MicrosoftCorporationII.WindowsSubsystemforLinux","Version":"2.3.26.0"}"#,
    );
    assert_eq!(
        program_version("C:\\Windows\\System32\\wsl.exe", &outcome),
        Some("2.3.26.0".to_string())
    );

    // Unreadable output defaults to "2" rather than to nothing: WSL2 is the only version this app
    // supports, so an absent answer and "2" mean the same thing to every caller.
    assert_eq!(
        program_version(
            "C:\\Windows\\System32\\wsl.exe",
            &CommandExecutionResult::ok("not json")
        ),
        Some("2".to_string())
    );
}
