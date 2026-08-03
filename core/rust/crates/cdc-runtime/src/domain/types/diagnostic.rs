//! the design's vocabulary: the code a refusal carries, how bad it is, and one entry of a report.
//!
//! No counterpart under `container-client/src/types/` — the original throws English sentences, and
//! the codes that replace them are this port's own. They live HERE, with the model, because that is
//! what they are: the wire vocabulary a client renders. What a unit refuses WITH is behaviour and
//! stays in [`crate::domain::diagnostic`].
//!
//! The code list is an INTERFACE. Adding a code is additive and safe; changing or removing one
//! breaks clients.
//!
//! **This file is the one module of the model that the gates MEASURE**, and the exclusion lists in
//! `.cargo/mutants.toml` and the Makefile's `COVERAGE_ARGS` name the other ten one at a time rather
//! than taking `domain/types/**` wholesale. The rest of the model is shapes and derives with no
//! behaviour to mutate; this one carries a RULE — that a code this build does not know is kept
//! rather than refused — and a rule no gate can see is the failure mode this tree has paid for
//! twice. Adding a type module leaves it measured until someone excludes it deliberately, which is
//! the safe direction for that mistake to run in.

/// One entry in an availability report: a code, its parameters, and how bad it is.
///
/// NOT the same type as a unit's refusal (`domain::diagnostic::Diagnostic`), and the difference is
/// real rather than cosmetic: a refusal is always a failure, while a report entry also has to
/// express `ok` and `not checked`. Two names, because `machine.rs` used to import this one under an
/// alias to tell them apart — which is a type asking to be renamed.
#[derive(serde::Deserialize, serde::Serialize, Clone, Debug, PartialEq)]
pub struct ReportedDiagnostic {
    pub code: DiagnosticCode,
    /// Typed parameters for the client's rendering — e.g. { program, searched } for
    /// PROGRAM_NOT_FOUND. Never prose.
    #[serde(default, skip_serializing_if = "serde_json::Map::is_empty")]
    pub params: serde_json::Map<String, serde_json::Value>,
    pub severity: DiagnosticSeverity,
}
/// The code vocabulary is an INTERFACE: adding a code is additive and safe, changing or removing one
/// breaks clients.
///
/// **Open, and that is the whole point of the type.** A client with no mapping for a code must render
/// the code and its parameters rather than nothing, so that a new diagnostic never requires a client
/// release — states it as a consequence and this enum's first consumer found that a CLOSED
/// enum cannot keep the promise: an unrecognised code made the whole frame undecodable, so what
/// reached the person was "this frame could not be read" rather than the code that arrived. A client
/// that decodes a code into a string (the TypeScript oracle, and Go) gets the promise for free;
/// [`DiagnosticCode::Unknown`] is what buys it here, and it is why this type is neither `Copy` nor
/// derived.
///
/// **Three codes were WITHDRAWN before the protocol had an out-of-tree client**, having been declared
/// and never raised: `PROGRAM_VERSION_UNREADABLE` (the version parse answers with an empty version
/// rather than refusing, which is what the oracle does), `CONTROLLER_NOT_FOUND` (decided at
/// `6a31fb08` — this core has no separate controller phase, so a missing controller surfaces as
/// `PROGRAM_NOT_FOUND` or `SCOPE_NOT_SET` from the transport that wanted it, finding 2) and
/// `PORT_NOT_PUBLISHED` (reachability's published-port check is not ported,). Each
/// is re-added WITH its producer and not before. Append-only protects clients that exist, and the
/// only ones today are in this tree; a vocabulary that describes codes nobody can ever receive is a
/// specification of nothing, which is what the design's exit criteria forbid.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum DiagnosticCode {
    NotChecked,
    ProgramNotFound,
    ScopeNotSet,
    ScopeNotFound,
    ScopeNotUsable,
    EngineNotAvailableOnOs,
    EngineNotAvailableOnArch,
    HostNotSupported,
    ApiUnreachable,
    ApiSocketUnresolved,
    ApiBaseUrlNotSet,
    ApiBridgeNotFound,
    /// A forwarded request this core will not send as asked, naming the field: an axios `params`
    /// object it cannot serialize the way axios would, or a missing `url`. A refusal rather than a
    /// best effort, because a half-serialized query asks a different question and looks like a
    /// right answer.
    ProxyRequestInvalid,
    /// A frame this server could not read as a request: not JSON, not a command it knows, or a
    /// protocol version it does not speak — naming the field. Answered rather than dropped, because
    /// a client waiting on a correlation id cannot tell a refusal it never received from a server
    /// that has not finished, and it echoes that id back so one bad call fails instead of the
    /// session.
    RequestInvalid,
    SshUnreachable,
    SshAuthFailed,
    SshHostKeyChanged,
    SshForwardFailed,
    /// A code from a server this build does not know, carried verbatim.
    ///
    /// **Never produced by this core** — [`DiagnosticCode::VOCABULARY`] is what it raises, and this
    /// variant is deliberately outside it. It exists only on the reading side, where the alternative
    /// is refusing a frame that is perfectly well-formed and one field newer than this build.
    Unknown(String),
}

