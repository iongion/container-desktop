//! `runtimes/profiles/docker.ts` — the two docker leaves that are not shared.
//!
//! `DockerVendorProfile` is Docker Desktop, and it is the one leaf that PROBES: which pipe an install
//! serves is decided by looking, and the engine is not asked at all on Windows.

use cdc_runtime::domain::types::connection::ApiConnection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::ContainerEngineHost;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi};
use cdc_runtime::runtimes::profiles::docker::{
    DOCKER_DESKTOP_PIPE, DOCKER_ENGINE_PIPE, DockerNativeProfile, DockerVendorProfile,
};
use cdc_runtime::runtimes::transports::native::NativeTransport;
use serde_json::json;

fn on(os: OperatingSystem) -> HostPlatform<'static> {
    HostPlatform { os, arch: "x64" }
}

/// end of a tunnel that does not exist.
fn resolved<'a>(socket: &'a str, seed: &'a str, configured: &'a ApiConnection) -> ResolvedApi<'a> {
    ResolvedApi {
        socket,
        seed,
        scope_uri: "\\\\.\\pipe\\container-desktop-ssh-relay-x",
        configured,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    }
}

fn configured(uri: &str, relay: &str) -> ApiConnection {
    ApiConnection {
        uri: uri.to_string(),
        relay: relay.to_string(),
        dial_stdio_command: Vec::new(),
    }
}

#[test]
fn docker_native_names_itself_and_runs_only_on_linux() {
    assert_eq!(DockerNativeProfile.label(), "Docker Native");
    assert_eq!(
        DockerNativeProfile.host(),
        ContainerEngineHost::DockerNative
    );
    for os in [
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        let diagnostic = DockerNativeProfile
            .is_engine_available(on(os))
            .expect_err("docker does not run natively off Linux");
        assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
        assert_eq!(
            diagnostic.params,
            Some(json!({
                "host": ContainerEngineHost::DockerNative.to_string(),
                "osType": os.to_string(),
            }))
        );
    }
    assert!(
        DockerNativeProfile
            .is_engine_available(on(OperatingSystem::Linux))
            .is_ok()
    );
}

fn vendor<'a>(
    socket: &'a str,
    seed: &'a str,
    probed: &'a str,
    scope_uri: &'a str,
    configured: &'a ApiConnection,
    os: OperatingSystem,
) -> ResolvedApi<'a> {
    ResolvedApi {
        socket,
        seed,
        scope_uri,
        configured,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed,
        // Neither of these profiles composes a bridge — a native or vendor engine has a local socket.
        // `WslProfile` is the one that passes it through, and its own test is what pins that.
        dial_stdio: &[],
        os,
    }
}

/// A Docker Desktop client on Windows over the filesystem a test cares about.
fn windows_desktop_host(
    fs: crate::fakes::MemoryFs,
) -> cdc_runtime::runtimes::host_client::HostClient {
    crate::fakes::unit_host_over(
        "engine.default.docker.virtualized.vendor",
        Box::new(NativeTransport),
        Box::new(cdc_runtime::runtimes::dialects::docker::DockerDialect),
        Box::new(DockerVendorProfile),
        OperatingSystem::WindowsNt,
        crate::fakes::FakeCommand::agreeable(),
        "docker",
        fs,
    )
}

#[test]
fn docker_desktop_is_refused_only_on_linux() {
    // `availableUnless(Linux)`, which is NOT `availableOn`'s negation: it has to pass on macOS AND on
    // Windows. A single-OS gate written the other way round would refuse one of the two platforms
    // Docker Desktop actually ships on.
    assert_eq!(DockerVendorProfile.label(), "Docker Desktop");
    assert_eq!(
        DockerVendorProfile.host(),
        ContainerEngineHost::DockerVirtualizedVendor
    );
    for os in [
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        assert!(
            DockerVendorProfile.is_engine_available(on(os)).is_ok(),
            "Docker Desktop is refused on Linux and nowhere else, but {os} refused it"
        );
    }
    let diagnostic = DockerVendorProfile
        .is_engine_available(on(OperatingSystem::Linux))
        .expect_err("on Linux the NATIVE host is what a user wants");
    assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
    assert_eq!(
        diagnostic.params,
        Some(json!({
            "host": ContainerEngineHost::DockerVirtualizedVendor.to_string(),
            "osType": OperatingSystem::Linux.to_string(),
        }))
    );
}

