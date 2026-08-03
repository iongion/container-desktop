//! One connection's lifecycle.
//!
//! The original spreads this across `Application.createConnectorContainerEngineHostClient` (a long
//! imperative sequence), `engineDataService.connectOne` (which owns the phase and the reconnect
//! timers) and a `StartupStatus` enum that is not the phase. A server has to answer "what is this
//! connection doing right now" at any instant, survive a client disconnecting mid-attempt and drive
//! back-off retries, so here it is one type with the phase vocabulary the app already publishes.
//!
//! **The attempt is an async sequence; the back-off is not.** `connect` awaits the units, and when it
//! fails it computes `next_retry_at` and RETURNS. It does not sleep. The caller waits and calls
//! `connect` again — which keeps the schedule a pure function of the attempt count and keeps this
//! type out of the business of owning a timer it could leak.
//!
//! **And it SAYS what it is doing while it does it.** An attempt lasts as long as an engine takes to
//! come up — 51 to 56 seconds inside `spawn_service` against one that never does — so every line goes
//! to a [`ConnectListener`] the moment it is produced rather than in a batch at the end, and the
//! attempt announces itself before it asks the host for anything. `connectOne` does both, in that
//! order, and a caller told only at the end shows the state from before the attempt for the whole of
//! it.
//!
//! **It READS a clock and it never waits on one**, and the two are not the same thing. The clock is a
//! capability, so a test hands it a counter and the whole schedule stays assertable without sleeping.
//! It is read once per sub-step rather than once per attempt, because a trace whose lines all carry
//! the same instant records that something was slow and never which thing.
//!
//! **Cancellation is dropping the future.** A user who disconnects mid-`starting` drops the `connect`
//! future; anything it spawned is registered with the exec capability under THIS connection's id, so
//! [`ConnectionMachine::disconnect`] tears it down by name. An orphaned `ssh -NL` or `podman system
//! service` outliving its attempt is the failure the design names.
//!
//! What "the API is up" means is `GET /_ping` through the `Http` capability, and `CheckingAvailability`
//! now asks it — after the OS gate, the program, a resolved address, and (on an unscoped POSIX host)
//! the socket FILE, which is `isApiAvailable`'s own order. A connection can no longer reach `ready`
//! with nothing listening on that socket.

use std::fmt;
use std::sync::Arc;

use crate::capabilities::clock::Clock;
use crate::capabilities::command::Command;
use crate::capabilities::fs::Fs;
use crate::capabilities::http::Http;
use crate::domain::detect::detect_automatic_settings;
use crate::domain::diagnostic::Diagnostic;
use crate::domain::reconnect::{
    BackoffSchedule, DeterministicBackoff, ResolvedReconnectPolicy, STABLE_MS, resolve,
};
use crate::domain::types::connection::{
    ConnectOptions, Connection, EngineConnectorSettings, SettingsMode,
};
use crate::domain::types::diagnostic::{DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic};
use crate::domain::types::engine::{AvailabilityReport, EngineConnectorAvailability};
use crate::domain::types::host::StartupStatus;
use crate::domain::types::machine::ControllerScope;
use crate::domain::types::network::ProxyConfig;
use crate::domain::types::os::OperatingSystem;
use crate::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectProgress, ConnectionPhase, ConnectionRuntimeInfo, ConnectionStartingStep,
};
use crate::domain::types::user_settings::ReconnectPolicy;
use crate::runtimes::composition::{EngineEnvironment, HostContext};
use crate::runtimes::host_client::HostClient;
use crate::runtimes::registry;
use crate::runtimes::transports::shared::scope_name;

