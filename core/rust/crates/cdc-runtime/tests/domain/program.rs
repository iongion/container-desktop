//! Finding a program and its version.
//!
//! The ORDER of the probes is the specification, so what is asserted is the argv sequence and the
//! parse of each answer. It is an async cascade now rather than a resumable state machine; the
//! probes and their order are unchanged, which is why these are the same assertions.

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::capabilities::command::CommandExecutionResult;
use cdc_runtime::domain::program::{ProgramLookup, ProgramProbe};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::podman::PodmanNativeProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;

/// Run a lookup over a scripted host and report what it found plus every argv it issued.
///
/// `findHostProgram`, because the fixture's transport is native: what these pin is the CASCADE, and
/// which cascade runs is a separate choice from where it runs. The scoped cascade's own reach —
/// every probe wrapped by the transport — is `detect_scoped.rs`.
async fn lookup(
    name: &str,
    lookup: ProgramLookup,
    respond: fn(&[&str]) -> CommandExecutionResult,
) -> (
    cdc_runtime::domain::types::engine::Program,
    Vec<Vec<String>>,
) {
    let command = FakeCommand::answering(respond);
    let log = command.log();
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        command,
    );
    let found = ProgramProbe::find_host_program(name, lookup)
        .run(&host, &unit_settings())
        .await;
    let argv = log.lock().expect("asked").argv.clone();
    (found, argv)
}

#[test]
fn the_lookup_is_chosen_from_the_os_and_whether_the_engine_is_out_of_reach() {
    // A scoped host may be a Windows remote in `cmd.exe`; the LOCAL os says nothing about it.
    assert_eq!(
        ProgramLookup::for_target(OperatingSystem::Linux, false),
        ProgramLookup::Posix
    );
    assert_eq!(
        ProgramLookup::for_target(OperatingSystem::WindowsNt, false),
        ProgramLookup::WindowsLocal
    );
    assert_eq!(
        ProgramLookup::for_target(OperatingSystem::WindowsNt, true),
        ProgramLookup::Scoped
    );
    assert_eq!(
        ProgramLookup::for_target(OperatingSystem::Darwin, true),
        ProgramLookup::Scoped
    );
}

#[tokio::test]
async fn which_answers_first_and_the_version_is_asked_of_the_path_it_found() {
    let (found, argv) = lookup("podman", ProgramLookup::Posix, |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        _ => CommandExecutionResult::ok("podman version 5.6.2"),
    })
    .await;

    assert_eq!(found.path.as_deref(), Some("/usr/bin/podman"));
    assert_eq!(found.version.as_deref(), Some("5.6.2"));
    assert_eq!(
        argv,
        vec![
            vec!["which".to_string(), "podman".to_string()],
            vec!["/usr/bin/podman".to_string(), "--version".to_string()],
        ],
        "two round trips, and `whereis` is never reached"
    );
}

#[tokio::test]
async fn a_which_that_exits_zero_and_prints_nothing_is_still_a_miss() {
    // Some shells' builtins do exactly this, which is why an empty success falls through.
    let (found, argv) = lookup("podman", ProgramLookup::Posix, |argv| match argv {
        ["which", ..] => CommandExecutionResult::ok("   \n"),
        ["whereis", ..] => CommandExecutionResult::ok("podman: /usr/bin/podman /usr/share/man\n"),
        _ => CommandExecutionResult::ok("podman version 5.6.2"),
    })
    .await;

    assert_eq!(found.path.as_deref(), Some("/usr/bin/podman"));
    assert_eq!(
        argv[1],
        vec!["whereis".to_string(), "podman".to_string()],
        "the cascade continued"
    );
}

#[tokio::test]
async fn a_program_that_is_nowhere_is_an_absent_path_and_an_empty_version() {
    // Not an error: "no engine here" is an ANSWER. Absent rather than empty is what the original
    // persists, and the difference from "an engine at the empty path" is worth keeping.
    let (found, argv) = lookup("podman", ProgramLookup::Posix, |_| {
        CommandExecutionResult::failed(1, "")
    })
    .await;

    assert_eq!(found.path, None);
    assert_eq!(found.version.as_deref(), Some(""));
    assert_eq!(
        argv.len(),
        2,
        "which then whereis, and NO version probe — there is no path to ask about"
    );
}

