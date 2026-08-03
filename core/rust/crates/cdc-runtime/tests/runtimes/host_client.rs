//! The composed client — `runtimes/host-client.ts`.
//!
//! What is pinned here is everything `runHostCommand` does that leaves NO argv footprint, because
//! that is where a silent divergence would live: the Windows `.exe` rewrite, the `proxy_env`
//! asymmetry, and the rule that a command which could not be spawned is a failed RESULT rather than
//! an error.
//!
//! The three units are stubs. They are not the real transports — those arrive with the rest of the
//! inversion — but a stub is what proves the client delegates rather than deciding, which is the
//! property `facade.ts` actually requires of it.

use std::sync::Arc;

use crate::fakes::APP_VERSION;
use crate::fakes::{FakeCommand, FakeHttp, MemoryFs};
use async_trait::async_trait;
use cdc_runtime::capabilities::command::{CommandExecutionResult, HostCommand};
use cdc_runtime::domain::diagnostic::Diagnostic;
use cdc_runtime::domain::types::connection::{
    ApiConnection, ConnectorCapabilities, EngineConnectorApiSettings, EngineConnectorSettings,
    SettingsMode, SshHost, SshHostType,
};
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::{
    ApiSurface, ContainerEngine, ContainerEngineHost, Program,
};
use cdc_runtime::domain::types::host::StartupStatus;
use cdc_runtime::domain::types::machine::ControllerScope;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{
    EngineDialect, EngineEnvironment, HostContext, HostPlatform, HostProfile, ResolvedApi,
    Transport, UnitResult,
};
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::host_client::{HostClient, HostClientComposition, HostEnvironment};

/// A transport that records nothing and decides nothing except whether it is scoped.
///
/// `run_scope_command` runs the argv back through the host, which is the re-entrancy the real scoped
/// transports use (`client → transport → client`) and the part worth proving is not a borrow
/// conflict.
struct StubTransport {
    scoped: bool,
}

#[async_trait]
impl Transport for StubTransport {
    fn is_scoped(&self) -> bool {
        self.scoped
    }

