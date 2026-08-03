//! The shared connection harness: fixtures, a recording exec capability, and a driver.
//!
//! A module rather than a copy in each file, because the machine tests are several halves of one
//! subject and duplicating the fixtures between them is the third copy of one rule the conventions
//! forbid.
//!
//! **It no longer advances a virtual clock, and that is the inversion showing.** The back-off used to
//! be a `Step::Sleep` the harness answered by moving a fake clock; now the machine computes
//! `next_retry_at` and RETURNS, so a test simply passes the later `now` to the next `connect`. No
//! clock, no sleeping, and the schedule is a pure function of the attempt count.

#![allow(dead_code)]

use std::sync::{Arc, Mutex};

use cdc_runtime::capabilities::command::{
    CommandExecutionResult, HostCommand, ServiceId, ServiceOpts,
};
use cdc_runtime::capabilities::http::HttpRequest;
use cdc_runtime::domain::machine::{
    ConnectListener, ConnectionCapabilities, ConnectionContext, ConnectionMachine,
};
use cdc_runtime::domain::types::connection::{ConnectOptions, Connection};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectProgress, ConnectionPhase, ConnectionStartingStep,
};
use cdc_runtime::domain::types::user_settings::ReconnectPolicy;
use serde_json::json;

use crate::fakes::{Asked, FakeClock, FakeCommand, FakeHttp, MemoryFs};

/// A connection as `user-settings.json` carries one.
pub fn connection(
    engine: &str,
    host: &str,
    program: &str,
    base_url: &str,
    mode: &str,
) -> Connection {
    serde_json::from_value(json!({
      "id": format!("host.default.{host}"),
      "name": format!("{engine}-native"),
      "label": "Native",
      "engine": engine,
      "host": host,
      "settings": {
        "api": { "baseURL": base_url, "connection": { "uri": "", "relay": "" } },
        "program": { "name": program, "path": "", "version": "" },
        "rootfull": false,
        "mode": mode
      }
    }))
    .expect("connection fixture parses")
}

pub fn podman() -> Connection {
    connection(
        "podman",
        "podman.native",
        "podman",
        "http://d",
        "mode.automatic",
    )
}

pub fn docker() -> Connection {
    connection(
        "docker",
        "docker.native",
        "docker",
        "http://localhost",
        "mode.automatic",
    )
}

/// A remote connection, whose controller names the scope the context must offer.
pub fn podman_remote(scope: &str) -> Connection {
    let mut connection = connection(
        "podman",
        "podman.remote",
        "podman",
        "http://d",
        "mode.automatic",
    );
    connection.settings.controller = Some(cdc_runtime::domain::types::engine::Controller {
        auto: None,
        homepage: None,
        name: "ssh".to_string(),
        path: "/usr/bin/ssh".to_string(),
        scope: Some(scope.to_string()),
        title: None,
        version: None,
    });
    connection
}

/// The same, for DOCKER — the engine that has contexts, which is the whole of why it exists.
pub fn docker_remote(scope: &str) -> Connection {
    let mut connection = connection(
        "docker",
        "docker.remote",
        "docker",
        "http://localhost",
        "mode.automatic",
    );
    connection.settings.controller = Some(cdc_runtime::domain::types::engine::Controller {
        auto: None,
        homepage: None,
        name: "ssh".to_string(),
        path: "/usr/bin/ssh".to_string(),
        scope: Some(scope.to_string()),
        title: None,
        version: None,
    });
    connection
}

/// A WSL connection for either engine, whose controller names a DISTRIBUTION.
///
/// Parameterised by engine because the registry pairs BOTH with the same WSL transport
/// (`podman.virtualized.wsl` and `docker.virtualized.wsl`), and the rule being fixtured belongs to
/// the transport. The difference from [`podman_remote`] is the whole point: an SSH scope comes from
/// `~/.ssh/config` and the caller can hand it in, while a distribution is known only to `wsl -l -v`,
/// so the host is the only thing that can resolve this name.
pub fn wsl_connection(engine: &str, scope: &str) -> Connection {
    let mut connection = connection(
        engine,
        &format!("{engine}.virtualized.wsl"),
        engine,
        "http://d",
        "mode.automatic",
    );
    connection.settings.controller = Some(cdc_runtime::domain::types::engine::Controller {
        auto: None,
        homepage: None,
        name: "wsl".to_string(),
        path: "wsl.exe".to_string(),
        scope: Some(scope.to_string()),
        title: None,
        version: None,
    });
    connection
}