/// Everything a connection needs that the connection itself does not carry.
///
/// Grouped rather than passed as seven arguments: it is one context, and seven positional scalars
/// invites getting `home` and `user_data_path` the wrong way round.
#[derive(Debug, Clone)]
pub struct ConnectionContext {
    pub os: OperatingSystem,
    /// `Platform.getOsArch()` — node's `process.arch`, read once by the caller. Data for the same
    /// reason `os` is, and the second half of the one gate that asks about the machine's hardware.
    pub arch: String,
    /// The APP's version, for the `User-Agent` every request to an engine carries
    /// (`Api.clients.ts:getApiConfig`). Host knowledge, so it arrives as data.
    ///
    /// **Not the version this core already holds.** That one is the schema stamp written into
    /// `user-settings.json`, a different number, and naming it here would tell an engine's log a
    /// Container Desktop that does not exist. Empty means a host that never said, and the header is
    /// then omitted rather than sent half-filled.
    pub app_version: String,
    /// `PODMAN_HOST` / `DOCKER_HOST`, read once by the caller. Data, so the seed rule stays pure.
    pub environment: EngineEnvironment,
    /// `GlobalUserSettings.reconnect`. Absent normalizes to enabled with a 1s to 30s back-off.
    pub reconnect: Option<ReconnectPolicy>,
    /// `GlobalUserSettings.proxy`, read once by the caller like `reconnect` beside it. What a
    /// connection INHERITS; its own setting can override it or turn it off
    /// (`domain::proxy::resolve_connection`).
    pub proxy: Option<ProxyConfig>,
    /// What the engine's own service is asked to log at (`opts?.logLevel || "warn"`).
    pub log_level: String,
    /// Where `~` and a relative `IdentityFile` resolve. Host knowledge, so it arrives as data.
    pub home: String,
    /// `Platform.getUserDataPath()` — where a POSIX forward socket is bound.
    pub user_data_path: String,
    /// `Platform.isFlatpak()` — whether this PROCESS reaches the host's filesystem through a prefix.
    ///
    /// Host knowledge like `home` and `arch`, read once by the caller: the original's detection is
    /// `Linux && (FLATPAK_ID || /.flatpak-info)`, which needs no capability this crate lacks.
    pub is_flatpak: bool,
    /// The scopes this host can offer (`getControllerScopes`), read once by the caller.
    ///
    /// Data rather than a capability: resolving a scope NAME to a scope VALUE means reading
    /// `~/.ssh/config`, and the runtime cannot. This type only SELECTS, which is why a scope travels
    /// onward as a value and is never re-resolved downstream.
    pub scopes: Vec<ControllerScope>,
}

impl Default for ConnectionContext {
    fn default() -> Self {
        Self {
            os: OperatingSystem::Unknown,
            arch: String::new(),
            app_version: String::new(),
            environment: EngineEnvironment::default(),
            reconnect: None,
            proxy: None,
            log_level: "warn".to_string(),
            home: String::new(),
            user_data_path: String::new(),
            is_flatpak: false,
            scopes: Vec::new(),
        }
    }
}

mod composing;

mod availability;

pub mod liveness;

pub mod proxy;

/// Where a connection's progress goes the MOMENT it is produced, rather than when the attempt ends.
///
/// **An attempt lasts as long as an engine takes to come up**, and against one that never does that was
/// measured at 51 to 56 seconds inside `spawn_service`. A caller told only at the end shows the state
/// from BEFORE the attempt for all of them — a connection that was `reconnecting` goes on rendering
/// `retry in 0.9s`, which reads as stuck rather than as working.
///
/// **It is where the original publishes, too.** `connectOne` writes `phase: "starting"` into the map
/// every reader reads, emits its progress line and fires its change event BEFORE it asks the host for
/// anything, and emits again when the attempt settles. This is that pair, per line.
///
/// The line and the state travel together for the reason [`ConnectionRuntimeInfo`] is projected rather
/// than assembled: they are one observation. A listener handed only the line would have to go and ask
/// for the state, and there is nothing to ask — this type is `&mut` for the length of the attempt.
pub trait ConnectListener: Send + Sync {
    /// One progress line, and what the connection looks like as that line becomes true.
    fn progressed(&self, progress: &ConnectProgress, info: &ConnectionRuntimeInfo);
}

/// What an attempt has said so far, and who is being told as it says it.
///
/// One value rather than two parameters threaded through eight sub-steps: they are the same lines seen
/// twice — the list the caller is answered with, and each line as it happens — and a sub-step that
/// pushed to one and forgot the other would produce a trace no client ever saw.
struct Trace<'a> {
    lines: Vec<ConnectProgress>,
    watching: Option<&'a dyn ConnectListener>,
}

impl<'a> Trace<'a> {
    fn watched_by(watching: Option<&'a dyn ConnectListener>) -> Self {
        Self {
            lines: Vec::new(),
            watching,
        }
    }
}

