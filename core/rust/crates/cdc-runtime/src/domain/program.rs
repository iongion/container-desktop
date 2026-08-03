//! Finding a program and its version.
//!
//! The oracle is `detector.ts:findProgramPath` composed with `findProgramVersion`, and
//! `host-client.ts:findHostProgram` which returns them together as a `Program`.
//!
//! Three lookups rather than one with branches, because they are genuinely different mechanisms and
//! two of them cannot be run from here. Keeping them apart is what lets the unverifiable ones be
//! *named* as unverified rather than hidden inside an `if`.

use crate::capabilities::command::{CommandExecutionResult, HostCommand};
use crate::domain::pathing::join;
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::engine::Program;
use crate::domain::types::os::OperatingSystem;
use crate::domain::version::{program_version, version_probe};
use crate::runtimes::composition::HostContext;

/// How a program is located on the machine that will run it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgramLookup {
    /// `which`, then `whereis`. The local POSIX machine.
    Posix,
    /// PowerShell `gcm`, then the uninstall registry. Only possible when THIS machine is Windows.
    WindowsLocal,
    /// `which`, `whereis`, then `where <name>.exe` — the cascade `findScopeProgram` runs through a
    /// transport. POSIX comes first because a scoped host usually IS POSIX (a Linux VM, macOS over
    /// SSH) and that case must stay one round-trip; a Windows remote lands in `cmd.exe`, which has
    /// neither `which` nor `whereis`, and answers the third probe instead.
    Scoped,
}

impl ProgramLookup {
    /// Reached through a transport, the LOCAL os stops mattering: the cascade is fixed, and choosing
    /// a Windows-only lookup from this machine's os would ask `where` of a Linux remote whenever the
    /// desktop happened to be running on Windows.
    pub fn for_target(os: OperatingSystem, through_executor: bool) -> Self {
        match (os, through_executor) {
            (_, true) => ProgramLookup::Scoped,
            (OperatingSystem::WindowsNt, false) => ProgramLookup::WindowsLocal,
            _ => ProgramLookup::Posix,
        }
    }
}

/// The uninstall keys the oracle probes. Only these two programs have one; anything else stops
/// after the PowerShell probe rather than running a script that can only return nothing.
fn registry_key(program_name: &str) -> Option<&'static str> {
    let lowered = program_name.to_ascii_lowercase();
    if lowered.starts_with("docker") {
        return Some(
            "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Docker Desktop",
        );
    }
    if lowered.starts_with("podman") {
        return Some("HKLM:\\SOFTWARE\\Red Hat\\Podman");
    }
    None
}

