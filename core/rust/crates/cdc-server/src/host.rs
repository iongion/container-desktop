//! The native host: what a connection is built from on a machine with a kernel.
//!
//! **A server IS a host, and this is the one module that says which one.** Everything else in this crate
//! is generic over its capabilities — [`crate::server::Server`] over `FsLocks`, `MachineBuilder` and
//! `Clock`, the listener over all three — so the platform is chosen exactly here and nowhere else
//!. That is what keeps the crate testable against fakes and what would let a second host
//! (an embedder, a Go caller's bridge) be a sibling module rather than a rewrite.
//!
//! **What a connection needs that the connection does not carry** is [`ConnectionContext`], and every
//! field of it is read from the machine ONCE, here, then travels as data: the OS, the architecture,
//! `PODMAN_HOST`/`DOCKER_HOST`, the reconnect policy from the document, `$HOME`, the user data
//! directory, and the controller scopes out of the real `~/.ssh/config`. The runtime never reads any of
//! them itself — that is the whole reason it can be handed a fake and asked the same questions.
//!
//! **Read once per CONNECT, not once per process**, for two of them: the reconnect policy and the
//! scopes both live in files a user edits while the server is running. A scope list captured at startup
//! is a server that cannot see a host added to `~/.ssh/config` ten minutes ago, and that is a bug
//! report about the wrong thing. A server runs for weeks; a window is restarted far more often than
//! that, which is why the desktop app can get away with reading them once and this cannot.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use cdc_runtime::domain::machine::{ConnectionCapabilities, ConnectionContext, ConnectionMachine};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::network::ProxyConfig;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;
use cdc_runtime::runtimes::composition::EngineEnvironment;
use cdc_runtime::settings::store::SettingsStore;
use cdc_runtime_host_native::backoff::JitteredBackoff;
use cdc_runtime_host_native::command::TokioCommand;
use cdc_runtime_host_native::fs::{StdFs, SystemClock};
use cdc_runtime_host_native::http::TokioHttp;
use cdc_runtime_host_native::paths;
use cdc_runtime_host_native::ssh_config::list_scopes;

use crate::server::{MachineBuilder, Server};

/// The file name of the local socket, under the same directory the desktop app keeps its settings in.
///
/// Beside `user-settings.json` deliberately: the socket belongs to the same user, on the same machine,
/// as the document it is serving, and a server whose socket lives somewhere else is a server somebody
/// will end up running twice.
#[cfg(unix)]
pub const LOCAL_SOCKET_NAME: &str = "cdc-server.sock";

/// Where a Windows client looks. A named pipe is not a file, so it is not under the data directory —
/// the name IS the address, and it must be the same string a client can be told about.
#[cfg(windows)]
pub const LOCAL_PIPE_NAME: &str = r"\\.\pipe\cdc-server";

/// Where the version this process claims to be the APP's arrives from.
///
/// **The document's `version` key is the APP's version**, so a process that wrote its own
/// crate version there would tell the desktop app it had been downgraded. Read from the environment so
/// the two can be kept in step by whatever ships them.
pub const APP_VERSION_VAR: &str = "CONTAINER_DESKTOP_VERSION";

/// The app version this process writes into the document it edits.
///
/// **In the library rather than in a binary's `main`, because there are now two binaries** — the server
/// and the terminal, whose embedded server edits the same file — and a rule that lived in one `main`
/// would be a rule the other could get subtly wrong.
pub fn app_version() -> String {
    std::env::var(APP_VERSION_VAR).unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string())
}

/// The default local endpoint on this platform.
pub fn default_local_endpoint() -> PathBuf {
    #[cfg(unix)]
    {
        paths::current_user_data_path().join(LOCAL_SOCKET_NAME)
    }
    #[cfg(windows)]
    {
        PathBuf::from(LOCAL_PIPE_NAME)
    }
}

/// What a session over this host is shared through, as a name a caller can write down.
///
/// **Here rather than at the caller**, because this is the module that picks the platform:
/// a binary that spelled `Shared<StdFs, NativeMachines, SystemClock>` out for itself would be a second
/// place the platform is chosen, and would have to depend on the host crate to say the first two words
/// of it. An embedded client names this to hold the server it runs in its own process.
pub type NativeShared = crate::listen::session::Shared<StdFs, NativeMachines, SystemClock>;