/// The capabilities one attempt needs, as one value.
///
/// Grouped rather than passed as three positional `Arc`s: they always travel together, they are all
/// trait objects — so a swapped pair is a type error only by luck already names them
/// collectively. Mechanics, not domain: the original hands its host a whole `Platform`.
pub struct ConnectionCapabilities {
    pub command: Arc<dyn Command>,
    pub fs: Arc<dyn Fs>,
    /// The engine's own API, for the readiness question no other capability can answer.
    pub http: Arc<dyn Http>,
    /// **Read once per sub-step, which is the whole reason it is a capability here rather than an
    /// argument.** An attempt used to be handed ONE `now` and stamp every line of it identically, so
    /// a trace said a connect took nine seconds and could never say which of `startingScope`,
    /// `detecting`, `startingApi` and `checkingAvailability` spent them — which is most of what a
    /// connect trace is for. Injected rather than taken from the system so the back-off stays
    /// assertable without sleeping: a fake clock is a counter a test moves by hand.
    pub clock: Arc<dyn Clock>,
}

pub struct ConnectionMachine {
    connection: Connection,
    start_api: bool,
    skip_availability_check: bool,
    context: ConnectionContext,
    command: Arc<dyn Command>,
    fs: Arc<dyn Fs>,
    http: Arc<dyn Http>,
    clock: Arc<dyn Clock>,
    policy: ResolvedReconnectPolicy,
    backoff: Box<dyn BackoffSchedule>,
    phase: ConnectionPhase,
    step: Option<ConnectionStartingStep>,
    origin: ConnectOrigin,
    /// The settings this attempt resolved. Starts as the connection's own and is replaced by
    /// detection; adopted back into the connection only once the attempt succeeds.
    settings: EngineConnectorSettings,
    availability: EngineConnectorAvailability,
    error: Option<Diagnostic>,
    attempt: u32,
    next_retry_at: Option<u64>,
    /// When this connection has been up long enough to have its attempt count forgiven.
    stable_at: Option<u64>,
    /// Whether the engine has been found to serve a usable event stream.
    ///
    /// Set false by whoever was watching, once it has established there is no `/events` here — see
    /// [`ConnectionMachine::stood_down`]. Re-armed by every attempt, because the engine that comes
    /// back may not be the one that went away.
    watched: bool,
}

impl fmt::Debug for ConnectionMachine {
    /// Hand-written because the capabilities are trait objects. It prints what a failing assertion
    /// needs: where the machine is and what it is waiting for.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConnectionMachine")
            .field("id", &self.connection.id)
            .field("phase", &self.phase)
            .field("step", &self.step)
            .field("origin", &self.origin)
            .field("attempt", &self.attempt)
            .field("next_retry_at", &self.next_retry_at)
            .field("error", &self.error)
            .field("backoff", &self.backoff)
            .finish()
    }
}

impl ConnectionMachine {
    pub fn new(
        options: ConnectOptions,
        context: ConnectionContext,
        capabilities: ConnectionCapabilities,
    ) -> Self {
        let connection = options.connection;
        let ConnectionCapabilities {
            command,
            fs,
            http,
            clock,
        } = capabilities;
        let policy = resolve(
            connection.settings.api.auto_reconnect,
            context.reconnect.as_ref(),
        );
        Self {
            settings: connection.settings.clone(),
            connection,
            start_api: options.start_api,
            skip_availability_check: options.skip_availability_check,
            context,
            command,
            fs,
            http,
            clock,
            policy,
            backoff: Box::new(DeterministicBackoff),
            phase: ConnectionPhase::Idle,
            step: None,
            origin: ConnectOrigin::Bootstrap,
            availability: unchecked_availability(),
            error: None,
            attempt: 0,
            next_retry_at: None,
            stable_at: None,
            watched: true,
        }
    }

    /// Inject a different back-off — the runtime's jittered one, for instance.
    pub fn with_backoff(mut self, backoff: Box<dyn BackoffSchedule>) -> Self {
        self.backoff = backoff;
        self
    }

    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    pub fn phase(&self) -> ConnectionPhase {
        self.phase
    }

    /// Which sub-step of `starting` was last entered, if any.
    pub fn starting_step(&self) -> Option<ConnectionStartingStep> {
        self.step
    }

    pub fn availability(&self) -> &EngineConnectorAvailability {
        &self.availability
    }

    /// The settings this attempt resolved.
    pub fn settings(&self) -> &EngineConnectorSettings {
        &self.settings
    }

    pub fn policy(&self) -> &ResolvedReconnectPolicy {
        &self.policy
    }

    /// When the next attempt is due, for the caller that owns the waiting.
    pub fn next_retry_at(&self) -> Option<u64> {
        self.next_retry_at
    }

    pub fn attempt(&self) -> u32 {
        self.attempt
    }