    async fn run_scope_command(
        &self,
        host: &dyn HostContext,
        program: &str,
        args: &[String],
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<CommandExecutionResult> {
        let mut command = HostCommand::new(program, &[]);
        command.args = args.to_vec();
        Ok(host.run_host_command(&command).await)
    }

    async fn resolve_guest_path(&self, _host: &dyn HostContext, local_path: &str) -> String {
        local_path.to_string()
    }

    async fn list_scopes(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<Vec<ControllerScope>> {
        Ok(Vec::new())
    }

    async fn controller_default_scope(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<Option<ControllerScope>> {
        Ok(None)
    }

    async fn start_scope(&self, _host: &dyn HostContext) -> UnitResult<StartupStatus> {
        Ok(StartupStatus::Running)
    }

    async fn stop_scope(&self, _host: &dyn HostContext) -> UnitResult<bool> {
        Ok(true)
    }

    async fn resolve_scope_uri(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
        _socket: &str,
    ) -> String {
        String::new()
    }

    async fn start_api(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        Ok(true)
    }

    async fn stop_api(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> UnitResult<bool> {
        Ok(true)
    }
}

struct StubDialect;

#[async_trait]
impl EngineDialect for StubDialect {
    fn engine(&self) -> ContainerEngine {
        ContainerEngine::Podman
    }

    /// Podman's real table. The cases here are about what the CLIENT composes, not about the matrix —
    /// that is `registry`'s — and a stub table of its own would be a second answer to the same
    /// question, free to drift from the one the app ships.
    fn capabilities_base(&self) -> ConnectorCapabilities {
        PodmanDialect.capabilities_base()
    }

    fn api_surface(&self) -> ApiSurface {
        ApiSurface::Libpod
    }

    async fn read_engine_socket(
        &self,
        _host: &dyn HostContext,
        _settings: &EngineConnectorSettings,
    ) -> String {
        String::new()
    }

    fn target_args(&self, _settings: &EngineConnectorSettings) -> Vec<String> {
        Vec::new()
    }

    fn native_uri_seed(&self, _environment: &EngineEnvironment) -> String {
        String::new()
    }

    fn build_service_args(&self, _socket_path: &str, _log_level: &str) -> Option<Vec<String>> {
        None
    }

    fn dial_stdio_program(&self) -> Option<&'static str> {
        None
    }
}

struct StubProfile;

#[async_trait]
impl HostProfile for StubProfile {
    fn host(&self) -> ContainerEngineHost {
        ContainerEngineHost::PodmanNative
    }

    fn label(&self) -> &'static str {
        "Stub"
    }

    fn is_engine_available(&self, _platform: HostPlatform) -> UnitResult<()> {
        Ok(())
    }

    fn api_connection(&self, resolved: &ResolvedApi) -> ApiConnection {
        ApiConnection {
            uri: resolved.socket.to_string(),
            relay: String::new(),
            dial_stdio_command: Vec::new(),
        }
    }
}

fn settings() -> EngineConnectorSettings {
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

/// A client over the given OS and scoping, plus a handle on what the exec capability was asked.
fn client(
    os: OperatingSystem,
    scoped: bool,
    command: FakeCommand,
) -> (
    HostClient,
    std::sync::Arc<std::sync::Mutex<crate::fakes::Asked>>,
) {
    let log = command.log();
    let composition = HostClientComposition {
        transport: Box::new(StubTransport { scoped }),
        dialect: Box::new(StubDialect),
        profile: Box::new(StubProfile),
        program: "podman",
        controller: "podman",
    };
    let environment = HostEnvironment {
        app_version: APP_VERSION.to_string(),
        is_flatpak: false,
        os_type: os,
        arch: "arm64".to_string(),
        home: "/home/tester".to_string(),
        user_data_path: "/home/tester/.local/share/container-desktop".to_string(),
        log_level: "warn".to_string(),
        proxy: crate::fakes::proxy(),
    };
    let host = HostClient::new(
        "host.manual.podman.native",
        composition,
        environment,
        settings(),
        Arc::new(command),
        Arc::new(MemoryFs::default()),
        Arc::new(FakeHttp::serving()),
    );
    (host, log)
}

#[tokio::test]
async fn windows_appends_exe_to_the_launcher_and_leaves_every_argument_alone() {
    // The rewrite is the LAUNCHER's. `which podman` names a program in argv[1], and rewriting that
    // would ask Windows for `podman.exe` through a `which` that does not exist there — a probe that
    // fails for a reason nothing in the argv explains.
    let (host, log) = client(
        OperatingSystem::WindowsNt,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    host.run_host_command(&HostCommand::new("which", &["podman"]))
        .await;

    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec!["which.exe".to_string(), "podman".to_string()]],
        "argv[0] gains .exe; the argument naming a program does not"
    );
}

#[tokio::test]
async fn windows_does_not_double_the_suffix_when_the_launcher_already_has_it() {
    let (host, log) = client(
        OperatingSystem::WindowsNt,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    host.run_host_command(&HostCommand::new("wsl.exe", &["--list"]))
        .await;

    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec!["wsl.exe".to_string(), "--list".to_string()]],
        "`wsl.exe.exe` would not exist"
    );
}

#[tokio::test]
async fn a_posix_launcher_is_untouched() {
    let (host, log) = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    host.run_host_command(&HostCommand::new("podman", &["--version"]))
        .await;

    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec!["podman".to_string(), "--version".to_string()]]
    );
}