/// A Windows client that offers NOTHING, which is what production hands a WSL connection: the
/// caller's list is `~/.ssh/config` and a distribution is never in it.
pub fn windows_offering_nothing() -> ConnectionContext {
    ConnectionContext {
        os: OperatingSystem::WindowsNt,
        ..linux(None)
    }
}

/// A Windows host with one distribution, answering the PowerShell listing and then behaving like a
/// healthy Podman inside it. The listing is the shape `wsl_distributions` parses — the command's own
/// lines, header first.
pub fn wsl_is_healthy(argv: &[&str]) -> CommandExecutionResult {
    if argv.contains(&"powershell") || argv.iter().any(|it| it.contains("-l -v")) {
        return CommandExecutionResult::ok(
            r#"["  NAME  STATE  VERSION","* podman-machine-default  Running  2"]"#,
        );
    }
    if argv.contains(&"echo") {
        return CommandExecutionResult::ok("started\n");
    }
    engine_is_healthy(argv)
}

/// An Apple remote — the one SSH connector that resolves no stdio bridge, so the `ssh -NL` forward
/// is still its data plane.
pub fn apple_remote(scope: &str) -> Connection {
    let mut connection = connection(
        "container",
        "container.remote",
        "container",
        "http://localhost",
        "mode.automatic",
    );
    connection.settings.controller = Some(cdc_runtime::domain::types::engine::Controller {
        auto: None,
        homepage: None,
        name: "ssh".to_string(),
        path: "/usr/bin/ssh".to_string(),
        scope: Some(scope.to_string()),
        title: None,
        version: None,
    });
    connection
}

/// The same healthy remote with an Apple engine on it: socktainer's socket comes from the guest's
/// `HOME` rather than from anything the engine reports.
pub fn apple_remote_is_healthy(argv: &[&str]) -> CommandExecutionResult {
    if argv.contains(&"printenv") {
        return CommandExecutionResult::ok("/Users/tester\n");
    }
    if argv.contains(&"which") && !argv.contains(&"ssh") {
        return CommandExecutionResult::ok("/usr/local/bin/container\n");
    }
    if argv.contains(&"--version") {
        // The SHAPE is the real one, read off a Mac — `container CLI version <v> (build: …)`. The
        // version itself is this fixture's own, so the assertions that name it stay put.
        return CommandExecutionResult::ok(
            "container CLI version 0.5.0 (build: release, commit: unspeci)",
        );
    }
    remote_is_healthy(argv)
}

/// The socket a healthy socktainer binds under that home.
pub const SOCKTAINER_SOCKET: &str = "/Users/tester/.socktainer/container.sock";

/// An SSH scope as `~/.ssh/config` would yield one.
///
/// No identity file: that is VALID and common — OpenSSH falls back to its own discovery — and it is
/// what keeps the preflight's key check out of every test that does not ask for it.
pub fn ssh_scope(name: &str) -> cdc_runtime::domain::types::machine::ControllerScope {
    ssh_scope_keyed(name, "")
}

/// The same scope, with an `IdentityFile` for the checks that inspect one.
pub fn ssh_scope_keyed(
    name: &str,
    identity_file: &str,
) -> cdc_runtime::domain::types::machine::ControllerScope {
    cdc_runtime::domain::types::machine::ControllerScope::SshHost(
        cdc_runtime::domain::types::connection::SshHost {
            config_host: None,
            connected: None,
            host: name.to_string(),
            host_name: "192.168.122.5".to_string(),
            identity_file: identity_file.to_string(),
            name: name.to_string(),
            port: 22,
            type_: cdc_runtime::domain::types::connection::SshHostType::SshConnection,
            usable: None,
            user: "tester".to_string(),
        },
    )
}

pub fn options(connection: Connection, start_api: bool) -> ConnectOptions {
    ConnectOptions {
        connection,
        start_api,
        skip_availability_check: false,
        origin: None,
    }
}

/// Where `~` and a relative `IdentityFile` resolve for the fixtures below.
pub const HOME: &str = "/home/tester";

