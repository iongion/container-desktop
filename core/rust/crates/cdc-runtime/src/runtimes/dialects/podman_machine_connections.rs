//! `runtimes/dialects/podman-machine-connections.ts` — `podman system connection list`, parsed once.
//!
//! Podman gives every machine TWO connections: `<machine>` (rootless) and `<machine>-root` (rootful).
//! Container Desktop targets ROOTLESS podman only, so every selection here prefers the rootless
//! connection — even when podman marks the rootful one as `Default`, which it does on some WSL
//! machines.
//!
//! The original parses this output in three places (the transport's scope selection, the native-pipe
//! picker and the SSH bridge) and re-derives the shape each time. One typed parse is idiomatic
//! mechanics, not a change of domain: the fields are the same fields.

/// The argv that produces what [`parse_system_connections`] reads.
///
/// Here rather than at the two call sites for [`crate::runtimes::transports::shared::api_answers`]'s
/// reason: it is ONE question, asked by the podman-machine transport to pick a scope and by the SSH
/// transport to find a machine to bridge into, and a call site that spelled it out for itself would be
/// free to ask podman something the parser does not read. The launcher is NOT here — one asks through
/// the controller and the other through the engine, and that difference is real.
pub const SYSTEM_CONNECTION_LIST_ARGS: [&str; 5] =
    ["system", "connection", "list", "--format", "json"];

/// One entry of `podman system connection list --format json`.
///
/// Every field defaults, because the list is an ENGINE's output and an older podman omits what it does
/// not have — a missing `IsMachine` must read as "not a machine", never as a parse failure that hides
/// every other entry.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
pub struct PodmanSystemConnection {
    #[serde(rename = "Name", default)]
    pub name: String,
    #[serde(rename = "URI", default)]
    pub uri: String,
    #[serde(rename = "Identity", default)]
    pub identity: String,
    #[serde(rename = "IsMachine", default)]
    pub is_machine: bool,
    #[serde(rename = "Default", default)]
    pub default: bool,
}

/// The connections podman reported. Unparseable output is NO connections, exactly as the original's
/// `catch` leaves it: a listing failure, not a crash.
pub fn parse_system_connections(stdout: &str) -> Vec<PodmanSystemConnection> {
    serde_json::from_str(stdout).unwrap_or_default()
}

/// The rootful suffix podman appends — `<machine>-root`.
const ROOTFUL_SUFFIX: &str = "-root";

/// Whether a connection name is the ROOTFUL one.
pub fn is_rootful_connection_name(name: &str) -> bool {
    let trimmed = name.trim();
    trimmed.len() > ROOTFUL_SUFFIX.len()
        && trimmed[trimmed.len() - ROOTFUL_SUFFIX.len()..].eq_ignore_ascii_case(ROOTFUL_SUFFIX)
}

/// A connection name mapped back to its MACHINE name, by stripping the rootful suffix.
pub fn machine_name_from_connection_name(name: &str) -> &str {
    let trimmed = name.trim();
    if is_rootful_connection_name(trimmed) {
        return &trimmed[..trimmed.len() - ROOTFUL_SUFFIX.len()];
    }
    trimmed
}

/// The connection to use out of a list of machine connections.
///
/// Prefers a ROOTLESS one, honouring `Default` among those; only when there is no rootless connection
/// at all does it fall back to the `Default` (or first) rootful entry — a machine that offers nothing
/// else is still better than nothing.
pub fn prefer_rootless_machine_connection(
    machines: &[PodmanSystemConnection],
) -> Option<&PodmanSystemConnection> {
    if machines.is_empty() {
        return None;
    }
    let rootless: Vec<&PodmanSystemConnection> = machines
        .iter()
        .filter(|entry| !is_rootful_connection_name(&entry.name))
        .collect();
    let pool: Vec<&PodmanSystemConnection> = if rootless.is_empty() {
        machines.iter().collect()
    } else {
        rootless
    };
    pool.iter()
        .find(|entry| entry.default)
        .or_else(|| pool.first())
        .copied()
}

/// Which machine backs podman's default connection, and how that was decided.
///
/// The original returns the name alongside an English `reason` it then logs. A code carries the same
/// facts without the prose: the connection that was chosen, the machine it mapped to, and
/// which of the three ways the mapping happened — because a scope failure has to name the connection
/// and the machines, not say "no default scope".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultMachineScope {
    /// `podman system connection list` answered nothing.
    NoConnections,
    /// The default connection named a machine that exists.
    Matched {
        connection: String,
        machine: String,
        /// The default connection was the ROOTFUL one and was remapped to its rootless machine.
        rootful_remapped: bool,
    },
    /// The default connection named no known machine, and there is exactly one machine to use.
    OnlyMachine { connection: String, machine: String },
    /// The default connection named a machine that is not among the ones this host has.
    NoMatch { connection: String, machine: String },
}

impl DefaultMachineScope {
    /// The machine to use, when there is one.
    pub fn machine(&self) -> Option<&str> {
        match self {
            Self::Matched { machine, .. } | Self::OnlyMachine { machine, .. } => Some(machine),
            Self::NoConnections | Self::NoMatch { .. } => None,
        }
    }
}

/// Choose the machine scope that backs podman's default connection.
///
/// Prefers the rootless machine connection, maps it to a machine name, and matches that against the
/// machines this host has, case-insensitively. When the mapped name is unknown but exactly one machine
/// exists, that sole machine is used — a connection list that disagrees with the machine list is
/// podman's business, and refusing to connect over it would strand a working machine.
pub fn select_default_machine_scope_name(
    connections: &[PodmanSystemConnection],
    machine_names: &[String],
) -> DefaultMachineScope {
    let machines: Vec<PodmanSystemConnection> = connections
        .iter()
        .filter(|entry| entry.is_machine)
        .cloned()
        .collect();
    // The fallback is the FIRST entry rather than the preferred rootless one, as the original falls
    // back: with no machine connection at all there is nothing to prefer between.
    let Some(chosen) =
        prefer_rootless_machine_connection(&machines).or_else(|| connections.first())
    else {
        return DefaultMachineScope::NoConnections;
    };
    let connection = chosen.name.trim().to_string();
    let mapped = machine_name_from_connection_name(&connection).to_string();
    let matched = machine_names
        .iter()
        .find(|name| name.trim().eq_ignore_ascii_case(&mapped));
    if let Some(machine) = matched {
        return DefaultMachineScope::Matched {
            rootful_remapped: is_rootful_connection_name(&connection),
            machine: machine.clone(),
            connection,
        };
    }
    if let [only] = machine_names {
        return DefaultMachineScope::OnlyMachine {
            connection,
            machine: only.clone(),
        };
    }
    DefaultMachineScope::NoMatch {
        connection,
        machine: mapped,
    }
}