#[tokio::test]
async fn the_proxy_environment_is_passed_only_when_the_connection_is_unscoped() {
    // The asymmetry is the behaviour: the proxy variables describe how to leave THIS machine, so
    // handing them to a command running on the far side of an `ssh` configures the wrong network.
    // Neither arm has an argv footprint, so only the recorded command can tell them apart.
    for scoped in [false, true] {
        let (host, log) = client(
            OperatingSystem::Linux,
            scoped,
            FakeCommand::answering(|_| CommandExecutionResult::ok("")),
        );

        host.run_host_command(&HostCommand::new("podman", &["--version"]))
            .await;

        let asked = log.lock().expect("asked");
        assert_eq!(
            named(&asked.commands[0], "HTTP_PROXY").as_deref(),
            (!scoped).then_some(crate::fakes::PROXY_URL),
            "scoped={scoped}: the variables travel WITH the command, so this is all a host is given"
        );
    }
}

/// The last word is the caller's — `deepMerge({}, process.env, proxyEnv, opts.env)`.
///
/// A command that names a variable itself means it, and the proxy is the default it overrides. Order
/// is the whole of the mechanism: a host applies these in sequence, so the later entry is the one the
/// process gets.
#[tokio::test]
async fn a_command_that_names_a_proxy_variable_itself_has_the_last_word() {
    let (host, log) = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    let mut command = HostCommand::new("podman", &["--version"]);
    command.env = vec![(
        "HTTP_PROXY".to_string(),
        "http://elsewhere:8080".to_string(),
    )];
    host.run_host_command(&command).await;

    let asked = log.lock().expect("asked");
    assert_eq!(
        named(&asked.commands[0], "HTTP_PROXY").as_deref(),
        Some("http://elsewhere:8080")
    );
    assert_eq!(
        named(&asked.commands[0], "NO_PROXY").as_deref(),
        Some("localhost,127.0.0.1,::1"),
        "and the rest of the connection's proxy is still there"
    );
}

/// The LAST value for a name, which is what a host applying them in order ends up with.
fn named(command: &HostCommand, name: &str) -> Option<String> {
    command
        .env
        .iter()
        .rfind(|(key, _)| key == name)
        .map(|(_, value)| value.clone())
}

#[tokio::test]
async fn a_command_that_could_not_be_spawned_is_a_failed_result_and_never_an_error() {
    // `Command.Execute` in the original catches and returns `{ success: false }`. That is why a
    // machine without podman records `which podman` exiting non-zero and reaches a diagnostic through
    // detection. An error here would bypass detection entirely and report the wrong cause.
    let (host, _log) = client(OperatingSystem::Linux, false, FakeCommand::unspawnable());

    let outcome = host
        .run_host_command(&HostCommand::new("podman", &["--version"]))
        .await;

    assert_eq!(
        outcome.code, -1,
        "the same code a signal-killed process reports: there was no exit status to read, and a \
         positive one would be indistinguishable from an engine that ran and refused"
    );
    assert!(!outcome.success(), "an unspawnable command did not succeed");
    assert!(
        !outcome.stderr.is_empty(),
        "the reason survives in stderr rather than being thrown away: {outcome:?}"
    );
}

#[tokio::test]
async fn the_scope_wrapper_reaches_the_host_through_the_client_again() {
    // client → transport → client. An earlier design claimed this re-entrancy could not be expressed
    // with the client owning its units; it is two shared borrows.
    let (host, log) = client(
        OperatingSystem::Linux,
        true,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    let outcome = host
        .run_scope_command("which", &["podman".to_string()], &settings())
        .await
        .expect("a scoped transport accepts a scope command");

    assert!(outcome.success());
    assert_eq!(
        log.lock().expect("asked").argv,
        vec![vec!["which".to_string(), "podman".to_string()]]
    );
}

#[tokio::test]
async fn a_scoped_environment_read_is_trimmed_and_an_unscoped_one_is_empty() {
    let scoped = client(
        OperatingSystem::Linux,
        true,
        FakeCommand::answering(|_| CommandExecutionResult::ok("/home/remote\n")),
    );
    assert_eq!(
        scoped
            .0
            .scope_environment_variable("HOME", &settings())
            .await,
        "/home/remote",
        "the trailing newline `printenv` prints is not part of the value"
    );

    let native = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("/home/local\n")),
    );
    assert_eq!(
        native
            .0
            .scope_environment_variable("HOME", &settings())
            .await,
        "",
        "an unscoped host has no scope to read from, so it never runs printenv"
    );
    assert!(
        native.1.lock().expect("asked").argv.is_empty(),
        "and it does not reach the exec capability at all"
    );
}