/// `Platform.getUserDataPath()` — where a POSIX forward socket is bound.
pub const USER_DATA: &str = "/home/tester/.local/share/container-desktop";

pub fn linux(reconnect: Option<ReconnectPolicy>) -> ConnectionContext {
    ConnectionContext {
        os: OperatingSystem::Linux,
        // Named rather than defaulted: every machine test runs on a platform, and a fixture whose
        // arch is empty would quietly satisfy any gate that forgot to look at it. The same is true of
        // the app version, which decides whether a request names the app that made it.
        arch: "x64".to_string(),
        app_version: crate::fakes::APP_VERSION.to_string(),
        reconnect,
        // Every fixture's machine is behind a proxy, for the reason `fakes::PROXY_URL` gives: a
        // connection that must NOT pass it on can only be asserted against one that is really there.
        proxy: Some(crate::fakes::proxy()),
        home: HOME.to_string(),
        user_data_path: USER_DATA.to_string(),
        ..ConnectionContext::default()
    }
}

/// A Linux client offering `scopes` — what a scoped connection needs from its host, since resolving
/// a scope NAME to a VALUE means reading `~/.ssh/config`, which the runtime cannot do.
pub fn linux_offering(
    scopes: Vec<cdc_runtime::domain::types::machine::ControllerScope>,
) -> ConnectionContext {
    ConnectionContext {
        scopes,
        ..linux(None)
    }
}

/// A working Podman: `which` finds it, it reports a version and a socket.
pub fn engine_is_healthy(argv: &[&str]) -> CommandExecutionResult {
    match argv {
        ["which", ..] => CommandExecutionResult::ok("/usr/bin/podman\n"),
        [_, "--version"] => CommandExecutionResult::ok("podman version 5.6.2"),
        _ => CommandExecutionResult::ok(
            r#"{"host":{"remoteSocket":{"path":"/run/podman.sock","exists":true}}}"#,
        ),
    }
}