/// A server over this machine's real capabilities, reading the document the desktop app is using.
///
/// **The same file, deliberately.** A core that resolved anything else would look like it worked while
/// managing a parallel universe of connections — which is `paths::current_user_settings_path`'s own
/// warning, and it applies to a headless server more than to anything, because nobody is watching a
/// window to notice.
pub fn native_server(app_version: &str) -> Server<StdFs, NativeMachines, SystemClock> {
    server_at(&paths::current_user_settings_path(), app_version)
}

/// The same server over a document named outright.
///
/// The path is the ONLY thing [`native_server`] reads from the environment, so a caller that already
/// knows which document it wants says so instead of relocating the whole process — which the live
/// suite used to do with `CONTAINER_DESKTOP_USER_DATA_DIR`, and which edition 2024 makes `unsafe`
/// for the reason it always was: the test harness is multi-threaded and the environment is not.
pub fn server_at(
    settings_path: &Path,
    app_version: &str,
) -> Server<StdFs, NativeMachines, SystemClock> {
    Server::new(
        SettingsStore::new(StdFs, settings_path, app_version),
        NativeMachines::new(settings_path, app_version),
        SystemClock,
        paths::current_os(),
    )
}

/// Builds a [`ConnectionMachine`] from this machine's real capabilities.
///
/// The capabilities are shared across every connection — `Arc`s of one `TokioCommand`, one `StdFs`, one
/// `TokioHttp` — because they hold the state that has to be shared: `TokioCommand` owns the SERVICE
/// TABLE, which is how a tunnel started for one connect is found and killed by the next disconnect. A
/// fresh capability per machine would leave every `ssh -NL` with no handle anywhere, which is the leak
/// the design names.
pub struct NativeMachines {
    command: Arc<TokioCommand>,
    fs: Arc<StdFs>,
    http: Arc<TokioHttp>,
    /// The SAME clock the server stamps its snapshots with, so `ConnectProgress::ts`,
    /// `ConnectionRuntimeInfo::next_retry_at` and `AppRuntimeSnapshot::now` are all readings of one
    /// clock. A client subtracts them from each other; two clocks would make that arithmetic quietly
    /// meaningless.
    clock: Arc<SystemClock>,
    /// A second reader of the same document the server reads, for the one setting a CONNECTION does not
    /// carry: the global reconnect policy. Its own handle rather than the server's, because a builder is
    /// asked for a machine while the server is mid-command and holding its own lock. The global
    /// PROXY is read the same way, and for the same reason.
    settings: SettingsStore<StdFs>,
    /// The APP's version, for the `User-Agent` a request to an engine carries. Held rather than read
    /// again from the environment: the document stamp and the header must name one version, and two
    /// reads of a mutable environment are two chances for them not to.
    app_version: String,
}

impl NativeMachines {
    pub fn new(settings_path: impl AsRef<std::path::Path>, app_version: &str) -> Self {
        Self {
            command: Arc::new(TokioCommand::default()),
            fs: Arc::new(StdFs),
            http: Arc::new(TokioHttp),
            clock: Arc::new(SystemClock),
            settings: SettingsStore::new(StdFs, settings_path, app_version),
            app_version: app_version.to_string(),
        }
    }
}

impl MachineBuilder for NativeMachines {
    /// **The back-off is JITTERED here, and nowhere else.** The domain computes
    /// the ceiling and cannot draw — randomness in a pure domain is a schedule no transcript can pin —
    /// so `BackoffSchedule` is the seam, and the first thing to schedule real retries is the server,
    /// which is now [`crate::supervise`]. Without it, one event
    /// that drops many connections at once — a VPN reconnecting, a laptop waking, an engine restarting
    /// under a dozen of them — has every one of them compute the same delay from the same policy and
    /// arrive together, then arrive together again on the doubled delay. `DeterministicBackoff` stays
    /// the default the machine constructs, because that is the one a test asserts against.
    fn build(&self, connection: Connection) -> ConnectionMachine {
        ConnectionMachine::new(
            ConnectOptions {
                connection,
                // `start_api` is what makes a resolved uri mean anything: the server's job is
                // to hand a caller a dialable engine API, so it opens whatever the transport needs. A
                // server that connected without it would report `ready` for a socket nothing can reach.
                start_api: true,
                skip_availability_check: false,
                origin: None,
            },
            self.context(),
            ConnectionCapabilities {
                command: Arc::clone(&self.command) as Arc<_>,
                fs: Arc::clone(&self.fs) as Arc<_>,
                http: Arc::clone(&self.http) as Arc<_>,
                clock: Arc::clone(&self.clock) as Arc<_>,
            },
        )
        .with_backoff(Box::new(JitteredBackoff::system()))
    }
}

