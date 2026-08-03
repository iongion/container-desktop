//! Reading a program's version.
//!
//! The oracle is `detector.ts:findProgramVersion`. Three programs answer differently, and each is
//! wrong in its own way rather than in a shared one — so the strategy is chosen by the program path
//! and each exception is separately testable.

use crate::capabilities::command::{CommandExecutionResult, HostCommand};
use crate::domain::argv::parse_program_version;

/// Which of the four strategies a program needs. Derived from its path, exactly as the oracle
/// derives it — there is no configuration, and adding one would invent behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VersionStrategy {
    /// `--version`, third token of the first comma-separated field.
    Standard,
    /// `-V`, answered on stderr, used verbatim.
    Ssh,
    /// `version` subcommand, `GitVersion:` from the banner.
    Cosign,
    /// A PowerShell AppX query. `wsl.exe` has no usable version flag on older builds.
    Wsl,
}

fn strategy_for(program_path: &str) -> VersionStrategy {
    let lowered = program_path.to_ascii_lowercase();
    if lowered.ends_with("wsl.exe") {
        return VersionStrategy::Wsl;
    }
    if lowered.ends_with("ssh") || lowered.ends_with("ssh.exe") {
        return VersionStrategy::Ssh;
    }
    if lowered.ends_with("cosign") || lowered.ends_with("cosign.exe") {
        return VersionStrategy::Cosign;
    }
    VersionStrategy::Standard
}

/// The PowerShell that reads WSL's AppX package version.
///
/// The console-encoding dance is not decoration: `Get-AppxPackage` writes UTF-16, and without
/// switching the console encoding the JSON arrives as mojibake and fails to parse.
const WSL_APPX_SCRIPT: &str = "
        $console = ([console]::OutputEncoding)
        [console]::OutputEncoding = New-Object System.Text.UnicodeEncoding
        $version = (Get-AppxPackage | ? Name -eq \"MicrosoftCorporationII.WindowsSubsystemforLinux\") | ConvertTo-Json -Compress
        [console]::OutputEncoding = $console
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        [Console]::Write(\"$version\")
      ";

/// WSL2 is the only version this application supports, so an unreadable answer means the same thing
/// as "2" to every caller — which is why the oracle defaults rather than failing.
const WSL_DEFAULT_VERSION: &str = "2";

/// The command that reveals a program's version.
pub fn version_probe(program_path: &str) -> HostCommand {
    match strategy_for(program_path) {
        VersionStrategy::Standard => HostCommand::new(program_path, &["--version"]),
        VersionStrategy::Ssh => HostCommand::new(program_path, &["-V"]),
        VersionStrategy::Cosign => HostCommand::new(program_path, &["version"]),
        VersionStrategy::Wsl => HostCommand::new("powershell", &["-Command", WSL_APPX_SCRIPT]),
    }
}

/// Read the version out of that probe's outcome.
///
/// `Some("")` and `None` mean different things and the oracle distinguishes them: `version` starts
/// as `""` and is only replaced on success, so a FAILED probe yields the empty string, while a
/// successful probe whose output does not parse yields `undefined` and the key disappears entirely.
/// The corpus caught this — `detect-program-not-found` records `"version": ""`, not an absent key.
pub fn program_version(program_path: &str, outcome: &CommandExecutionResult) -> Option<String> {
    if !outcome.success() {
        return Some(String::new());
    }
    match strategy_for(program_path) {
        VersionStrategy::Standard => parse_program_version(outcome.output()),
        // Verbatim: `OpenSSH_9.6p1, LibreSSL 3.3.6` has no meaningful third token, and the whole
        // banner is what identifies the build.
        VersionStrategy::Ssh => Some(outcome.stderr.trim().to_string()),
        // `parseCosignVersion` returns "" rather than undefined for a banner with no GitVersion
        // line, and the oracle assigns it as-is.
        VersionStrategy::Cosign => Some(parse_cosign_version(outcome.output())),
        VersionStrategy::Wsl => Some(
            serde_json::from_str::<serde_json::Value>(outcome.output())
                .ok()
                .and_then(|appx| {
                    appx.get("Version")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| WSL_DEFAULT_VERSION.to_string()),
        ),
    }
}

/// `detector.ts:parseCosignVersion` — the `GitVersion:` line, case-insensitively, anywhere in the
/// banner. NEVER `GoVersion:`, which sits directly below it and is the Go toolchain.
///
/// Written as a scan rather than a regex: `regex` is a dependency the pure domain does not otherwise
/// need, and the rule is one line either way.
pub fn parse_cosign_version(output: &str) -> String {
    output
        .lines()
        .find_map(|line| {
            let trimmed = line.trim_start();
            let rest = trimmed.get(.."GitVersion:".len())?;
            rest.eq_ignore_ascii_case("GitVersion:")
                .then(|| trimmed["GitVersion:".len()..].split_whitespace().next())
                .flatten()
        })
        .unwrap_or_default()
        .to_string()
}