    /// Bring the connection up, telling `watching` each line as it is produced.
    ///
    /// **`None` is a caller with nowhere to publish**, which is a real state and not a default: the
    /// lines still come back, so nothing is lost — they simply arrive when the attempt is over, which
    /// is all a caller with no audience could have done with them anyway.
    ///
    /// `ensureConnected`'s idempotency needs no guard here: `&mut self` is what makes running two
    /// attempts at once impossible, so a caller that reaches this while the phase still says
    /// `starting` is holding a connection whose attempt was ABANDONED — its future was dropped, which
    /// is what cancellation is. Refusing on the strength of that phase would strand the connection in
    /// one no input can leave, and the phase is what clients are shown. So the abandoned attempt's
    /// services are torn down first and this one begins: the same teardown `disconnect` performs, for
    /// the same reason, addressed by the connection's name rather than by anything the dropped future
    /// lived long enough to record.
    pub async fn connect(
        &mut self,
        origin: ConnectOrigin,
        watching: Option<&dyn ConnectListener>,
    ) -> Vec<ConnectProgress> {
        if self.phase == ConnectionPhase::Starting {
            self.stop_services().await;
        }
        let mut trace = Trace::watched_by(watching);
        self.begin_attempt(origin, &mut trace).await;
        trace.lines
    }

    async fn begin_attempt(&mut self, origin: ConnectOrigin, trace: &mut Trace<'_>) {
        self.origin = origin;
        self.phase = ConnectionPhase::Starting;
        self.step = None;
        self.error = None;
        self.availability = unchecked_availability();
        // Every attempt re-resolves from what the user configured, exactly as the original rebuilds
        // the host from `connection.settings`.
        self.settings = self.connection.settings.clone();
        self.next_retry_at = None;
        // The engine that answers this attempt is not necessarily the one that refused a stream last
        // time — a restarted daemon, or a different context. Giving up is per ENGINE, not per
        // connection, so an attempt re-arms it and lets the watcher find out again.
        self.watched = true;
        // **The attempt announces itself before it does anything**, which is `connectOne`'s first act:
        // it writes `phase: "starting"` into the map every reader reads and emits for it before the
        // try block. Inferring it from the first sub-step instead would not do — every sub-step is
        // conditional, so a manual connection that skips detection and the availability check would
        // say nothing at all until it settled, and that is the connection whose attempt is least
        // predictable from the outside.
        self.publish(trace, self.now(), None, None);

        let client = match self.build_client() {
            Ok(client) => client,
            Err(diagnostic) => return self.fail_or_reconnect(diagnostic, trace).await,
        };
        let client = match self.attach_scope(client).await {
            Ok(client) => client,
            Err(diagnostic) => return self.fail_or_reconnect(diagnostic, trace).await,
        };
        if let Err(diagnostic) = self.run_attempt(&client, trace).await {
            return self.fail_or_reconnect(diagnostic, trace).await;
        }
        self.settle(trace).await;
    }

    /// The four sub-steps, in order.
    ///
    /// **Each one reads the clock for itself**, which is what makes the trace answer "where did the
    /// nine seconds go". One `now` threaded through all four stamped them identically, and a trace
    /// whose lines all carry the same instant records only that something was slow.
    async fn run_attempt(
        &mut self,
        client: &HostClient,
        trace: &mut Trace<'_>,
    ) -> Result<(), Diagnostic> {
        self.enter_scope(client, trace).await?;
        self.enter_detecting(client, trace).await?;
        self.enter_starting_api(client, trace).await?;
        self.enter_checking_availability(client, trace).await;
        Ok(())
    }

    /// The clock, read now. Every stamp in this type comes through here.
    fn now(&self) -> u64 {
        self.clock.now_millis()
    }