impl NativeMachines {
    /// `GlobalUserSettings.reconnect`, read fresh.
    ///
    /// Absent — no key, an unreadable document, or a shape this core does not model — normalizes to the
    /// oracle's own default of enabled with a 1s-to-30s back-off (`ConnectionContext::reconnect`), which
    /// is what the app itself does when a user has never touched the setting. So an unreadable document
    /// costs the user's PREFERENCE and never the reconnect: a server that stopped retrying because a
    /// JSON key was missing would be the worse failure by far.
    fn reconnect_policy(&self) -> Option<ReconnectPolicy> {
        self.global("reconnect")
    }

    /// `GlobalUserSettings.proxy`, read fresh, and absence means no proxy.
    ///
    /// Same rule as the policy above and the same reason: an unreadable document costs the user's
    /// PREFERENCE and never the connection. What it costs here is that engine processes are started
    /// without proxy variables, which is the state of a machine that never configured one.
    ///
    /// Public because it is the only way to ask what this read decided: the policy beside it is
    /// observable through `ConnectionMachine::policy`, while a proxy travels into the machine's
    /// context and out again as an ENVIRONMENT on a command nothing hermetic can run.
    pub fn global_proxy(&self) -> Option<ProxyConfig> {
        self.global("proxy")
    }

    /// One key of the settings document, as this core models it — or nothing, however it failed.
    fn global<T: serde::de::DeserializeOwned>(&self, key: &str) -> Option<T> {
        let document = self.settings.read().ok()?;
        let declared = document.as_value().get(key)?.clone();
        serde_json::from_value(declared).ok()
    }

    fn context(&self) -> ConnectionContext {
        let os = paths::current_os();
        let home = std::env::var(paths::home_variable(std::env::consts::OS)).unwrap_or_default();
        ConnectionContext {
            os,
            arch: architecture(std::env::consts::ARCH),
            app_version: self.app_version.clone(),
            environment: EngineEnvironment {
                docker_host: std::env::var("DOCKER_HOST").ok(),
                podman_host: std::env::var("PODMAN_HOST").ok(),
            },
            reconnect: self.reconnect_policy(),
            proxy: self.global_proxy(),
            log_level: "warn".to_string(),
            is_flatpak: is_flatpak(os),
            scopes: scopes(&home),
            home,
            user_data_path: paths::current_user_data_path()
                .to_string_lossy()
                .into_owned(),
        }
    }
}

/// Whether this process is inside a flatpak sandbox — the JS host's `isFlatpak`, verbatim.
///
/// Linux FIRST, and the order is the original's: the two markers below can be forged anywhere, and a
/// non-Linux host that answered yes would send every socket through a prefix that exists on no such
/// machine. `FLATPAK_ID` is what the runtime exports into the sandbox; `/.flatpak-info` is the file it
/// mounts there, and either alone is enough because a `flatpak-spawn`ed child keeps the file and not
/// always the variable.
fn is_flatpak(os: OperatingSystem) -> bool {
    os == OperatingSystem::Linux
        && (std::env::var("FLATPAK_ID").is_ok() || Path::new("/.flatpak-info").exists())
}

/// The architecture in the oracle's vocabulary.
///
/// `Platform.getOsArch()` is node's `process.arch`, and node says `x64` and `arm64` where Rust says
/// `x86_64` and `aarch64`. The one gate that reads this is Apple's — `container` is Apple-silicon only —
/// so a raw `x86_64` reaching it would refuse a connector on a machine that can run it, or admit one on
/// a machine that cannot. Data rather than `cfg!`, so every mapping is checkable from one machine.
pub fn architecture(target_arch: &str) -> String {
    match target_arch {
        "x86_64" => "x64".to_string(),
        "aarch64" => "arm64".to_string(),
        other => other.to_string(),
    }
}

/// The controller scopes this host can offer, out of the real `~/.ssh/config`.
///
/// An unreadable or absent config is NO scopes rather than an error: a machine with no `~/.ssh/config` is
/// ordinary, and a connection that names a scope will refuse by itself with `SCOPE_NOT_FOUND` — which is
/// the honest answer, and the one a client already knows how to render.
pub fn scopes(home: &str) -> Vec<ControllerScope> {
    match list_scopes(&StdFs, std::path::Path::new(home)) {
        Ok(hosts) => hosts.into_iter().map(ControllerScope::SshHost).collect(),
        Err(error) => {
            tracing::debug!(%error, "no controller scopes: ~/.ssh/config was not readable");
            Vec::new()
        }
    }
}
