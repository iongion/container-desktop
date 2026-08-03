//! The four capabilities, faked — so the runtime's own tests need no host at all.
//!
//! This module is the point of the capability seam, stated as code: `drive/` and `settings/` are
//! portable, so they must be provable without a filesystem, a process or a clock. Their tests used to
//! live in `cdc-runtime-host-native` over the real adapters, which meant this crate's mutation score
//! was measured against tests that never ran (`cargo mutants` runs only the mutated package's tests) —
//! 26 mutants survived in code that looked thoroughly covered.
//!
//! What stays in the host crate is what genuinely needs a machine: an orphaned child process, a real
//! advisory lock under contention, the app's exact JSON formatting.

#![allow(dead_code)]

/// The APP's version, as a host tells the runtime — not the document's schema stamp.
///
/// Here rather than in a crate's `harness/` because every crate reaches these fakes by `#[path]`,
/// and the `User-Agent` a request carries is asserted in three of them.
pub const APP_VERSION: &str = "5.2.19";

/// The proxy every fixture's machine has configured, as a URL.
///
/// **ACTIVE on purpose.** A test asserting that a scoped command carries NO proxy variables is only
/// asserting something when there is one to carry — with an inactive fixture it would pass against a
/// port that had never heard of a proxy, which is the `is_empty` rule this tree keeps paying for.
pub const PROXY_URL: &str = "http://proxy.test:3128";

/// That proxy, as the document holds it.
pub fn proxy() -> cdc_runtime::domain::types::network::ProxyConfig {
    cdc_runtime::domain::types::network::ProxyConfig {
        mode: cdc_runtime::domain::types::network::ProxyMode::Manual,
        protocol: cdc_runtime::domain::types::network::ProxyProtocol::Http,
        host: "proxy.test".to_string(),
        port: 3128,
        username: String::new(),
        password: String::new(),
        bypass: Vec::new(),
    }
}

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::command::{Command, CommandError, StreamHandle};
use cdc_runtime::capabilities::command::{
    CommandExecutionResult, HostCommand, ServiceId, ServiceOpts,
};
use cdc_runtime::capabilities::fs::{Fs, FsError, FsLocks};
use cdc_runtime::domain::machine::ConnectListener;
use cdc_runtime::domain::types::connection::{
    ApiConnection, EngineConnectorApiSettings, EngineConnectorSettings, SettingsMode,
};
use cdc_runtime::domain::types::engine::Program;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectProgress, ConnectionPhase, ConnectionRuntimeInfo, ConnectionStartingStep,
};
use cdc_runtime::runtimes::composition::{EngineDialect, HostProfile, Transport};
use cdc_runtime::runtimes::host_client::{HostClient, HostClientComposition, HostEnvironment};

/// A clock a test moves by hand. Milliseconds on an arbitrary origin, exactly as the capability says.
#[derive(Clone, Default)]
pub struct FakeClock {
    millis: Arc<AtomicU64>,
    /// How far every READ moves it on. Zero — the default — is a clock that stands still, which is
    /// what a test asserting an exact schedule wants. See [`FakeClock::tick_by`].
    step: Arc<AtomicU64>,
}