#[tokio::test]
async fn docker_desktop_probes_which_pipe_this_install_serves() {
    // Which pipe Docker Desktop publishes cannot be asked of the engine, only LOOKED for: a current
    // install serves `dockerDesktopLinuxEngine` and an older one `docker_engine`.
    let current = format!("\\\\.\\pipe\\{DOCKER_DESKTOP_PIPE}");
    let legacy = format!("\\\\.\\pipe\\{DOCKER_ENGINE_PIPE}");

    let installed = windows_desktop_host(crate::fakes::MemoryFs::seeded(&current, ""));
    assert_eq!(
        DockerVendorProfile
            .probe_uri(&installed, &crate::fakes::unit_settings())
            .await,
        current,
        "the current pipe wins when it is there"
    );

    // The legacy pipe is answered WITHOUT being checked — the original does not check it either, and
    // an install with neither leaves the availability check to refuse an address that answers nothing.
    let older = windows_desktop_host(crate::fakes::MemoryFs::default());
    assert_eq!(
        DockerVendorProfile
            .probe_uri(&older, &crate::fakes::unit_settings())
            .await,
        legacy
    );

    // Off Windows there is no pipe and nothing to look for, even on a filesystem that has one.
    for os in [OperatingSystem::Darwin, OperatingSystem::Linux] {
        let elsewhere = crate::fakes::unit_host_over(
            "engine.default.docker.virtualized.vendor",
            Box::new(NativeTransport),
            Box::new(cdc_runtime::runtimes::dialects::docker::DockerDialect),
            Box::new(DockerVendorProfile),
            os,
            crate::fakes::FakeCommand::agreeable(),
            "docker",
            crate::fakes::MemoryFs::seeded(&current, ""),
        );
        assert_eq!(
            DockerVendorProfile
                .probe_uri(&elsewhere, &crate::fakes::unit_settings())
                .await,
            "",
            "a named pipe is a Windows thing, and {os} has no business reporting one"
        );
    }
}

#[test]
fn docker_desktop_ranks_its_endpoint_differently_per_platform() {
    let settings = configured("/run/configured.sock", "/run/configured-relay.sock");
    let probed = format!("\\\\.\\pipe\\{DOCKER_DESKTOP_PIPE}");

    // On Windows the ENGINE IS NEVER ASKED. `docker context inspect` there answers with whatever
    // context happens to be selected, which need not be the Linux engine this host means — so the
    // socket loses to the probed pipe even though it is present and looks perfectly good.
    let windows = DockerVendorProfile.api_connection(&vendor(
        "/var/run/docker.sock",
        "",
        &probed,
        "",
        &settings,
        OperatingSystem::WindowsNt,
    ));
    assert_eq!(windows.uri, probed);
    assert_eq!(windows.relay, "");

    // A `DOCKER_HOST` the user set outranks the probe: they said where the daemon is.
    let overridden = DockerVendorProfile.api_connection(&vendor(
        "/var/run/docker.sock",
        "npipe:////./pipe/custom",
        &probed,
        "",
        &settings,
        OperatingSystem::WindowsNt,
    ));
    assert_eq!(overridden.uri, "npipe:////./pipe/custom");

    // Everywhere else it is the native ranking with the seed KEPT — and that is the asymmetry with
    // `docker.native`, which discards its seed. Both are the oracle's, in the same file.
    let mac = DockerVendorProfile.api_connection(&vendor(
        "/var/run/docker.sock",
        "unix:///seeded.sock",
        &probed,
        "",
        &settings,
        OperatingSystem::Darwin,
    ));
    assert_eq!(mac.uri, "/var/run/docker.sock");
    let unasked = DockerVendorProfile.api_connection(&vendor(
        "",
        "unix:///seeded.sock",
        &probed,
        "",
        &settings,
        OperatingSystem::Darwin,
    ));
    assert_eq!(
        unasked.uri, "unix:///seeded.sock",
        "off Windows the seed survives a context read that answered nothing"
    );
    assert_eq!(
        DockerNativeProfile
            .api_connection(&resolved("", "unix:///seeded.sock", &settings))
            .uri,
        "",
        "…where the NATIVE leaf discards the very same seed"
    );

    // The relay is absent on every platform: the original reads it from the engine-EXTENSION surface
    // (`getSystemInfo().host.remoteSocket.path`), which this core does not carry.
    assert_eq!(mac.relay, "");
    assert!(mac.dial_stdio_command.is_empty());
}