#[tokio::test]
async fn a_failed_scoped_environment_read_is_empty_rather_than_the_error_text() {
    // Every caller treats an empty answer as a reason to fall back. Returning stderr here would put a
    // diagnostic where a path belongs — `${homeDir}/.local/share` built from an error message.
    // It answers on STDOUT and still fails — a shell that prints a usage banner and exits non-zero.
    // Reading the output anyway is the mistake this guards: the exit code is the only thing that
    // says the value is a value.
    let (host, _log) = client(
        OperatingSystem::Linux,
        true,
        FakeCommand::answering(|_| CommandExecutionResult {
            code: 1,
            stdout: "usage: printenv [NAME]".to_string(),
            stderr: "printenv: not found".to_string(),
        }),
    );

    assert_eq!(
        host.scope_environment_variable("XDG_DATA_HOME", &settings())
            .await,
        ""
    );
}

#[tokio::test]
async fn settings_are_replaced_wholesale_and_read_back() {
    let (host, _log) = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );
    let mut next = settings();
    next.api.connection.uri = "unix:///run/user/1000/podman/podman.sock".to_string();

    host.set_settings(next.clone()).await;

    assert_eq!(host.settings().await, next);
}

#[test]
fn the_client_reports_the_identity_its_units_carry() {
    // The identity comes FROM the units — engine from the dialect, host and label from the profile —
    // so a registry entry cannot pair a Podman dialect with a client that calls itself Docker.
    let (host, _log) = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    assert_eq!(host.engine(), ContainerEngine::Podman);
    assert_eq!(host.host(), ContainerEngineHost::PodmanNative);
    assert_eq!(host.label(), "Stub");
    assert_eq!(host.api_surface(), ApiSurface::Libpod);
    assert_eq!(host.id(), "host.manual.podman.native");
    assert_eq!(host.program(), "podman");
    assert_eq!(host.controller(), "podman");
    assert_eq!(host.home(), "/home/tester");
    assert_eq!(host.log_level(), "warn");
    assert!(!host.is_scoped(), "a stub native transport is not scoped");
}

#[test]
fn a_resolved_scope_is_carried_and_is_absent_until_one_is_adopted() {
    let (host, _log) = client(
        OperatingSystem::Linux,
        true,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );
    assert!(
        host.scope().is_none(),
        "nothing is resolved before an attempt runs"
    );

    let adopted = host.with_scope(Some(ControllerScope::SshHost(SshHost {
        config_host: None,
        connected: None,
        host: "win11".to_string(),
        host_name: "192.168.122.5".to_string(),
        identity_file: String::new(),
        name: "win11".to_string(),
        port: 22,
        type_: SshHostType::SshConnection,
        usable: None,
        user: "tester".to_string(),
    })));

    match adopted.scope() {
        Some(ControllerScope::SshHost(scope)) => assert_eq!(scope.name, "win11"),
        other => panic!("the adopted scope survives as a value: {other:?}"),
    }
}