/// `detector.ts:findWindowsProgramByRegistryKey`, verbatim. The `*` after the key is load-bearing:
/// the uninstall entries are versioned subkeys, not the key itself.
fn registry_script(key: &str) -> String {
    format!(
        "
    $location = Get-ChildItem \"{key}*\" | % {{ Get-ItemProperty $_.PsPath }} | Select DisplayName,InstallLocation | Sort-Object Displayname -Descending | ConvertTo-JSON -Compress
    [Console]::Write(\"$location\")
  "
    )
}

/// `whereis podman` prints `podman: /usr/bin/podman /usr/share/man/...` — the SECOND field.
///
/// Fragile and inherited. Changing it is a TypeScript-first decision.
fn whereis_path(stdout: &str) -> String {
    stdout
        .trim()
        .split(' ')
        .nth(1)
        .map(str::trim)
        .unwrap_or_default()
        .to_string()
}

/// `where` prints one path per line; take the first non-empty one after trimming.
fn where_path(stdout: &str) -> String {
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_string()
}

fn succeeded(outcome: Option<CommandExecutionResult>) -> Option<CommandExecutionResult> {
    outcome.filter(CommandExecutionResult::success)
}

/// A program lookup: the name, the cascade to use, and what has been found so far.
///
/// The ORDER of the probes is the specification (`detector.ts`), so the sequence is written as a
/// sequence. It used to be a resumable state machine feeding an executor; that existed only because
/// the units could not perform their own I/O, and it went with them.
pub struct ProgramProbe {
    name: String,
    lookup: ProgramLookup,
    /// Which of the original's two lookups this is — [`ProgramProbe::find_host_program`] or
    /// [`ProgramProbe::find_scope_program`].
    host_program: bool,
    path: String,
    version: Option<String>,
}

impl ProgramProbe {
    /// `host-client.ts:findHostProgram` — ask THIS machine, whatever scope the connection has.
    ///
    /// The CONTROLLER is why it exists on a scoped connection: `wsl`, `limactl`, `podman` and `ssh`
    /// are what ENTER the scope, so asking the scope where its own controller is would be circular.
    /// The original passes no executor for exactly that reason.
    pub fn find_host_program(name: impl Into<String>, lookup: ProgramLookup) -> Self {
        Self::probing(name, lookup, true)
    }

    /// `host-client.ts:findScopeProgram` — ask through the transport, inside the scope.
    ///
    /// The two are separate methods there and the caller picks between them with `isScoped()`
    /// (`profiles/shared.ts:121`, `dialects/container.ts:92`), so they are separate here and the
    /// caller picks the same way. Which CASCADE runs is [`ProgramLookup`]'s, a different question:
    /// a Windows client looks its own `wsl.exe` up through the registry, while the engine inside
    /// that distribution is asked `which`, `whereis`, then `where`.
    pub fn find_scope_program(name: impl Into<String>, lookup: ProgramLookup) -> Self {
        Self::probing(name, lookup, false)
    }

    fn probing(name: impl Into<String>, lookup: ProgramLookup, host_program: bool) -> Self {
        Self {
            name: name.into(),
            lookup,
            host_program,
            path: String::new(),
            version: None,
        }
    }

    /// `<name>.exe` when the name lacks it — what a Windows probe has to ask for. The POSIX probes
    /// ask for the name as written, which is why this is not applied per LOOKUP: the scoped cascade
    /// uses both spellings, one per leg.
    fn windows_name(&self) -> String {
        if self.name.to_ascii_lowercase().ends_with(".exe") {
            return self.name.clone();
        }
        format!("{}.exe", self.name)
    }

    fn program(&self) -> Program {
        Program {
            auto: None,
            homepage: None,
            name: self.name.clone(),
            // Absent, not empty, when nothing was found: that is what the original persists, and the
            // difference between "no engine here" and "an engine at the empty path" is worth keeping.
            path: Some(self.path.clone()).filter(|it| !it.is_empty()),
            title: None,
            version: self.version.clone(),
        }
    }

    /// `InstallLocation` + `resources/bin` + the exe, joined the way Node's `path.join` would.
    fn path_from_registry(&self, stdout: &str) -> String {
        let Ok(info) = serde_json::from_str::<serde_json::Value>(stdout) else {
            return String::new();
        };
        let location = info
            .get("InstallLocation")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if location.is_empty() {
            return String::new();
        }
        let os = OperatingSystem::WindowsNt;
        join(
            os,
            &join(os, location, "resources/bin"),
            &self.windows_name(),
        )
    }

    /// Find the program and its version, wherever this connection's engine lives.
    ///
    /// A lookup cannot FAIL — a program that is nowhere is an absent path, not an error — which is
    /// why this answers a `Program` rather than a `Result`. The availability check is what turns an
    /// absent path into a diagnostic, once, in one place.
    pub async fn run(
        mut self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) -> Program {
        match self.lookup {
            ProgramLookup::Posix | ProgramLookup::Scoped => {
                self.posix_cascade(host, settings).await
            }
            ProgramLookup::WindowsLocal => self.windows_cascade(host, settings).await,
        }
        self.resolve_version(host, settings).await;
        self.program()
    }

    /// `which`, then `whereis`, then — for a SCOPED lookup only — `where`.
    ///
    /// A local POSIX machine that answers neither `which` nor `whereis` has no `where` to ask; a
    /// scoped one may be a Windows remote in `cmd.exe`, which has neither of the first two.
    async fn posix_cascade(&mut self, host: &dyn HostContext, settings: &EngineConnectorSettings) {
        let which = self
            .ask(
                host,
                HostCommand::new("which", &[self.name.as_str()]),
                settings,
            )
            .await;
        // `which` exits 0 and prints nothing on some shells' builtins, so an empty success is a miss.
        self.path = succeeded(which)
            .map(|outcome| outcome.stdout.trim().to_string())
            .unwrap_or_default();
        if !self.path.is_empty() {
            return;
        }

        let whereis = self
            .ask(
                host,
                HostCommand::new("whereis", &[self.name.as_str()]),
                settings,
            )
            .await;
        self.path = succeeded(whereis)
            .map(|outcome| whereis_path(&outcome.stdout))
            .unwrap_or_default();
        if !self.path.is_empty() || self.lookup != ProgramLookup::Scoped {
            return;
        }

        let name = self.windows_name();
        let found = self
            .ask(host, HostCommand::new("where", &[name.as_str()]), settings)
            .await;
        self.path = succeeded(found)
            .map(|outcome| where_path(&outcome.stdout))
            .unwrap_or_default();
    }

    /// PowerShell's `gcm`, then the uninstall registry key.
    async fn windows_cascade(
        &mut self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) {
        let name = self.windows_name();
        let gcm = self
            .ask(
                host,
                HostCommand::new(
                    "powershell.exe",
                    &["-Command", &format!("((gcm '{name}').Path)")],
                ),
                settings,
            )
            .await;
        self.path = succeeded(gcm)
            .map(|outcome| outcome.stdout.trim().to_string())
            .unwrap_or_default();
        if !self.path.is_empty() {
            return;
        }
        let Some(key) = registry_key(&self.name) else {
            return;
        };
        let found = self
            .ask(
                host,
                HostCommand::new("powershell", &["-Command", &registry_script(key)]),
                settings,
            )
            .await;
        self.path = succeeded(found)
            .map(|outcome| self.path_from_registry(outcome.stdout.trim()))
            .unwrap_or_default();
    }

    /// `findProgramVersion` returns its initialised `""` WITHOUT running anything when the path is
    /// empty. Empty, not absent — the two are distinguishable and the original records the empty one.
    async fn resolve_version(
        &mut self,
        host: &dyn HostContext,
        settings: &EngineConnectorSettings,
    ) {
        if self.path.is_empty() {
            self.version = Some(String::new());
            return;
        }
        let outcome = self.ask(host, version_probe(&self.path), settings).await;
        self.version = outcome
            .as_ref()
            .and_then(|outcome| program_version(&self.path, outcome));
    }

    /// Run one probe where this lookup asks, treating a refusal as "nothing found".
    ///
    /// A scoped transport with no scope REFUSES, and that must not become a local answer: running a
    /// SCOPE lookup unwrapped would find the LOCAL engine and report it as the remote's. A HOST
    /// lookup is not that question — it asks about this machine and says so.
    async fn ask(
        &self,
        host: &dyn HostContext,
        command: HostCommand,
        settings: &EngineConnectorSettings,
    ) -> Option<CommandExecutionResult> {
        if self.host_program {
            return Some(host.run_host_command(&command).await);
        }
        host.run_probe(&command, settings).await.ok()
    }
}