impl FakeClock {
    pub fn at(millis: u64) -> Self {
        Self {
            millis: Arc::new(AtomicU64::new(millis)),
            step: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn advance(&self, millis: u64) {
        self.millis.fetch_add(millis, Ordering::SeqCst);
    }

    /// Make time PASS between reads, so that a caller which reads once per sub-step sees a different
    /// instant each time.
    ///
    /// **This is the only way to make an elapsed duration observable in a hermetic test.** Real time
    /// is not available to assert against — a suite that slept would be slow and flaky — and the
    /// property under test is precisely that the machine reads its clock more than once per attempt.
    /// A clock that stands still cannot tell a machine that reads once from one that reads five times.
    pub fn tick_by(&self, millis: u64) {
        self.step.store(millis, Ordering::SeqCst);
    }

    /// Place the clock, for a caller that owns WHEN an input happens rather than how long it took.
    ///
    /// The back-off cases are all of that shape: the machine says the next attempt is due at 10s, and
    /// the test is the caller that waited — so it puts the clock there and drives, exactly as a real
    /// scheduler would.
    pub fn set(&self, millis: u64) {
        self.millis.store(millis, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_millis(&self) -> u64 {
        // The instant BEFORE the step, so the first read of a placed clock is the instant it was
        // placed at — a test that sets 1_000 and ticks by 250 reads 1_000, then 1_250.
        self.millis
            .fetch_add(self.step.load(Ordering::SeqCst), Ordering::SeqCst)
    }
}

/// What a faked command CARRIED OUT, in order. One log for all four operations, because the order
/// across them is part of what the drive loop decides.
///
/// Recorded after the operation's wait, never before: a step that was abandoned mid-flight must leave
/// no trace, or a test for cancellation would pass by observing the attempt rather than its completion.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Asked {
    pub argv: Vec<Vec<String>>,
    pub spawned: Vec<String>,
    pub killed: Vec<String>,
    /// The whole spawn, not just its id — the argv a forward was opened with, and what it was
    /// polled for. A test that could only see the id would pass while the forward pointed nowhere.
    pub services: Vec<(ServiceId, HostCommand, ServiceOpts)>,
    /// The whole command, not just its argv.
    ///
    /// `argv` answers "what ran"; this answers "how", which is where the rules that have no argv
    /// footprint live — the `.exe` rewrite, `proxy_env`, and a secret that must travel as `input` and
    /// never as an argument. A test that could only see argv would pass while those were wrong.
    pub commands: Vec<HostCommand>,
}

/// One argv, answered. Boxed rather than a `fn` pointer so a script can COUNT: a back-off cascade is
/// specified by an engine that fails twice and then comes back, which a stateless responder cannot
/// express.
pub type Respond = Box<dyn Fn(&[&str]) -> CommandExecutionResult + Send + Sync>;

/// How a faked command answers.
pub enum Answer {
    From(Respond),
    /// Fail to spawn anything at all — nothing ran.
    Unspawnable,
}

/// A step a test stops in the middle of: it says it has been reached, and waits there until the test
/// lets it through.
///
/// **Not [`FakeCommand::holding`], and the difference is the whole of what a lock test needs.** A hold
/// makes a step SLOW, and a slow step is one an auto-advancing clock jumps straight over —
/// `tokio::time::pause` fires every pending timer the moment the runtime is idle, and a task blocked on
/// a lock is exactly what idle looks like. A gate is STOPPED rather than slow: nothing but the test
/// advances it, so an assertion made while something stands at it is an assertion made while the
/// operation is genuinely still in flight.
#[derive(Clone)]
pub struct Gate {
    reached: Arc<tokio::sync::Semaphore>,
    opened: Arc<tokio::sync::Semaphore>,
}

impl Gate {
    /// A gate nothing has passed and nothing may pass until [`Gate::open`].
    pub fn shut() -> Self {
        Self {
            reached: Arc::new(tokio::sync::Semaphore::new(0)),
            opened: Arc::new(tokio::sync::Semaphore::new(0)),
        }
    }

    /// The test: wait until something is standing here.
    ///
    /// The sync point, and the reason a gate is two counters rather than one: a test that opened the
    /// gate before anything arrived would be asserting about an operation that had not started, which
    /// passes against a server that never took a lock at all.
    pub async fn reached(&self) {
        self.taken(&self.reached).await;
    }

    /// The test: let one through.
    pub fn open(&self) {
        self.opened.add_permits(1);
    }

    /// The fake: announce arrival, and wait to be let through.
    async fn pass(&self) {
        self.reached.add_permits(1);
        self.taken(&self.opened).await;
    }

    /// One permit, kept. `acquire` refuses only a CLOSED semaphore and neither of these is ever closed.
    async fn taken(&self, counter: &tokio::sync::Semaphore) {
        counter
            .acquire()
            .await
            .expect("a gate is never closed")
            .forget();
    }
}

/// A [`ConnectListener`] that keeps what it was told, in the order it was told it.
///
/// **Shared rather than owned, and that is what it is for**: the question is whether an attempt
/// publishes AS IT GOES, so a test has to be able to read this while the attempt feeding it is still
/// standing at a [`Gate`]. A recorder reachable only after the attempt returned could not tell
/// publishing per line from publishing at the end — which is the whole distinction.
#[derive(Clone, Default)]
pub struct Heard {
    told: Arc<Mutex<Vec<(ConnectProgress, ConnectionRuntimeInfo)>>>,
}

impl Heard {
    /// The sub-step each line named, oldest first — what a trace is read by.
    pub fn steps(&self) -> Vec<Option<ConnectionStartingStep>> {
        self.told
            .lock()
            .expect("heard")
            .iter()
            .map(|(line, _)| line.step)
            .collect()
    }

    /// The lines themselves, for a test comparing them with what the attempt answered.
    pub fn lines(&self) -> Vec<ConnectProgress> {
        self.told
            .lock()
            .expect("heard")
            .iter()
            .map(|(line, _)| line.clone())
            .collect()
    }

    /// The phase the STATE carried with each line — what a reader of the projection would have seen.
    pub fn phases(&self) -> Vec<ConnectionPhase> {
        self.told
            .lock()
            .expect("heard")
            .iter()
            .map(|(_, info)| info.phase)
            .collect()
    }
}

/// Nobody is listening, said in as many words.
///
/// The server's listener is not an `Option`, because a server always has somewhere to publish and a
/// connect's lines go nowhere else — so a test that is not asking about publication says so here rather
/// than by passing an absence that would silently swallow the trace.
pub struct Unheard;

impl ConnectListener for Unheard {
    fn progressed(&self, _progress: &ConnectProgress, _info: &ConnectionRuntimeInfo) {}
}

impl ConnectListener for Heard {
    fn progressed(&self, progress: &ConnectProgress, info: &ConnectionRuntimeInfo) {
        self.told
            .lock()
            .expect("heard")
            .push((progress.clone(), info.clone()));
    }
}

/// A `Command` that answers from a script, records what it was asked, and can be made slow or stopped.
///
/// `hold` is what makes cancellation testable: a step that takes measurable virtual time is a step an
/// input can arrive during. Under `#[tokio::test(start_paused = true)]` it costs no real time. `gate`
/// is the other half of that and is not interchangeable with it — see [`Gate`].
pub struct FakeCommand {
    answer: Answer,
    hold: Option<Duration>,
    /// Where a spawned service stops, when a test wants one in flight while it asserts something else.
    gate: Option<Gate>,
    /// Commands run fine and only SERVICES are refused — a machine whose forward will not bind while
    /// every probe before it answers. `Unspawnable` cannot express that: it fails everything, so the
    /// attempt dies during detection and never reaches the sub-step under test.
    refuse_services: bool,
    asked: Arc<Mutex<Asked>>,
}

impl FakeCommand {
    pub fn answering(respond: fn(&[&str]) -> CommandExecutionResult) -> Self {
        Self::scripted(respond)
    }

    /// A responder that may carry state of its own — a call counter, a queue of answers.
    pub fn scripted(
        respond: impl Fn(&[&str]) -> CommandExecutionResult + Send + Sync + 'static,
    ) -> Self {
        Self {
            answer: Answer::From(Box::new(respond)),
            hold: None,
            gate: None,
            refuse_services: false,
            asked: Arc::new(Mutex::new(Asked::default())),
        }
    }

    /// Succeeds at everything, with empty output. For the loops that care about control flow only.
    pub fn agreeable() -> Self {
        Self::answering(|_| CommandExecutionResult::ok(""))
    }

    pub fn unspawnable() -> Self {
        Self {
            answer: Answer::Unspawnable,
            hold: None,
            gate: None,
            refuse_services: false,
            asked: Arc::new(Mutex::new(Asked::default())),
        }
    }

    /// Answers every command, and refuses every SERVICE.
    pub fn refusing_services(mut self) -> Self {
        self.refuse_services = true;
        self
    }

    /// Every operation takes this long on the clock the runtime is running on.
    pub fn holding(mut self, hold: Duration) -> Self {
        self.hold = Some(hold);
        self
    }

    /// Stop `spawn_service` at this gate.
    ///
    /// **`spawn_service` and nothing else, because that is where the time really goes.** A service is
    /// spawned and then POLLED for readiness — `API_READINESS_ATTEMPTS × API_READINESS_WAIT`, measured
    /// at 51 to 56 seconds against a real engine that never came up. A gate here stands exactly where
    /// that wait stands, so a test about what else can happen during a connect is asking the question
    /// a person asks.
    pub fn gated(mut self, gate: Gate) -> Self {
        self.gate = Some(gate);
        self
    }

    /// A handle on the log that survives the move into the executor.
    pub fn log(&self) -> Arc<Mutex<Asked>> {
        Arc::clone(&self.asked)
    }

    async fn wait(&self) {
        if let Some(hold) = self.hold {
            tokio::time::sleep(hold).await;
        }
    }

    fn refusal(program: &str) -> CommandError {
        CommandError::Spawn {
            launcher: program.to_string(),
            source: std::io::Error::other("this fake spawns nothing"),
        }
    }
}

#[async_trait]
impl Command for FakeCommand {
    async fn run(&self, spec: &HostCommand) -> Result<CommandExecutionResult, CommandError> {
        let argv: Vec<String> = spec.argv().iter().map(|it| (*it).to_string()).collect();
        self.wait().await;
        {
            let mut asked = self.asked.lock().expect("asked");
            asked.argv.push(argv.clone());
            asked.commands.push(spec.clone());
        }
        match &self.answer {
            Answer::From(respond) => {
                let borrowed: Vec<&str> = argv.iter().map(String::as_str).collect();
                Ok(respond(&borrowed))
            }
            Answer::Unspawnable => Err(Self::refusal(&spec.launcher)),
        }
    }

    async fn stream(&self, _spec: &HostCommand) -> Result<Box<dyn StreamHandle>, CommandError> {
        unimplemented!("no connection streams; `stream` belongs to the resource work")
    }

    async fn spawn_service(
        &self,
        id: &ServiceId,
        spec: &HostCommand,
        readiness: &ServiceOpts,
    ) -> Result<(), CommandError> {
        self.wait().await;
        {
            let mut asked = self.asked.lock().expect("asked");
            asked.spawned.push(id.0.clone());
            asked
                .services
                .push((id.clone(), spec.clone(), readiness.clone()));
        }
        // Recorded first, so a test that is asserting while this stands here can see what was asked.
        if let Some(gate) = &self.gate {
            gate.pass().await;
        }
        if self.refuse_services {
            return Err(Self::refusal(&spec.launcher));
        }
        match &self.answer {
            Answer::From(_) => Ok(()),
            Answer::Unspawnable => Err(Self::refusal(&spec.launcher)),
        }
    }

    async fn kill(&self, id: &ServiceId) -> Result<(), CommandError> {
        self.wait().await;
        self.asked.lock().expect("asked").killed.push(id.0.clone());
        match &self.answer {
            Answer::From(_) => Ok(()),
            Answer::Unspawnable => Err(CommandError::UnknownService(id.clone())),
        }
    }
}

/// A filesystem in a `HashMap`: contents plus a modification stamp a test moves by hand.
///
/// The stamp is a counter rather than a real clock, because the watcher's rule is "the stamp changed",
/// and a real filesystem's granularity is exactly what makes that flaky to test for real.
#[derive(Clone, Default)]
pub struct MemoryFs {
    inner: Arc<Mutex<Contents>>,
}

#[derive(Default)]
struct Contents {
    files: HashMap<PathBuf, (String, u128)>,
    stamp: u128,
    writes: usize,
    locked: HashSet<PathBuf>,
    locks_taken: usize,
    directories: HashSet<PathBuf>,
    /// A filesystem that will not create a directory — a read-only mount, or a path the user does not
    /// own. Rare, and the one case where a socket's base directory cannot be prepared.
    refuse_mkdir: bool,
}

impl MemoryFs {
    /// Seed a file without counting as a write, so a test can assert what the code under test wrote.
    pub fn seeded(path: impl AsRef<Path>, contents: &str) -> Self {
        let fs = Self::default();
        fs.put(path, contents);
        fs
    }

    /// Whether a directory was CREATED here — the question an mkdir rule is asked, as distinct from
    /// `is_file_present`, which a seeded path also answers yes to.
    pub fn made(&self, path: impl AsRef<Path>) -> bool {
        self.inner
            .lock()
            .expect("contents")
            .directories
            .contains(path.as_ref())
    }

    /// A filesystem that refuses to create directories.
    pub fn refusing_mkdir() -> Self {
        let fs = Self::default();
        fs.inner.lock().expect("contents").refuse_mkdir = true;
        fs
    }

    pub fn put(&self, path: impl AsRef<Path>, contents: &str) {
        let mut inner = self.inner.lock().expect("contents");
        inner.stamp += 1;
        let stamp = inner.stamp;
        inner
            .files
            .insert(path.as_ref().to_path_buf(), (contents.to_string(), stamp));
    }

    /// Move the modification stamp and nothing else, as `touch` does.
    pub fn touch(&self, path: impl AsRef<Path>) {
        let mut inner = self.inner.lock().expect("contents");
        inner.stamp += 1;
        let stamp = inner.stamp;
        if let Some(entry) = inner.files.get_mut(path.as_ref()) {
            entry.1 = stamp;
        }
    }

    pub fn read(&self, path: impl AsRef<Path>) -> Option<String> {
        self.inner
            .lock()
            .expect("contents")
            .files
            .get(path.as_ref())
            .map(|(contents, _)| contents.clone())
    }

    /// How many times the code under test replaced a file. `0` is the assertion that a read did not
    /// write.
    pub fn writes(&self) -> usize {
        self.inner.lock().expect("contents").writes
    }

    pub fn locks_taken(&self) -> usize {
        self.inner.lock().expect("contents").locks_taken
    }

    /// Hold the lock from outside, so contention is deterministic and needs no second thread.
    pub fn hold_lock(&self, path: impl AsRef<Path>) {
        self.inner
            .lock()
            .expect("contents")
            .locked
            .insert(path.as_ref().to_path_buf());
    }
}

/// Released on drop, exactly as the capability promises.
pub struct MemoryLock {
    inner: Arc<Mutex<Contents>>,
    path: PathBuf,
}

impl Drop for MemoryLock {
    fn drop(&mut self) {
        self.inner
            .lock()
            .expect("contents")
            .locked
            .remove(&self.path);
    }
}

impl Fs for MemoryFs {
    fn read_to_string(&self, path: &Path) -> Result<Option<String>, FsError> {
        Ok(self.read(path))
    }

    fn write_atomic(&self, path: &Path, contents: &str) -> Result<(), FsError> {
        self.put(path, contents);
        self.inner.lock().expect("contents").writes += 1;
        Ok(())
    }

    fn modified_nanos(&self, path: &Path) -> Result<Option<u128>, FsError> {
        Ok(self
            .inner
            .lock()
            .expect("contents")
            .files
            .get(path)
            .map(|(_, stamp)| *stamp))
    }

    /// A directory is present once something under it has been written, and `mkdir` records it — so
    /// the socket base-dir dance a native `startApi` performs is observable without a real
    /// filesystem.
    fn is_file_present(&self, path: &Path) -> bool {
        let inner = self.inner.lock().expect("contents");
        inner.files.contains_key(path) || inner.directories.contains(path)
    }

    fn mkdir(&self, path: &Path) -> Result<(), FsError> {
        let mut inner = self.inner.lock().expect("contents");
        if inner.refuse_mkdir {
            return Err(FsError::Io {
                operation: "create",
                path: path.to_path_buf(),
                source: std::io::Error::other("read-only filesystem"),
            });
        }
        inner.directories.insert(path.to_path_buf());
        Ok(())
    }
}

impl FsLocks for MemoryFs {
    type Lock = MemoryLock;

    fn lock_exclusive(&self, path: &Path, timeout: Duration) -> Result<Self::Lock, FsError> {
        let mut inner = self.inner.lock().expect("contents");
        if inner.locked.contains(path) {
            return Err(FsError::LockTimeout {
                path: path.to_path_buf(),
                waited: timeout,
            });
        }
        inner.locked.insert(path.to_path_buf());
        inner.locks_taken += 1;
        Ok(MemoryLock {
            inner: Arc::clone(&self.inner),
            path: path.to_path_buf(),
        })
    }
}

/// A real [`HostClient`] over faked capabilities, for testing ONE unit through the seam.
///
/// A real client rather than a hand-rolled `HostContext`: the units call back into it
/// (`run_host_command`, `run_probe`, `dialect()`), so a stub would be re-implementing the very
/// thing under test — and the `.exe` rewrite and `proxy_env` rules would be missing from every
/// unit test that relied on it.
pub fn unit_host(
    id: &str,
    transport: Box<dyn Transport>,
    dialect: Box<dyn EngineDialect>,
    profile: Box<dyn HostProfile>,
    os: OperatingSystem,
    command: FakeCommand,
) -> HostClient {
    unit_host_controlled(id, transport, dialect, profile, os, command, "ssh")
}

/// The same, for a transport whose CONTROLLER is not `ssh`.
///
/// It is a separate argument rather than a field on the transport because the connector registers it:
/// a WSL host enters its scope with `wsl` and a Lima host with `limactl`, and a refusal that named the
/// wrong one would send someone to install the wrong thing.
pub fn unit_host_controlled(
    id: &str,
    transport: Box<dyn Transport>,
    dialect: Box<dyn EngineDialect>,
    profile: Box<dyn HostProfile>,
    os: OperatingSystem,
    command: FakeCommand,
    controller: &'static str,
) -> HostClient {
    unit_host_over(
        id,
        transport,
        dialect,
        profile,
        os,
        command,
        controller,
        MemoryFs::default(),
    )
}

/// The same again, for a unit whose FILESYSTEM is the interesting one.
///
/// `DockerVendorProfile::probe_uri` is the reason this exists: which pipe Docker Desktop serves is
/// decided by LOOKING, so the only way to pin either branch is to hand the client a filesystem that
/// has the pipe or has not (`MemoryFs::seeded`). The other constructors delegate here rather than
/// building a second client, so a rule added to one is not missing from the others.
#[allow(clippy::too_many_arguments)]
pub fn unit_host_over(
    id: &str,
    transport: Box<dyn Transport>,
    dialect: Box<dyn EngineDialect>,
    profile: Box<dyn HostProfile>,
    os: OperatingSystem,
    command: FakeCommand,
    controller: &'static str,
    fs: MemoryFs,
) -> HostClient {
    HostClient::new(
        id,
        HostClientComposition {
            transport,
            dialect,
            profile,
            program: "podman",
            controller,
        },
        HostEnvironment {
            app_version: APP_VERSION.to_string(),
            is_flatpak: false,
            os_type: os,
            // The machine every fixture runs on unless a test says otherwise. `x64` and not `arm64`,
            // so a gate that forgot to check the architecture cannot pass by accident.
            arch: "x64".to_string(),
            home: "/home/tester".to_string(),
            user_data_path: "/home/tester/.local/share/container-desktop".to_string(),
            log_level: "warn".to_string(),
            proxy: proxy(),
        },
        unit_settings(),
        Arc::new(command),
        Arc::new(fs),
        // A unit's own tests never reach the readiness probe — only the machine's availability check
        // does — so the engine is simply up here.
        Arc::new(FakeHttp::serving()),
    )
}

/// The same host, SANDBOXED — the one fixture that answers `Platform.isFlatpak()` with yes.
///
/// Separate rather than an eighth positional argument to [`unit_host_over`]: exactly one question is
/// being asked of it, and a bool in a row of eight is the kind of argument tests swap by accident.
pub fn unit_host_in_flatpak(
    id: &str,
    transport: Box<dyn Transport>,
    dialect: Box<dyn EngineDialect>,
    profile: Box<dyn HostProfile>,
    command: FakeCommand,
    fs: MemoryFs,
) -> HostClient {
    let host = unit_host_over(
        id,
        transport,
        dialect,
        profile,
        // Flatpak is Linux-only, so any other OS here would be a fixture describing a machine that
        // cannot exist.
        OperatingSystem::Linux,
        command,
        "ssh",
        fs,
    );
    host.in_flatpak()
}

/// Settings a unit test can start from: automatic, with the engine already located.
pub fn unit_settings() -> EngineConnectorSettings {
    EngineConnectorSettings {
        api: EngineConnectorApiSettings {
            auto_reconnect: None,
            auto_start: None,
            base_url: "http://d".to_string(),
            connection: ApiConnection {
                uri: String::new(),
                relay: String::new(),
                dial_stdio_command: Vec::new(),
            },
        },
        certificates: Vec::new(),
        context: None,
        controller: None,
        mode: SettingsMode::ModeAutomatic,
        program: Program {
            auto: None,
            homepage: None,
            name: "podman".to_string(),
            path: Some("/usr/bin/podman".to_string()),
            title: None,
            version: None,
        },
        proxy: None,
        registries: Vec::new(),
        rootfull: false,
    }
}

/// The engine's own API, faked — split out for the 620-line cap. Reached as `super::fakes::…` by
/// every test that already used it, because it is re-exported below.
#[path = "http.rs"]
mod http_fake;
pub use http_fake::*;
