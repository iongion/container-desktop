//! The exec port's vocabulary.
//!
//! Types with almost no logic in them, and the little there is matters: `argv` is what every argv
//! assertion in this workspace compares, and `output` encodes a JavaScript falsy-fallback the version
//! parse depends on.

use cdc_runtime::capabilities::command::{CommandExecutionResult, HostCommand};

#[test]
fn argv_puts_the_launcher_first_and_the_arguments_after_it() {
    let command = HostCommand::new("which", &["podman"]);

    assert_eq!(command.launcher, "which");
    assert_eq!(command.args, vec!["podman"]);
    assert_eq!(command.argv(), vec!["which", "podman"]);
    // Everything else is absent by default: a HostCommand carries no ambient environment.
    assert_eq!(command.input, None);
    assert_eq!(command.timeout, None);
    assert_eq!(command.cwd, None);
    assert!(command.env.is_empty());
}

#[test]
fn an_argument_free_command_is_still_one_element_of_argv() {
    assert_eq!(HostCommand::new("podman", &[]).argv(), vec!["podman"]);
}

#[test]
fn a_result_knows_whether_it_succeeded() {
    let ok = CommandExecutionResult::ok("out");
    assert_eq!(
        (ok.code, ok.stdout.as_str(), ok.stderr.as_str()),
        (0, "out", "")
    );
    assert!(ok.success());

    let failed = CommandExecutionResult::failed(125, "boom");
    assert_eq!(
        (failed.code, failed.stdout.as_str(), failed.stderr.as_str()),
        (125, "", "boom")
    );
    assert!(!failed.success());
    // Any non-zero code is a failure, including the negative one a capability reports when nothing ran.
    assert!(
        !CommandExecutionResult {
            code: -1,
            ..CommandExecutionResult::default()
        }
        .success()
    );
}

#[test]
fn output_falls_back_to_stderr_only_when_stdout_is_empty() {
    // `result.stdout || result.stderr` — the fallback `ssh -V` depends on, since OpenSSH prints its
    // version to stderr.
    assert_eq!(
        CommandExecutionResult::ok("on stdout").output(),
        "on stdout"
    );
    assert_eq!(
        CommandExecutionResult::failed(1, "on stderr").output(),
        "on stderr"
    );
    assert_eq!(
        CommandExecutionResult {
            code: 0,
            stdout: "on stdout".to_string(),
            stderr: "on stderr".to_string(),
        }
        .output(),
        "on stdout",
        "stdout wins when it has content"
    );
    assert_eq!(CommandExecutionResult::default().output(), "");
}

#[test]
fn input_is_never_reachable_through_argv() {
    // the design's rule, as a test rather than a comment: `input` is the only place a secret may travel.
    let mut command = HostCommand::new("podman", &["login", "--password-stdin"]);
    command.input = Some("hunter2".to_string());

    assert!(
        !command.argv().iter().any(|it| it.contains("hunter2")),
        "the secret must not be reachable through argv"
    );
}
