//! `runtimes/profiles/podman.ts` — the two podman leaves that are not shared.
//!
//! `PodmanNativeProfile` is the engine on THIS machine; `PodmanVendorProfile` is podman's own
//! machine, which is a VM whose socket has to be bridged on Windows and not anywhere else.

// Copied rather than shared with `docker.rs`, for the same reason the dialects' fixtures are.
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

use cdc_runtime::domain::types::connection::ApiConnection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::ContainerEngineHost;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi};
use cdc_runtime::runtimes::profiles::docker::DockerNativeProfile;
use cdc_runtime::runtimes::profiles::podman::{PodmanNativeProfile, PodmanVendorProfile};
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
fn podman_native_names_itself_and_runs_only_on_linux() {
    assert_eq!(PodmanNativeProfile.label(), "Podman Native");
    assert_eq!(
        PodmanNativeProfile.host(),
        ContainerEngineHost::PodmanNative
    );
    for os in [
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        let diagnostic = PodmanNativeProfile
            .is_engine_available(on(os))
            .expect_err("podman does not run natively off Linux");
        assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
        assert_eq!(
            diagnostic.params,
            Some(json!({
                "host": ContainerEngineHost::PodmanNative.to_string(),
                "osType": os.to_string(),
            })),
            "the client renders the prose, so the parameters have to carry both facts"
        );
    }
    assert!(
        PodmanNativeProfile
            .is_engine_available(on(OperatingSystem::Linux))
            .is_ok()
    );
}

#[test]
fn podman_keeps_the_environment_seed_where_docker_discards_it() {
    // The asymmetry is in the oracle and is preserved rather than smoothed over.
    let settings = configured("/run/configured.sock", "");
    assert_eq!(
        PodmanNativeProfile
            .api_connection(&resolved("", "unix:///seeded.sock", &settings))
            .uri,
        "unix:///seeded.sock"
    );
    assert_eq!(
        DockerNativeProfile
            .api_connection(&resolved("", "unix:///seeded.sock", &settings))
            .uri,
        "",
        "Docker discards the DOCKER_HOST seed when the context cannot be read"
    );

    // With a socket, both use it and neither invents a relay.
    for profile in [
        &PodmanNativeProfile as &dyn HostProfile,
        &DockerNativeProfile as &dyn HostProfile,
    ] {
        let connection = profile.api_connection(&resolved(
            "/run/engine.sock",
            "unix:///seeded.sock",
            &settings,
        ));
        assert_eq!(connection.uri, "/run/engine.sock");
        assert_eq!(
            connection.relay, "",
            "a native host has no guest to relay to"
        );
        assert!(connection.dial_stdio_command.is_empty());
    }
}
#[test]
fn a_podman_machine_runs_everywhere_and_relays_only_what_needs_bridging() {
    // `availableAlways` — a machine runs on all three desktops, which is the whole point of it.
    assert_eq!(PodmanVendorProfile.label(), "Podman Machine");
    assert_eq!(
        PodmanVendorProfile.host(),
        ContainerEngineHost::PodmanVirtualizedVendor
    );
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        assert!(PodmanVendorProfile.is_engine_available(on(os)).is_ok());
    }

    let settings = configured("/run/configured.sock", "/run/configured-relay.sock");

    // A POSIX machine: the scope's socket is where a client dials, and the engine's own in-VM socket
    // is what the app bridges to.
    let posix = PodmanVendorProfile.api_connection(&vendor(
        "/run/user/1000/podman/podman.sock",
        "unix:///seeded.sock",
        "",
        "/Users/tester/.local/share/containers/podman/machine/qemu/podman.sock",
        &settings,
        OperatingSystem::Darwin,
    ));
    assert_eq!(
        posix.uri,
        "/Users/tester/.local/share/containers/podman/machine/qemu/podman.sock"
    );
    assert_eq!(posix.relay, "/run/user/1000/podman/podman.sock");

    // A native Windows PIPE (newer podman) is dialed DIRECTLY, so there is no relay at all. Reading
    // the in-VM socket as a relay anyway is what used to overwrite a reachable pipe with a path no
    // Windows process can open.
    for pipe in [
        "\\\\.\\pipe\\podman-machine-default",
        "npipe:////./pipe/podman-machine-default",
        "//./pipe/podman-machine-default",
    ] {
        let piped = PodmanVendorProfile.api_connection(&vendor(
            "/run/user/1000/podman/podman.sock",
            "unix:///seeded.sock",
            "",
            pipe,
            &settings,
            OperatingSystem::WindowsNt,
        ));
        assert_eq!(piped.uri, pipe);
        assert_eq!(
            piped.relay, "",
            "{pipe} is dialed directly — a relay here would clobber it"
        );
    }
}