    /// Sub-step 1 of 4.
    ///
    /// Native has no scope, so the sub-step is skipped entirely and emits no line — which is exactly
    /// what the app's trace stream does. A scoped transport proves the link before anything is asked
    /// of the engine.
    async fn enter_scope(
        &mut self,
        client: &HostClient,
        trace: &mut Trace<'_>,
    ) -> Result<(), Diagnostic> {
        if !client.is_scoped() {
            return Ok(());
        }
        self.step = Some(ConnectionStartingStep::StartingScope);
        // A scope is a NAME in the settings and a VALUE in the transport, and only this type holds
        // the list that resolves one to the other. So the two settings mistakes are told apart here,
        // before the sub-step is announced and before anything runs: nothing was configured, which is
        // the TRANSPORT's refusal to give because only it knows what it needed, or what was
        // configured does not exist here — which the transport cannot say, having never been handed
        // it. They need different fixes, and a user who named a scope must not be told they named
        // none.
        self.publish(
            trace,
            self.now(),
            Some(ConnectionStartingStep::StartingScope),
            None,
        );

        let status = client.transport().start_scope(client).await?;
        if matches!(status, StartupStatus::Started | StartupStatus::Running) {
            return Ok(());
        }
        // The status says whether the SCOPE is usable, not what this connection's phase is. A host
        // that cannot run a command must not be asked another one — `which podman` would be answered
        // by whatever that shell is, and the reply reported as the remote's engine.
        let verdict = Diagnostic::with_params(
            DiagnosticCode::ScopeNotUsable,
            serde_json::json!({ "status": status.to_string() }),
        );
        // Ask the transport WHY, if it has a way to find out. The probe's verdict is kept as the
        // fallback rather than thrown away: a preflight that finds nothing wrong has no better
        // answer, and `SCOPE_NOT_USABLE` is still true.
        let explained = client
            .transport()
            .diagnose_scope(client, Some(&self.settings.program.name))
            .await;
        Err(explained.unwrap_or(verdict))
    }

    /// Sub-step 2 of 4.
    async fn enter_detecting(
        &mut self,
        client: &HostClient,
        trace: &mut Trace<'_>,
    ) -> Result<(), Diagnostic> {
        self.step = Some(ConnectionStartingStep::Detecting);
        // One `if` in the original, two reasons, both preserved: manual settings are the user's, and
        // `skipAvailabilityCheck` skips detection as well as the check.
        if self.settings.mode != SettingsMode::ModeAutomatic || self.skip_availability_check {
            return Ok(());
        }
        self.publish(
            trace,
            self.now(),
            Some(ConnectionStartingStep::Detecting),
            None,
        );
        // Detection runs INSIDE the scope the probe just proved, which is why the client carries it.
        self.settings =
            detect_automatic_settings(client, &self.settings, &self.context.environment).await?;
        client.set_settings(self.settings.clone()).await;
        Ok(())
    }

    /// Sub-step 3 of 4.
    ///
    /// **What a failure costs depends on who could have opened the thing, and the transport already
    /// encodes that — no label on the service is needed.** A native engine service may already have
    /// been started by something outside the app, so `start_api` answers `false` and the availability
    /// check decides; the original catches `startApi` and carries on for exactly that reason. A data
    /// plane can only have been opened by this attempt, so its transport answers `Err` and the
    /// attempt fails. The two answers already tell them apart.
    ///
    /// **Whether it is asked AT ALL is the same distinction, one step earlier.** `start_api` asks for
    /// the ENGINE's service; a transport whose `start_api` opens the connection's data plane is asked
    /// regardless, because that forward is what makes the resolved uri mean anything.
    async fn enter_starting_api(
        &mut self,
        client: &HostClient,
        trace: &mut Trace<'_>,
    ) -> Result<(), Diagnostic> {
        if !self.start_api && !client.transport().opens_data_plane() {
            return Ok(());
        }
        self.step = Some(ConnectionStartingStep::StartingApi);
        self.publish(
            trace,
            self.now(),
            Some(ConnectionStartingStep::StartingApi),
            None,
        );
        client.transport().start_api(client, &self.settings).await?;
        Ok(())
    }

    /// Sub-step 4 of 4.
    async fn enter_checking_availability(&mut self, client: &HostClient, trace: &mut Trace<'_>) {
        self.step = Some(ConnectionStartingStep::CheckingAvailability);
        if self.skip_availability_check {
            // The original leaves availability at the connector's initial value, and `connectOne`
            // then reads `api ?? false` — so the connection is reported unavailable. Faithful, if
            // surprising, and the reason the caller sees is NOT_CHECKED rather than an invented one.
            return;
        }
        self.publish(
            trace,
            self.now(),
            Some(ConnectionStartingStep::CheckingAvailability),
            None,
        );
        self.availability = self.evaluate_availability(client).await;
    }

    async fn settle(&mut self, trace: &mut Trace<'_>) {
        if self.availability.api {
            self.become_ready(trace);
            return;
        }
        let diagnostic = Diagnostic {
            code: self.availability.report.api.code.clone(),
            params: (!self.availability.report.api.params.is_empty())
                .then(|| serde_json::Value::Object(self.availability.report.api.params.clone())),
        };
        self.fail_or_reconnect(diagnostic, trace).await;
    }