/// A remote that answers the SSH probe, then behaves like a healthy Podman inside the scope.
pub fn remote_is_healthy(argv: &[&str]) -> CommandExecutionResult {
    if argv.contains(&"echo") {
        return CommandExecutionResult::ok("SSH connection established\n");
    }
    // The CONTROLLER, located on THIS machine: `ssh` is what the connection runs to reach the
    // remote, so detection asks here and not over the link it has not opened yet.
    if argv == ["which", "ssh"] {
        return CommandExecutionResult::ok("/usr/bin/ssh\n");
    }
    if argv == ["/usr/bin/ssh", "-V"] {
        return CommandExecutionResult::ok("");
    }
    if argv.contains(&"which") {
        return CommandExecutionResult::ok("/usr/bin/podman\n");
    }
    if argv.contains(&"--version") {
        return CommandExecutionResult::ok("podman version 5.6.2");
    }
    CommandExecutionResult::ok(r#"{"host":{"remoteSocket":{"path":"/run/podman.sock"}}}"#)
}

/// The socket a healthy Podman reports — `engine_is_healthy`'s `remoteSocket.path`.
pub const PODMAN_SOCKET: &str = "/run/podman.sock";

/// The one a healthy Docker context reports, scheme stripped.
pub const DOCKER_SOCKET: &str = "/var/run/docker.sock";

/// A filesystem where each of `paths` is BOUND.
pub fn sockets_bound(paths: &[&str]) -> MemoryFs {
    let fs = MemoryFs::default();
    for path in paths {
        fs.put(path, "");
    }
    fs
}

/// A filesystem where both engines' sockets are bound.
///
/// The default for every fixture that means "the engine is up", because since the readiness probe
/// landed that is part of what being up MEANS: `isApiAvailable` refuses a set-but-absent native
/// socket BY NAME, so a fixture without the file is a fixture describing a broken connection. Both
/// engines rather than one, so `podman()` and `docker()` need no different harness.
pub fn engine_socket_bound() -> MemoryFs {
    sockets_bound(&[PODMAN_SOCKET, DOCKER_SOCKET])
}

/// Everything the machine published while it settled, plus everything it asked the host to do.
#[derive(Debug, Default)]
pub struct Log {
    pub progress: Vec<ConnectProgress>,
    pub argv: Vec<Vec<String>>,
    pub spawned: Vec<String>,
    pub killed: Vec<String>,
}

impl Log {
    pub fn steps(&self) -> Vec<Option<ConnectionStartingStep>> {
        self.progress.iter().map(|line| line.step).collect()
    }

    pub fn phases(&self) -> Vec<ConnectionPhase> {
        self.progress.iter().map(|line| line.phase).collect()
    }

    pub fn codes(&self) -> Vec<Option<cdc_runtime::domain::types::diagnostic::DiagnosticCode>> {
        self.progress.iter().map(|line| line.code.clone()).collect()
    }
}

/// How long any one bounded wait in this crate's tests may take.
///
/// **Bounded, because an unbounded wait in a test is a mutant that hangs a worker instead of failing
/// it.** Every gate this crate stands something at is waited for through this: the mutant that makes
/// `connect` do nothing never reaches the gate, and without a bound it would time the whole run out
/// rather than failing one case.
pub const PATIENCE: std::time::Duration = std::time::Duration::from_secs(5);

/// The common case: a healthy Podman on Linux, with nothing to reconnect to.
pub fn healthy_podman(start_api: bool) -> Harness {
    Harness::new(options(podman(), start_api), linux(None), engine_is_healthy)
}

/// A back-off cycle, followed to wherever it ended.
///
/// `delays` is what the removed `Step::Sleep` transcript used to record. The machine no longer
/// sleeps — it publishes `next_retry_at` and returns — so the delay is the difference between that
/// instant and the one the machine was at when it scheduled it, and the caller does the waiting.
#[derive(Debug, Default)]
pub struct Cascade {
    pub delays: Vec<u64>,
    pub progress: Vec<ConnectProgress>,
}

/// A machine over faked capabilities, and the log of what it asked them.
pub struct Harness {
    pub machine: ConnectionMachine,
    /// The machine's own clock, held so a test can place it before an input.
    ///
    /// **The `now` every method here takes is a clock SETTING, not an argument the machine receives.**
    /// The machine reads its clock once per sub-step — which is what lets a trace say which sub-step
    /// was slow — so a test that wants an attempt to happen at 10s puts the clock at 10s and drives.
    /// A test that wants the sub-steps to take measurable time calls [`Harness::clock`] and advances it.
    pub clock: FakeClock,
    asked: Arc<Mutex<Asked>>,
    /// Every readiness request the machine made, so a test can assert the ADDRESS as well as the
    /// verdict — which endpoint was pinged is the whole question for a scoped connection.
    pinged: Arc<Mutex<Vec<HttpRequest>>>,
    /// How far the log had been read when the last call returned, so each call reports only its own.
    read: usize,
}

impl Harness {
    pub fn new(
        options: ConnectOptions,
        context: ConnectionContext,
        respond: fn(&[&str]) -> CommandExecutionResult,
    ) -> Self {
        Self::over(options, context, FakeCommand::answering(respond))
    }

    pub fn over(options: ConnectOptions, context: ConnectionContext, command: FakeCommand) -> Self {
        Self::with_fs(options, context, command, engine_socket_bound())
    }

    /// A machine whose FILESYSTEM is the interesting one — a socket directory that cannot be created
    /// is the only thing that makes the native transport's own preparation observable.
    pub fn with_fs(
        options: ConnectOptions,
        context: ConnectionContext,
        command: FakeCommand,
        fs: MemoryFs,
    ) -> Self {
        Self::with_http(options, context, command, fs, FakeHttp::serving())
    }

    /// A machine whose ENGINE API is the interesting one.
    ///
    /// The readiness probe is the only thing that can tell an address apart from a listener, so this
    /// is the seam every false-ready case is pinned through: same settings, same filesystem, and an
    /// engine that answers or does not.
    pub fn with_http(
        options: ConnectOptions,
        context: ConnectionContext,
        command: FakeCommand,
        fs: MemoryFs,
        http: FakeHttp,
    ) -> Self {
        let asked = command.log();
        let pinged = http.log();
        let clock = FakeClock::default();
        Self {
            machine: ConnectionMachine::new(
                options,
                context,
                ConnectionCapabilities {
                    command: Arc::new(command),
                    fs: Arc::new(fs),
                    http: Arc::new(http),
                    clock: Arc::new(clock.clone()),
                },
            ),
            clock,
            asked,
            pinged,
            read: 0,
        }
    }

    /// Every readiness request, in order.
    pub fn pinged(&self) -> Vec<HttpRequest> {
        self.pinged.lock().expect("pinged").clone()
    }

    /// Replace the back-off schedule — the seam a live scheduler injects jitter through.
    pub fn with_backoff(
        self,
        backoff: Box<dyn cdc_runtime::domain::reconnect::BackoffSchedule>,
    ) -> Self {
        Self {
            machine: self.machine.with_backoff(backoff),
            ..self
        }
    }

    pub async fn connect(&mut self, now: u64) -> Log {
        self.clock.set(now);
        let progress = self.machine.connect(ConnectOrigin::Bootstrap, None).await;
        self.drain(progress)
    }

    /// The same, with somebody listening to each line as the attempt produces it.
    ///
    /// Separate from [`Harness::connect`] rather than an `Option` on it, because ~120 call sites want
    /// the plain one and a parameter every one of them passes `None` to is noise at 120 places to
    /// make one test read better.
    pub async fn connect_watched(&mut self, now: u64, watching: &dyn ConnectListener) -> Log {
        self.clock.set(now);
        let progress = self
            .machine
            .connect(ConnectOrigin::Bootstrap, Some(watching))
            .await;
        self.drain(progress)
    }

    pub async fn reconnect(&mut self, now: u64) -> Log {
        self.clock.set(now);
        let progress = self.machine.connect(ConnectOrigin::Reconnect, None).await;
        self.drain(progress)
    }

    pub async fn dropped(
        &mut self,
        now: u64,
        code: cdc_runtime::domain::types::diagnostic::DiagnosticCode,
    ) -> Log {
        self.clock.set(now);
        let progress = self.machine.dropped(code).await;
        self.drain(progress)
    }

    pub async fn disconnect(&mut self, now: u64) -> Log {
        self.clock.set(now);
        let progress = self.machine.disconnect().await;
        self.drain(progress)
    }

    /// Follow the back-off from `now` until the machine settles, retrying at exactly the instant it
    /// asked for.
    ///
    /// This is the caller the machine's contract describes: the schedule is a pure function of the
    /// attempt count, and the waiting belongs to whoever owns a clock. Bounded, because the failure
    /// mode being guarded against is a cycle that never gives up.
    pub async fn follow_retries(&mut self, now: u64) -> Cascade {
        let mut cascade = Cascade::default();
        let mut at = now;
        while let Some(due) = self.machine.next_retry_at() {
            assert!(
                cascade.delays.len() < 32,
                "the back-off never gave up: {:?}",
                cascade.delays
            );
            cascade.delays.push(due.saturating_sub(at));
            at = due;
            cascade.progress.extend(self.reconnect(at).await.progress);
        }
        cascade
    }

    /// The services the capability was asked to tear down, over the machine's whole life.
    ///
    /// Read directly rather than from a [`Log`], because the case that matters most produces no
    /// progress at all: an attempt abandoned by DROPPING its future returns nothing to fold.
    pub fn killed(&self) -> Vec<String> {
        self.asked.lock().expect("asked").killed.clone()
    }

    pub fn spawned(&self) -> Vec<String> {
        self.asked.lock().expect("asked").spawned.clone()
    }

    /// The one service this machine was asked to hold open, with the argv it was opened with.
    pub fn service(&self) -> (ServiceId, HostCommand, ServiceOpts) {
        let asked = self.asked.lock().expect("asked");
        match asked.services.as_slice() {
            [service] => service.clone(),
            other => panic!("expected exactly one spawned service, got {other:?}"),
        }
    }

    pub fn argv(&self) -> Vec<Vec<String>> {
        self.asked.lock().expect("asked").argv.clone()
    }

    /// Fold the progress lines together with the commands issued SINCE the previous call.
    fn drain(&mut self, progress: Vec<ConnectProgress>) -> Log {
        let asked = self.asked.lock().expect("asked");
        let log = Log {
            progress,
            argv: asked.argv.iter().skip(self.read).cloned().collect(),
            spawned: asked.spawned.clone(),
            killed: asked.killed.clone(),
        };
        self.read = asked.argv.len();
        log
    }
}