/// The unused-unit accessors exist so a unit can reach its siblings — the profile asks the transport
/// for a scope URI and the dialect for the engine socket, which is what `getApiConnection` is.
#[test]
fn the_units_are_reachable_from_the_context() {
    let (host, _log) = client(
        OperatingSystem::Linux,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    assert_eq!(host.dialect().engine(), ContainerEngine::Podman);
    assert_eq!(host.profile().host(), ContainerEngineHost::PodmanNative);
    assert!(!host.transport().is_scoped());
    assert_eq!(
        host.user_data_path(),
        "/home/tester/.local/share/container-desktop"
    );
}

/// A unit refuses with `domain::diagnostic::Diagnostic` — the type that is ALWAYS a failure — and
/// never with the report entry, which can also say `ok`. The two were both called `Diagnostic` until
/// this unit; that a refusal cannot even be constructed as an `ok` is the point of separating them.
#[test]
fn a_profiles_os_gate_answers_with_the_refusal_vocabulary() {
    let refused: UnitResult<()> = Err(Diagnostic::new(DiagnosticCode::EngineNotAvailableOnOs));

    let Err(refusal) = refused else {
        panic!("the gate refused");
    };
    assert_eq!(refusal.code, DiagnosticCode::EngineNotAvailableOnOs);
    assert!(
        refusal.params.is_none(),
        "a refusal is a code plus optional params, and carries no severity to disagree with"
    );
    assert!(
        StubProfile
            .is_engine_available(HostPlatform {
                os: OperatingSystem::Linux,
                arch: "x64",
            })
            .is_ok()
    );
}

/// The gate is handed the client's OWN platform, both halves of it.
///
/// `platform()` is a defaulted view over two accessors, and the failure it guards against is silent:
/// an `arch()` that answered `""` would make Apple's gate refuse every Mac, and no OS-only test could
/// tell. Asserted as a whole value, so a field that stopped being passed through cannot hide.
#[test]
fn the_client_reports_the_whole_platform_it_was_built_with() {
    let (host, _log) = client(OperatingSystem::Darwin, false, FakeCommand::agreeable());

    assert_eq!(
        host.platform(),
        HostPlatform {
            os: OperatingSystem::Darwin,
            arch: "arm64",
        }
    );
}

/// A default environment must not claim an OS it has not been told about.
///
/// `OperatingSystem`'s first variant is `Browser`, so a derived `Default` would silently describe
/// every un-configured client as a wasm host — and `Browser` passes no profile's gate for the wrong
/// reason. `Unknown` fails it for the right one.
#[test]
fn an_unconfigured_environment_claims_no_operating_system() {
    let environment = HostEnvironment::default();

    assert_eq!(environment.os_type, OperatingSystem::Unknown);
    assert_eq!(
        environment.log_level, "warn",
        "`opts?.logLevel || \"warn\"` is the original's fallback"
    );
    assert!(environment.home.is_empty() && environment.user_data_path.is_empty());
    assert!(
        environment.arch.is_empty(),
        "an unread architecture is empty, which Apple's gate refuses rather than guesses at"
    );
}

/// The capability accessors, and the two trait defaults.
///
/// A default is still behaviour: `should_keep_started_scope_running` decides whether a scope this app
/// started outlives the connection, and a dialect that forgot to answer `describe_api_bridge` must
/// contribute NOTHING to the api report rather than an empty line.
#[tokio::test]
async fn the_capabilities_are_reachable_and_the_trait_defaults_are_the_documented_ones() {
    let (host, _log) = client(
        OperatingSystem::Darwin,
        false,
        FakeCommand::answering(|_| CommandExecutionResult::ok("")),
    );

    assert_eq!(host.os_type(), OperatingSystem::Darwin);
    assert!(
        !host.fs().is_file_present(std::path::Path::new("/nowhere")),
        "the filesystem the units ask is reachable from the client"
    );
    assert!(
        host.command()
            .run(&HostCommand::new("podman", &["--version"]))
            .await
            .is_ok(),
        "so is the exec capability the transport spawns services through"
    );

    assert!(
        StubTransport { scoped: false }.should_keep_started_scope_running(),
        "a started scope is left running unless a transport says otherwise"
    );
    assert!(
        StubDialect
            .describe_api_bridge(&host, &settings())
            .await
            .is_none(),
        "only Apple has a bridge to describe; the rest contribute no note at all"
    );
}