    fn become_ready(&mut self, trace: &mut Trace<'_>) {
        // ONE read, used for both: the moment it became ready is the moment the stability window
        // opens, and two reads would make `stable_at` a few microseconds later than the line that
        // announces it.
        let now = self.now();
        self.phase = ConnectionPhase::Ready;
        self.step = None;
        self.error = None;
        self.next_retry_at = None;
        self.stable_at = Some(now.saturating_add(STABLE_MS));
        self.adopt_settings();
        self.publish(trace, now, None, None);
    }

    /// What the attempt resolved becomes the connection's settings — but a live refresh must never
    /// ERASE what the user configured with an empty answer, which is why the two are merged rather
    /// than replaced (the original does the same, for the same reason).
    ///
    /// Only the relay needs the guard. A connection cannot reach here with an empty `uri` at all: an
    /// unresolved socket is what `API_SOCKET_UNRESOLVED` refuses, so the attempt would have failed
    /// instead. The relay is not part of that verdict, and a native profile always reports none, so
    /// without this a configured relay would be blanked on every successful connect.
    fn adopt_settings(&mut self) {
        let configured = self.connection.settings.api.connection.clone();
        let resolved = &mut self.settings.api.connection;
        if resolved.relay.is_empty() {
            resolved.relay = configured.relay;
        }
        self.connection.settings = self.settings.clone();
    }

    async fn fail_or_reconnect(&mut self, diagnostic: Diagnostic, trace: &mut Trace<'_>) {
        self.error = Some(diagnostic);
        // A back-off cycle already in flight continues; a FIRST-time connect failure does not start
        // one. Only the drop of a live connection auto-reconnects (`maybeContinueReconnect`).
        if self.attempt > 0 {
            self.schedule_reconnect(trace).await;
            return;
        }
        self.enter_failed(trace).await;
    }

    async fn enter_failed(&mut self, trace: &mut Trace<'_>) {
        // Before announcing the failure, as `disconnect` does: an attempt that failed AFTER opening
        // its data plane has left a forward nobody will ever use.
        self.stop_services().await;
        self.phase = ConnectionPhase::Failed;
        self.step = None;
        self.next_retry_at = None;
        self.stable_at = None;
        if let Some(diagnostic) = self.error.clone() {
            // Fold the real reason into the report, exactly as the original folds a thrown error into
            // `availability.report.api`, so the chain never shows the "not checked" placeholder for a
            // failure that actually happened.
            self.availability.api = false;
            self.availability.report.api = reported(&diagnostic, DiagnosticSeverity::Err);
        }
        // Read AFTER the teardown, because that is when the line is true. Stamping it before
        // `stop_services` would date the failure to before the work that finished it.
        self.publish(trace, self.now(), None, self.error_code());
    }

    async fn schedule_reconnect(&mut self, trace: &mut Trace<'_>) {
        // The retry re-opens everything from scratch, so what this attempt opened must go first —
        // `enter_failed` on the exhausted path below then finds nothing left to stop.
        self.stop_services().await;
        let attempt = self.attempt.saturating_add(1);
        if self.policy.exhausted(attempt) {
            // "reconnect gave up": `failed`, never an endless `reconnecting`.
            self.attempt = 0;
            self.enter_failed(trace).await;
            return;
        }
        self.attempt = attempt;
        let delay = self.backoff.delay_ms(attempt, &self.policy);
        // ONE read for the schedule and the line that publishes it. A client subtracts `ts` from
        // `next_retry_at` to learn the delay, so two reads would make the delay it sees differ from
        // the one the schedule actually granted.
        let now = self.now();
        self.next_retry_at = Some(now.saturating_add(delay));
        self.phase = ConnectionPhase::Reconnecting;
        self.step = None;
        self.origin = ConnectOrigin::Reconnect;
        self.publish(trace, now, None, self.error_code());
    }

    /// A live connection lost its engine. The reason is a code, never prose.
    pub async fn dropped(&mut self, code: DiagnosticCode) -> Vec<ConnectProgress> {
        if self.phase != ConnectionPhase::Ready {
            // Only a LIVE connection can drop. A drop reported while starting or already retrying is
            // the same failure arriving twice.
            return Vec::new();
        }
        if self
            .stable_at
            .is_some_and(|stable_at| self.now() >= stable_at)
        {
            // It stayed up long enough to be forgiven, so the next cycle starts from the beginning.
            // The original spends a timer on this; deciding it here needs no timer and cannot leak one.
            self.attempt = 0;
        }
        self.error = Some(Diagnostic::new(code));
        // **Nobody is listening, and only [`ConnectionMachine::connect`] needs one.** A drop is one
        // line and a teardown, over in the time a `kill` takes; its caller publishes what comes back
        // and the guard that gave the machine back republishes the state. What a listener buys is
        // being told DURING something that lasts a minute, and this is not that.
        let mut trace = Trace::watched_by(None);
        self.schedule_reconnect(&mut trace).await;
        trace.lines
    }