impl DiagnosticCode {
    /// Every code this core RAISES, for a caller that has to walk the vocabulary — the specification
    /// test does, the terminal's rendering does, and so would a `--list-codes`.
    ///
    /// **One list, and it is the one [`DiagnosticCode::from`] reads.** A second copy written as a
    /// `match` is a second thing to keep in step, and the `_` arm of such a match is exactly where a
    /// forgotten code would hide — it would decode as [`DiagnosticCode::Unknown`] and render as its
    /// own name, which looks like a server one version ahead rather than like a bug here. The
    /// explicit length is the other half: appending a variant without extending this does not
    /// compile.
    pub const VOCABULARY: [Self; 18] = [
        Self::NotChecked,
        Self::ProgramNotFound,
        Self::ScopeNotSet,
        Self::ScopeNotFound,
        Self::ScopeNotUsable,
        Self::EngineNotAvailableOnOs,
        Self::EngineNotAvailableOnArch,
        Self::HostNotSupported,
        Self::ApiUnreachable,
        Self::ApiSocketUnresolved,
        Self::ApiBaseUrlNotSet,
        Self::ApiBridgeNotFound,
        Self::ProxyRequestInvalid,
        Self::RequestInvalid,
        Self::SshUnreachable,
        Self::SshAuthFailed,
        Self::SshHostKeyChanged,
        Self::SshForwardFailed,
    ];

    /// The code as it travels: `SCREAMING_SNAKE_CASE`, and for an unknown one the text that arrived.
    ///
    /// Borrowed rather than owned so that a renderer can reach the raw code of an unknown without
    /// allocating, which is the one thing it has to show.
    pub fn as_str(&self) -> &str {
        match self {
            Self::NotChecked => "NOT_CHECKED",
            Self::ProgramNotFound => "PROGRAM_NOT_FOUND",
            Self::ScopeNotSet => "SCOPE_NOT_SET",
            Self::ScopeNotFound => "SCOPE_NOT_FOUND",
            Self::ScopeNotUsable => "SCOPE_NOT_USABLE",
            Self::EngineNotAvailableOnOs => "ENGINE_NOT_AVAILABLE_ON_OS",
            Self::EngineNotAvailableOnArch => "ENGINE_NOT_AVAILABLE_ON_ARCH",
            Self::HostNotSupported => "HOST_NOT_SUPPORTED",
            Self::ApiUnreachable => "API_UNREACHABLE",
            Self::ApiSocketUnresolved => "API_SOCKET_UNRESOLVED",
            Self::ApiBaseUrlNotSet => "API_BASE_URL_NOT_SET",
            Self::ApiBridgeNotFound => "API_BRIDGE_NOT_FOUND",
            Self::ProxyRequestInvalid => "PROXY_REQUEST_INVALID",
            Self::RequestInvalid => "REQUEST_INVALID",
            Self::SshUnreachable => "SSH_UNREACHABLE",
            Self::SshAuthFailed => "SSH_AUTH_FAILED",
            Self::SshHostKeyChanged => "SSH_HOST_KEY_CHANGED",
            Self::SshForwardFailed => "SSH_FORWARD_FAILED",
            Self::Unknown(code) => code,
        }
    }

    /// Whether this build recognises the code, for a caller that treats the two differently.
    pub fn is_known(&self) -> bool {
        !matches!(self, Self::Unknown(_))
    }

    fn known(value: &str) -> Option<Self> {
        Self::VOCABULARY
            .iter()
            .find(|code| code.as_str() == value)
            .cloned()
    }
}

impl std::fmt::Display for DiagnosticCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// **`From` rather than `TryFrom`, because reading a code cannot fail** — which is the difference
/// this type has from every other wire enum in the model, and the reason it does not carry their
/// `FromStr` + three `TryFrom`s. A `Result` that is always `Ok` would say a refusal is possible here
/// and send every caller through a branch that cannot be taken.
impl From<&str> for DiagnosticCode {
    fn from(value: &str) -> Self {
        Self::known(value).unwrap_or_else(|| Self::Unknown(value.to_string()))
    }
}

impl From<String> for DiagnosticCode {
    fn from(value: String) -> Self {
        match Self::known(&value) {
            Some(code) => code,
            // The one that arrived, moved rather than copied: an unknown code is the only case that
            // owns anything, and it already owns exactly the right string.
            None => Self::Unknown(value),
        }
    }
}

/// Hand-written on both halves, and they must stay each other's inverse.
///
/// A derive would spell [`DiagnosticCode::Unknown`] as `{"Unknown": "…"}` — the externally-tagged
/// shape serde gives a newtype variant — so a code this build did not recognise would come back onto
/// the wire as an object where every other code is a string. What the next hop reads would then
/// depend on which build forwarded it.
impl serde::Serialize for DiagnosticCode {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> serde::Deserialize<'de> for DiagnosticCode {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(Self::from)
    }
}
wire_enum! {
    /// `DiagnosticSeverity`
    DiagnosticSeverity {
        Ok = "ok",
        Warn = "warn",
        Err = "err",
    }
}
