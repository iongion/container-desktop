//! `types/engine.ts` — the engine, its host, and what detection found.
//!
//! `ApiSurface` is the one type here the original declares elsewhere (`runtimes/facade.ts`): it is
//! the third member of the same "what engine is this" vocabulary as `ContainerEngine` and
//! `ContainerEngineHost`, and splitting it off into a module of its own would name a concept the
//! original does not have. `AvailabilityReport` replaces the English strings the original's
//! `EngineConnectorAvailability.report` carries with codes, so it lives beside the
//! field it belongs to.

use super::diagnostic::ReportedDiagnostic;

wire_enum! {
    /// The REST shape a host speaks: "libpod" for Podman, "docker" for Docker and Apple via
    /// socktainer.
    ApiSurface {
        Docker = "docker",
        Libpod = "libpod",
    }
}
/// `AvailabilityCheck`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct AvailabilityCheck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    pub success: bool,
}
/// One diagnostic per check. The TypeScript equivalent holds English strings; this holds codes.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct AvailabilityReport {
    pub api: ReportedDiagnostic,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<ReportedDiagnostic>,
    #[serde(
        rename = "controllerScope",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub controller_scope: Option<ReportedDiagnostic>,
    /// Raw, verbatim failure detail (SSH preflight output, stderr). Surfaced unabridged so a real
    /// failure is never reduced to a terse placeholder. NOT a diagnostic code, and never exported
    /// as a telemetry attribute — it can contain hostnames and paths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub host: ReportedDiagnostic,
    pub program: ReportedDiagnostic,
}
wire_enum! {
    /// The member is `Apple`, as `types/engine.ts` names it, and the wire value is "container" —
    /// Apple's own name for the tool (github.com/apple/container). Naming the VARIANT `Container`
    /// inside this crate is what the original avoids for the obvious reason: it reads as a
    /// container. Apple speaks the Docker REST surface through socktainer, so its `ApiSurface` is
    /// `Docker` while its dialect is its own.
    ContainerEngine {
        Podman = "podman",
        Docker = "docker",
        Apple = "container",
    }
}
wire_enum! {
    /// Engine, virtualization and remoteness encoded in one dotted string. The SUFFIX is
    /// load-bearing: reachability/model.ts:resolveTransport classifies transport from it (.remote
    /// -> ssh, .wsl -> wsl, .lima/.vendor -> vm, otherwise native). A value with the wrong suffix
    /// silently selects the wrong hop diagram.
    ContainerEngineHost {
        PodmanNative = "podman.native",
        PodmanVirtualizedWsl = "podman.virtualized.wsl",
        PodmanVirtualizedLima = "podman.virtualized.lima",
        PodmanVirtualizedVendor = "podman.virtualized.vendor",
        PodmanRemote = "podman.remote",
        DockerNative = "docker.native",
        DockerVirtualizedWsl = "docker.virtualized.wsl",
        DockerVirtualizedLima = "docker.virtualized.lima",
        DockerVirtualizedVendor = "docker.virtualized.vendor",
        DockerRemote = "docker.remote",
        AppleNative = "container.native",
        AppleRemote = "container.remote",
    }
}
/// What OS the ENGINE is running on, as `GET /info` reports it — the guest's, which is not this
/// host's whenever the connection is scoped.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Distribution {
    pub distribution: String,
    pub variant: String,
    pub version: String,
}
/// A Program plus the scope it operates in. Present exactly when the host is scoped — an invariant
/// JSON Schema cannot express here
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct Controller {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
/// `EngineConnectorAvailability`
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct EngineConnectorAvailability {
    pub api: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub controller: Option<bool>,
    #[serde(
        rename = "controllerScope",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub controller_scope: Option<bool>,
    pub enabled: bool,
    pub host: bool,
    pub program: bool,
    pub report: AvailabilityReport,
}
/// One named endpoint an engine's CLI can be pointed at — a Docker CONTEXT. Not a
/// ControllerScope: a scope is a place a command is run INSIDE, and this is a choice of endpoint on
/// the machine the command already runs on. The endpoint keeps its scheme, unlike the socket a
/// dialect reports.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, Default, PartialEq)]
pub struct EngineContext {
    /// Whether the CLI would select this one today. A connection that names no context follows it,
    /// which is exactly what the design's defect is.
    #[serde(rename = "Current", default)]
    pub current: bool,
    #[serde(rename = "Description", default)]
    pub description: String,
    #[serde(rename = "DockerEndpoint", default)]
    pub endpoint: String,
    /// What the CLI said is wrong with the context's own definition. EMPTY for a context whose
    /// endpoint is merely dead — `ls` reports a broken store, never an unreachable daemon.
    #[serde(rename = "Error", default)]
    pub error: String,
    #[serde(rename = "Name", default)]
    pub name: String,
}
wire_enum! {
    /// `Presence`
    Presence {
        Available = "available",
        Missing = "missing",
        Unknown = "unknown",
    }
}
/// An engine or helper program as the app persists it. `path` is optional and `version` may be an
/// empty string: both are outputs of detection, and detection is allowed to fail.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct Program {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    pub name: String,
    /// ABSENT when detection found nothing: findProgramPath returns undefined and JSON.stringify
    /// drops the key, so a machine without the engine persists a program with a name and no path.
    /// Discovered by the detect-program-not-found scenario, which could not be expressed while this
    /// was required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}