    /// The user asked for it to stop. Tears down and suppresses reconnect.
    pub async fn disconnect(&mut self) -> Vec<ConnectProgress> {
        // Stop what this connection spawned BEFORE announcing idle: an orphaned service outliving its
        // attempt is the failure mode the design names.
        self.stop_services().await;
        self.phase = ConnectionPhase::Idle;
        self.step = None;
        self.error = None;
        self.attempt = 0;
        self.next_retry_at = None;
        self.stable_at = None;
        vec![self.progress(self.now(), None, None)]
    }

    /// Tear down whatever this attempt left the exec capability holding.
    ///
    /// Addressed by the CONNECTION ID rather than by a flag this type keeps, and that is what makes
    /// cancellation safe: a `connect` future dropped between spawning a service and recording it
    /// would leave the flag false while the capability holds a live child. The capability knows the
    /// name either way, and killing something that was never started is not an error.
    async fn stop_services(&mut self) {
        if let Ok(client) = self.build_client() {
            let _ = client.transport().stop_api(&client, &self.settings).await;
        }
    }

    /// What this connection is doing right now, as a PROJECTION of the state above.
    ///
    /// Projected rather than assembled at publish time: that is what removes the class of bug where
    /// the published phase and the actual state disagree.
    pub fn runtime_info(&self) -> ConnectionRuntimeInfo {
        let reconnecting = self.phase == ConnectionPhase::Reconnecting;
        let bridge = &self.settings.api.connection.dial_stdio_command;
        let bridged = (!bridge.is_empty()).then(|| bridge.clone());
        ConnectionRuntimeInfo {
            id: self.connection.id.clone(),
            name: self.connection.name.clone(),
            engine: self.connection.engine,
            host: Some(self.connection.host),
            // What this connector can do, projected like everything else here rather than cached: it
            // is a pure function of the pair, so it cannot disagree with the connection it describes.
            // `None` only for a pair no release registered, which is the same answer `compose` gives.
            capabilities: registry::capabilities(self.connection.engine, self.connection.host).ok(),
            phase: self.phase,
            running: self.phase == ConnectionPhase::Ready,
            error: self
                .error
                .as_ref()
                .map(|diagnostic| reported(diagnostic, DiagnosticSeverity::Err)),
            version: self.resolved_version(),
            // **A bridged connection publishes NO uri, and that is the honest answer rather than a
            // missing one.** When `dial_stdio_command` is set the engine is reached by running a
            // command, and `api.connection.uri` holds whatever `local_forward_fallback` derived — a
            // `cdt-ssh-<id>.sock` nothing binds, on a connection that is `ready` and working. The
            // oracle carries that derived address alongside the bridge (`sshApiConnection`), so what
            // a client SHOWS was left open; this decides it, and decides it here because a projection
            // is the one place both facts are known at once. `proxy::endpoint` already ranks the
            // bridge FIRST, so this makes the projection agree with what is actually dialled.
            uri: bridged
                .is_none()
                .then(|| non_empty(&self.settings.api.connection.uri))
                .flatten(),
            bridge: bridged,
            relay: non_empty(&self.settings.api.connection.relay),
            scope: self
                .settings
                .controller
                .as_ref()
                .and_then(|controller| controller.scope.as_deref().and_then(non_empty)),
            // Projected like everything else here, and it needs no clearing of its own: the machine
            // already puts `step` back to `None` at every settle, so a phase that is not `starting`
            // cannot carry a sub-step and a reader cannot be shown one the connection has left.
            starting_step: self.step,
            reconnecting: reconnecting.then_some(true),
            attempt: reconnecting.then_some(self.attempt as i64),
            next_retry_at: self.next_retry_at.map(|at| at as i64),
            // Only where the question arises. A connection that is not up has nothing watching it and
            // nothing to watch, and `false` there would read as the permanent state this reports.
            watched: matches!(
                self.phase,
                ConnectionPhase::Ready | ConnectionPhase::Reconnecting
            )
            .then_some(self.watched),
        }
    }