#[tokio::test]
async fn only_a_scoped_lookup_falls_through_to_where() {
    // A local POSIX machine that answers neither `which` nor `whereis` has no `where` to ask; a
    // scoped one may be a Windows remote that has neither of the first two.
    let (_, posix) = lookup("podman", ProgramLookup::Posix, |_| {
        CommandExecutionResult::failed(1, "")
    })
    .await;
    assert!(
        !posix.iter().any(|argv| argv[0] == "where"),
        "a local POSIX lookup stops after whereis: {posix:?}"
    );

    let (found, scoped) = lookup("podman", ProgramLookup::Scoped, |argv| match argv {
        ["where", ..] => CommandExecutionResult::ok("C:\\Program Files\\podman.exe\r\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::failed(1, ""),
    })
    .await;
    assert_eq!(
        scoped[2],
        vec!["where".to_string(), "podman.exe".to_string()],
        "and it asks for the WINDOWS spelling on that leg only"
    );
    assert_eq!(found.path.as_deref(), Some("C:\\Program Files\\podman.exe"));
}

#[tokio::test]
async fn a_name_that_already_ends_in_exe_is_not_doubled() {
    let (_, argv) = lookup("podman.exe", ProgramLookup::Scoped, |_| {
        CommandExecutionResult::failed(1, "")
    })
    .await;

    assert_eq!(argv[2], vec!["where".to_string(), "podman.exe".to_string()]);
}

#[tokio::test]
async fn windows_asks_powershell_first_and_the_registry_only_when_that_finds_nothing() {
    let (found, argv) = lookup("podman", ProgramLookup::WindowsLocal, |argv| {
        if argv.iter().any(|it| it.contains("gcm")) {
            return CommandExecutionResult::ok("");
        }
        if argv.iter().any(|it| it.contains("Get-ChildItem")) {
            return CommandExecutionResult::ok(
                r#"{"DisplayName":"Podman","InstallLocation":"C:\\Program Files\\RedHat\\Podman"}"#,
            );
        }
        CommandExecutionResult::ok("podman version 5.6.2")
    })
    .await;

    assert_eq!(argv[0][0], "powershell.exe");
    assert_eq!(argv[1][0], "powershell");
    assert_eq!(
        found.path.as_deref(),
        Some("C:\\Program Files\\RedHat\\Podman\\resources\\bin\\podman.exe"),
        "InstallLocation + resources/bin + the exe, joined the Windows way"
    );
}

#[tokio::test]
async fn a_registry_answer_without_an_install_location_finds_nothing() {
    let (found, _) = lookup("podman", ProgramLookup::WindowsLocal, |argv| {
        if argv.iter().any(|it| it.contains("Get-ChildItem")) {
            return CommandExecutionResult::ok(r#"{"DisplayName":"Podman"}"#);
        }
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(found.path, None);
}

#[tokio::test]
async fn powershell_finding_the_program_is_the_whole_answer() {
    // The registry is the FALLBACK. Probing it anyway would run a script whose answer is discarded,
    // and on a machine with both an installed and a portable Docker it is the one that disagrees.
    let (found, argv) = lookup("docker", ProgramLookup::WindowsLocal, |argv| {
        if argv.iter().any(|it| it.contains("gcm")) {
            return CommandExecutionResult::ok("C:\\Program Files\\Docker\\docker.exe\r\n");
        }
        CommandExecutionResult::ok("Docker version 27.0.0")
    })
    .await;

    assert_eq!(
        argv.iter().map(|it| it[0].as_str()).collect::<Vec<_>>(),
        vec!["powershell.exe", "C:\\Program Files\\Docker\\docker.exe"],
        "gcm answered, so the next command is the VERSION probe and not the registry: {argv:?}"
    );
    assert_eq!(
        found.path.as_deref(),
        Some("C:\\Program Files\\Docker\\docker.exe")
    );
}

#[tokio::test]
async fn docker_is_looked_for_under_its_own_uninstall_key() {
    // Two engines have a key and they are different keys — reading Podman's for Docker would find
    // nothing and report the engine as absent on a machine where it is installed.
    let (_, argv) = lookup("docker", ProgramLookup::WindowsLocal, |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    assert!(
        argv[1][2].contains("Uninstall\\Docker Desktop"),
        "got {:?}",
        argv[1]
    );
}

#[tokio::test]
async fn a_registry_answer_that_is_not_json_at_all_finds_nothing() {
    // PowerShell writes its errors to stdout as readily as its results, so the script "succeeding"
    // with prose is a real answer to guard against — and one that must not panic.
    let (found, _) = lookup("podman", ProgramLookup::WindowsLocal, |argv| {
        if argv.iter().any(|it| it.contains("Get-ChildItem")) {
            return CommandExecutionResult::ok("Get-ChildItem : Cannot find path");
        }
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(found.path, None);
}

#[tokio::test]
async fn an_engine_with_no_registry_key_stops_after_powershell() {
    // Only the engines the original knows a key for have one; anything else has nowhere else to look.
    let (found, argv) = lookup("limactl", ProgramLookup::WindowsLocal, |_| {
        CommandExecutionResult::ok("")
    })
    .await;

    assert_eq!(argv.len(), 1, "just the gcm probe: {argv:?}");
    assert_eq!(found.path, None);
}
