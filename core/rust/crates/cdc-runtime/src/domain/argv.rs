//! Argv rules and timeout constants.
//!
//! They live in the domain rather than in the exec capability because they are *decisions* — how long
//! an `ssh` may run and how a Windows path is quoted are things this port specifies, and a rule
//! buried in a host adapter is a rule the other hosts get differently.

use std::time::Duration;

use crate::domain::pathing::has_drive_letter_prefix;

/// `ssh-args.ts:SSH_CONNECT_TIMEOUT_SECONDS`.
pub const SSH_CONNECT_TIMEOUT_SECONDS: u64 = 15;

/// `services.ts:SSH_COMMAND_TIMEOUT_MS` — the connect timeout plus five seconds. Specified, not
/// incidental: a command that outlives its own connection attempt hangs the connect flow.
pub const SSH_COMMAND_TIMEOUT: Duration = Duration::from_secs(SSH_CONNECT_TIMEOUT_SECONDS + 5);

/// `detector.ts:isWindowsProgramPath` — recognise a Windows engine path by shape, so a command sent
/// over SSH can be quoted for `cmd.exe` without a separate remote-OS probe.
pub fn is_windows_program_path(program_path: &str) -> bool {
    program_path.ends_with(".exe")
        || program_path.contains('\\')
        || has_drive_letter_prefix(program_path)
}

/// `transports/ssh.ts:quoteScopeProgram`.
///
/// A Windows engine path with spaces (`C:\Program Files\...\docker.exe`) reaches a remote `cmd.exe`
/// as space-joined argv and breaks. A POSIX path with spaces must NOT be quoted — the remote shell
/// is not `cmd.exe` and the quotes would become part of the path.
pub fn quote_scope_program(program: &str) -> String {
    if program.contains(' ') && !program.starts_with('"') && is_windows_program_path(program) {
        return format!("\"{program}\"");
    }
    program.to_string()
}

/// `detector.ts:parseProgramVersion` — the third space-separated token of the first comma-separated
/// field. That single expression covers `podman version 5.6.2` and
/// `Docker version 28.1.1, build 4eba377`, which is why it looks arbitrary and is not.
pub fn parse_program_version(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return None;
    }
    let field = trimmed.split(',').next().unwrap_or_default();
    // What FOLLOWS the word `version`, which is how every banner reads — `podman version 5.2.2`,
    // `Docker version 29.6.2, build …`, and Apple's `container CLI version 1.1.0 (build: …)`, whose
    // extra word is what the positional third-token rule read as the version itself.
    let mut words = field.split_whitespace();
    while let Some(word) = words.next() {
        if word.eq_ignore_ascii_case("version") {
            // Never fall through: the third token of `container CLI version` is the word `version`,
            // which is the defect this rule removes.
            return words.next().map(str::to_string);
        }
    }
    // A banner that does not name itself that way keeps the original positional reading.
    let parsed = field.split(' ').nth(2).unwrap_or_default().trim();
    if parsed.is_empty() {
        None
    } else {
        Some(parsed.to_string())
    }
}