    /// Record that whoever was watching this connection has given up, because the engine will not
    /// serve a usable event stream.
    ///
    /// **Not merely a thing to report.** `Server::watched` reads it, so without it the supervisor
    /// re-spawns a watcher on the very next command — `reconcile` runs after every one — and an
    /// engine with no `/events` pays a fresh attach and its timeout for each. Apple's `container` is
    /// the measured case.
    pub fn stood_down(&mut self) {
        self.watched = false;
    }

    fn error_code(&self) -> Option<DiagnosticCode> {
        self.error
            .as_ref()
            .map(|diagnostic| diagnostic.code.clone())
    }

    /// The controller's version when a scope reports one, else the program's
    /// (`resolveConnectionVersion`).
    fn resolved_version(&self) -> Option<String> {
        self.settings
            .controller
            .as_ref()
            .and_then(|controller| controller.version.as_deref())
            .and_then(non_empty)
            .or_else(|| self.settings.program.version.as_deref().and_then(non_empty))
    }

    /// Record one line — and tell whoever is listening before it is put away.
    ///
    /// **Every line goes through here**, so there is no way to add a sub-step that a caller is answered
    /// with and a client never sees. The state travels with it because a listener cannot come and ask
    /// for it: this type is `&mut` for the length of the attempt, which is the point of publishing at
    /// all.
    fn publish(
        &self,
        trace: &mut Trace<'_>,
        now: u64,
        step: Option<ConnectionStartingStep>,
        code: Option<DiagnosticCode>,
    ) {
        let line = self.progress(now, step, code);
        if let Some(watching) = trace.watching {
            watching.progressed(&line, &self.runtime_info());
        }
        trace.lines.push(line);
    }

    fn progress(
        &self,
        now: u64,
        step: Option<ConnectionStartingStep>,
        code: Option<DiagnosticCode>,
    ) -> ConnectProgress {
        let reconnecting = self.phase == ConnectionPhase::Reconnecting;
        ConnectProgress {
            connection_id: self.connection.id.clone(),
            phase: self.phase,
            step,
            code,
            origin: Some(self.origin),
            ts: now as i64,
            attempt: reconnecting.then_some(self.attempt as i64),
            next_retry_at: reconnecting
                .then_some(self.next_retry_at)
                .flatten()
                .map(|at| at as i64),
        }
    }
}

/// A scope that was named and is not here, with what there is instead.
///
/// `available` rather than only the name: the fix is to pick one of these, and a client that has to
/// open a second screen to find out what they are is a client that will guess.
fn scope_not_found(named: &str, offered: &[ControllerScope]) -> Diagnostic {
    let available: Vec<&str> = offered.iter().map(scope_name).collect();
    Diagnostic::with_params(
        DiagnosticCode::ScopeNotFound,
        serde_json::json!({ "scope": named, "available": available }),
    )
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

/// A check that passed. `NOT_CHECKED` with `ok` severity would claim a verdict nobody reached.
fn ok_diagnostic() -> ReportedDiagnostic {
    ReportedDiagnostic {
        code: DiagnosticCode::NotChecked,
        params: serde_json::Map::new(),
        severity: DiagnosticSeverity::Ok,
    }
}

/// The schema-owned report entry, from a unit's refusal plus a severity.
fn reported(diagnostic: &Diagnostic, severity: DiagnosticSeverity) -> ReportedDiagnostic {
    ReportedDiagnostic {
        code: diagnostic.code.clone(),
        params: diagnostic
            .params
            .as_ref()
            .and_then(|params| params.as_object().cloned())
            .unwrap_or_default(),
        severity,
    }
}

/// Nothing asked yet: every gate false and every diagnostic `NOT_CHECKED` with `warn` severity — an
/// unchecked gate is not a pass.
fn unchecked_availability() -> EngineConnectorAvailability {
    let not_checked = ReportedDiagnostic {
        code: DiagnosticCode::NotChecked,
        params: serde_json::Map::new(),
        severity: DiagnosticSeverity::Warn,
    };
    EngineConnectorAvailability {
        enabled: true,
        host: false,
        program: false,
        api: false,
        controller: None,
        controller_scope: None,
        report: AvailabilityReport {
            host: not_checked.clone(),
            program: not_checked.clone(),
            api: not_checked,
            controller: None,
            controller_scope: None,
            detail: None,
        },
    }
}
