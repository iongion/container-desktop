//! `resourceSyncProtocol.ts` — what a client is told about a connection.
//!
//! `ConnectionPhase`, `ConnectionRuntimeInfo` and `ConnectOrigin` are declared there verbatim.
//! `ConnectProgress` and `ConnectionStartingStep` are the design's additions to the same stream: the
//! original traces its sub-steps as prose through `startup.phase`, and a core whose clients render
//! their own wording has to carry the vocabulary instead.

use super::connection::ConnectorCapabilities;
use super::diagnostic::{DiagnosticCode, ReportedDiagnostic};
use super::engine::{ApiSurface, ContainerEngine, ContainerEngineHost};

/// What a client is told about the whole application, not one connection —
/// `resourceSyncProtocol.ts`.
///
/// The `resources` half of `ResourceSyncSnapshot` is deliberately absent: resource CRUD stays in
/// `container-client`, and a field nothing can fill is worse than one a client knows to ask for
/// later.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct AppRuntimeSnapshot {
    /// Every running connection's projection. Absent rather than empty when nothing is running,
    /// which is what the oracle's optional field serialises to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<Vec<ConnectionRuntimeInfo>>,
    /// Every connection the settings document holds, running or not.
    pub connections: Vec<ConnectionSummary>,
    /// ALWAYS `None` from this core, and that is the design rather than a gap. `Application` keeps
    /// a current host; `ActiveConnections` deliberately does not, because `connectHostClient` was
    /// written not to mutate a shared "current" so that several connections can run at once. Which
    /// connection is primary is a client presentation choice, and the settings document already
    /// carries `connector.default` for the client that wants one. The field exists because the wire
    /// shape is the oracle's.
    #[serde(
        rename = "currentConnector",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub current_connector: Option<ConnectionSummary>,
    /// The core's clock at the instant this projection was taken, in the same milliseconds
    /// `ConnectionRuntimeInfo::next_retry_at` is expressed in.
    ///
    /// Not the oracle's, and it is the cost of a divergence this port chose on purpose: the
    /// TypeScript `nextRetryAt` is a `Date.now()` wall-clock stamp, so a browser client subtracts
    /// its OWN clock and needs nothing from the server. This one is monotonic and origin-arbitrary
    /// — which is what makes a back-off schedule assertable without sleeping — and there is no
    /// clock anywhere else that it can be compared against. Without this field a client holding a
    /// snapshot can see THAT a retry is pending and never WHEN, and the only way to learn the delay
    /// was to have been attached in time to catch the one progress line carrying both stamps. A
    /// client that attaches DURING a reconnect never sees that line.
    ///
    /// Always present, including when nothing is retrying: a `now` that appeared only alongside a
    /// pending retry would be a clock a client could not calibrate against anything else it holds.
    pub now: i64,
    #[serde(rename = "osType")]
    pub os_type: String,
    /// The APPLICATION's phase, which is not any one connection's: `ready` once the bootstrap has
    /// settled, whatever the individual connections did.
    pub phase: ConnectionPhase,
    pub running: bool,
}
/// One connection as the snapshot lists it — the identity a client needs to show it and address it,
/// without the runtime state that only a RUNNING connection has. Declared inline twice in
/// `resourceSyncProtocol.ts` (`currentConnector` and the `connections` array); one type here,
/// because two copies of a shape are two things to keep in step.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectionSummary {
    /// Which REST vocabulary this connector speaks — `dialect.apiSurface`. Absent for an (engine, host)
    /// pair no release registered, exactly as `capabilities` is.
    ///
    /// **Beside `capabilities` rather than inside it, which is where the original has it**:
    /// `HostClientFacade` carries `capabilities` and `apiSurface` as siblings, and they answer different
    /// questions — what this connector can do, and which spelling it says it in. A client picks its REST
    /// root from this; the design forbids it computing one from `runtimes::`.
    #[serde(
        rename = "apiSurface",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub api_surface: Option<ApiSurface>,
    /// What this connector can do — `profile.adjustCapabilities(dialect.capabilitiesBase)`. Absent
    /// only for an (engine, host) pair no release registered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ConnectorCapabilities>,
    pub engine: ContainerEngine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<ContainerEngineHost>,
    pub id: String,
    pub name: String,
}
wire_enum! {
    /// `ConnectOrigin`
    ConnectOrigin {
        Bootstrap = "bootstrap",
        User = "user",
        Reconnect = "reconnect",
    }
}
/// One line of a connection attempt's progress stream, emitted as each sub-step is entered and on
/// every phase change. The prose equivalent is the app's `startup.phase` trace; this carries the
/// vocabulary instead, so a client renders its own wording.
///
/// `attempt` and `nextRetryAt` are repeated from ConnectionRuntimeInfo on the reconnecting lines
/// deliberately: a client rendering "reconnecting in 2s (attempt 3)" must not have to correlate two
/// streams to do it.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectProgress {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<i64>,
    /// Present when this line reports a failure or a skipped step. A successful sub-step carries
    /// none rather than NOT_CHECKED.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<DiagnosticCode>,
    #[serde(rename = "connectionId")]
    pub connection_id: String,
    #[serde(
        rename = "nextRetryAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub next_retry_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<ConnectOrigin>,
    pub phase: ConnectionPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<ConnectionStartingStep>,
    /// Milliseconds on the core's clock, READ WHEN THIS LINE WAS PRODUCED rather than when the
    /// attempt began.
    ///
    /// The distinction is the whole value of the field: an attempt used to be handed one `now` and
    /// stamp all of `startingScope`, `detecting`, `startingApi`, `checkingAvailability` and `ready`
    /// identically, so the trace recorded that a connect took nine seconds and could never say
    /// which sub-step spent them. The clock is a capability, so under a fake one this is still a
    /// counter a test moves by hand — which is what keeps a back-off schedule assertable without
    /// sleeping.
    ///
    /// The same clock as `AppRuntimeSnapshot::now` and `ConnectionRuntimeInfo::next_retry_at`, and
    /// monotonic with an arbitrary origin: only differences between these stamps mean anything, and
    /// a client must never compare one against a clock of its own.
    pub ts: i64,
}
wire_enum! {
    /// `ConnectionPhase`
    ConnectionPhase {
        Idle = "idle",
        Starting = "starting",
        Ready = "ready",
        Failed = "failed",
        Reconnecting = "reconnecting",
    }
}
/// What a connection is doing right now. A PROJECTION of the connection state machine, never
/// assembled by hand at publish time — that is what keeps the published phase and the actual state
/// from disagreeing. Mirrors the TypeScript interface of the same name in
/// resourceSyncProtocol.ts, with one deliberate difference: `error` carries a diagnostic CODE
/// rather than an English string.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ConnectionRuntimeInfo {
    /// The command this connection reaches its engine by, when there is no local address at all.
    /// Present exactly when `uri` is absent for that reason: an engine inside a WSL distribution or
    /// a podman machine binds a socket this machine cannot open, so the data plane is a spawned
    /// command's stdin and stdout (the design's `Stdio`). Already persisted on the connection as
    /// `api.connection.dialStdioCommand`, so this exposes nothing a client could not already read —
    /// what it adds is that the PROJECTION stops presenting a derived path as the address. A client
    /// that showed one would be naming a socket nothing binds.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bridge: Option<Vec<String>>,
    /// Which retry of the current back-off cycle is pending. Absent while `ready`: a live
    /// connection has no attempt in flight, and the oracle clears it too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt: Option<i64>,
    /// What this connector can do, host-adjusted — `runtimes::registry::capabilities`. Gates
    /// real-vs-no-op for every extension group, so a client renders from this and never from the
    /// engine's identity. Absent only for an (engine, host) pair no release registered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<ConnectorCapabilities>,
    pub engine: ContainerEngine,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ReportedDiagnostic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<ContainerEngineHost>,
    pub id: String,
    pub name: String,
    /// When the pending retry fires, in milliseconds on the clock the core was handed. Monotonic
    /// and origin-arbitrary, unlike the TypeScript field, which is a Date.now() wall-clock stamp: a
    /// server converts at the edge.
    #[serde(
        rename = "nextRetryAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub next_retry_at: Option<i64>,
    pub phase: ConnectionPhase,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reconnecting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay: Option<String>,
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Which sub-step of `starting` the connection is in, and absent whenever it is in none — which
    /// is every phase but `starting`, plus the instant before the first sub-step is entered.
    ///
    /// Not the oracle's, and the same divergence `AppRuntimeSnapshot::now` is: the original traces
    /// its sub-steps as prose through `startup.phase`, and a core whose clients render their own
    /// wording carries the vocabulary instead. Without it a client that attaches DURING
    /// an attempt is told `starting` and can say nothing more for the 51 to 56 seconds
    /// `spawn_service` spends polling a socket, because the sub-step lived only in the progress
    /// LINES — which such a client was not attached to hear.
    ///
    /// It is also what makes the projection MOVE between sub-steps. `Clients::publish` will not
    /// re-send state that has not changed, and before this field there was nothing in the
    /// projection for a sub-step to move, so one state was published per attempt however long it
    /// ran. A client that has not drained its queue is still handed exactly ONE — unread state is
    /// SUPERSEDED where a trace never is — and what it is handed is the newest, which is the
    /// sub-step the attempt is standing in.
    #[serde(
        rename = "startingStep",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub starting_step: Option<ConnectionStartingStep>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// The user-facing engine version detection resolved — the controller's when a scope reports
    /// one, else the program's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Whether anything is watching this connection for its engine going away. Absent when the
    /// question does not arise — a connection that is not up has nothing to watch.
    ///
    /// `false` is a REAL and permanent state rather than a transient one, and Apple's `container`
    /// is the measured case: socktainer routes `/events` and then writes nothing at all, so the
    /// watcher stands down instead of re-attaching in a loop. Such a connection keeps working and
    /// nothing will notice when it stops — which is exactly the thing a client has to be able to
    /// say, and could not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watched: Option<bool>,
}
wire_enum! {
    /// The sub-steps of the `starting` phase, in the fixed order
    /// docs/architecture/connection-startup.md calls invariant across every host type: start the
    /// scope, detect settings, start the API, check availability. This is the structured equivalent
    /// of the app's `startup.phase` traces, and the granularity a client's progress view gets —
    /// coarser here than in the desktop app would make a client worse than the app for no reason
    ///.
    ConnectionStartingStep {
        StartingScope = "startingScope",
        Detecting = "detecting",
        StartingApi = "startingApi",
        CheckingAvailability = "checkingAvailability",
    }
}
