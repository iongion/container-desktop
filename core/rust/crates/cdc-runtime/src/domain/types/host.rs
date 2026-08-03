//! `types/host.ts` — what starting a host answered.

/// `ProgramOutput` — what a program wrote, as a resource carries it. Distinct from
/// [`CommandExecutionResult`](crate::capabilities::command::CommandExecutionResult), which also
/// carries the exit code and the argv: this is the two streams alone, which is all a pod's `Logs`
/// field holds.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct ProgramOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
}
wire_enum! {
    /// The result of starting a SCOPE. This is NOT the connection phase — conflating the two is how
    /// the TypeScript lifecycle became hard to follow.
    StartupStatus {
        Started = "started",
        Stopped = "stopped",
        Running = "running",
        Error = "error",
    }
}
