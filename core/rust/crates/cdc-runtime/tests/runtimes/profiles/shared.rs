//! `runtimes/profiles/shared.ts` — the OS gates, and the three profiles that carry their host as DATA.
//!
//! One struct serves both remotes, both WSL leaves and both LIMA leaves, so the LABEL is the only
//! thing that tells each pair apart — and a shared label would put the wrong engine's name on a screen.

use cdc_runtime::domain::types::connection::ApiConnection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::ContainerEngineHost;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi};
use cdc_runtime::runtimes::profiles::shared::{LimaProfile, SshProfile, WslProfile};
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
fn a_profile_that_carries_its_host_as_data_still_names_each_leaf() {
    assert_eq!(SshProfile::PODMAN.label(), "Podman SSH");
    assert_eq!(SshProfile::PODMAN.host(), ContainerEngineHost::PodmanRemote);
    assert_eq!(SshProfile::DOCKER.label(), "Docker SSH");
    assert_eq!(SshProfile::DOCKER.host(), ContainerEngineHost::DockerRemote);
    assert_eq!(WslProfile::PODMAN.label(), "Podman WSL");
    assert_eq!(
        WslProfile::PODMAN.host(),
        ContainerEngineHost::PodmanVirtualizedWsl
    );
    assert_eq!(WslProfile::DOCKER.label(), "Docker WSL");
    assert_eq!(
        WslProfile::DOCKER.host(),
        ContainerEngineHost::DockerVirtualizedWsl
    );
}

#[test]
fn a_lima_engine_is_macos_only_and_composes_a_local_socket_with_no_relay() {
    // The instance's socket is on THIS machine — LIMA binds it here, not in the guest — so there is
    // nothing to relay to, and the engine is never asked where it thinks it is listening.
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        for profile in [LimaProfile::PODMAN, LimaProfile::DOCKER] {
            let diagnostic = profile
                .is_engine_available(on(os))
                .expect_err("Lima is macOS-only in this app");
            assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
            assert_eq!(
                diagnostic.params,
                Some(json!({ "host": profile.host().to_string(), "osType": os.to_string() }))
            );
        }
    }
    assert!(
        LimaProfile::PODMAN
            .is_engine_available(on(OperatingSystem::Darwin))
            .is_ok()
    );
    assert!(
        LimaProfile::DOCKER
            .is_engine_available(on(OperatingSystem::Darwin))
            .is_ok()
    );
    assert_eq!(LimaProfile::PODMAN.label(), "Podman LIMA");
    assert_eq!(
        LimaProfile::PODMAN.host(),
        ContainerEngineHost::PodmanVirtualizedLima
    );
    assert_eq!(LimaProfile::DOCKER.label(), "Docker LIMA");
    assert_eq!(
        LimaProfile::DOCKER.host(),
        ContainerEngineHost::DockerVirtualizedLima
    );

    let settings = configured("/run/configured.sock", "/run/configured-relay.sock");
    let connection = LimaProfile::DOCKER.api_connection(&ResolvedApi {
        socket: "/run/user/501/podman/podman.sock",
        seed: "unix:///seeded.sock",
        // What LIMA forwards, and named after the TEMPLATE rather than the instance — the rule a real
        // Mac corrected. This leaf passes it through, so the value only has to be the transport's.
        scope_uri: "/Users/tester/.lima/lima-podman/sock/docker.sock",
        configured: &settings,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    });
    assert_eq!(
        connection.uri,
        "/Users/tester/.lima/lima-podman/sock/docker.sock"
    );
    assert_eq!(
        connection.relay, "",
        "the engine's in-VM socket is not a relay here — nothing bridges to it"
    );
}

#[test]
fn a_wsl_engine_is_windows_only_and_ranks_neither_end_against_the_other() {
    // WSL exists nowhere else, so the gate is `availableOn(Windows)` — the mirror image of the two
    // native profiles, which are Linux-only.
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        for profile in [WslProfile::PODMAN, WslProfile::DOCKER] {
            let diagnostic = profile
                .is_engine_available(on(os))
                .expect_err("a distribution exists only on Windows");
            assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
            assert_eq!(
                diagnostic.params,
                Some(json!({ "host": profile.host().to_string(), "osType": os.to_string() }))
            );
        }
    }
    assert!(
        WslProfile::PODMAN
            .is_engine_available(on(OperatingSystem::WindowsNt))
            .is_ok()
    );
    assert!(
        WslProfile::DOCKER
            .is_engine_available(on(OperatingSystem::WindowsNt))
            .is_ok()
    );

    // The imposed pipe is where a client dials; the guest's socket is what the engine binds. Neither
    // falls back to the other and neither consults a configured address: a Windows pipe is not a path
    // the guest can bind, and a chain across them would compose a connection that reaches nothing.
    let settings = configured("/run/configured.sock", "/run/configured-relay.sock");
    let connection = WslProfile::PODMAN.api_connection(&ResolvedApi {
        socket: "/run/user/1000/podman/podman.sock",
        seed: "unix:///seeded.sock",
        scope_uri: "\\\\.\\pipe\\container-desktop-ssh-relay-x",
        configured: &settings,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::WindowsNt,
    });
    assert_eq!(connection.uri, "\\\\.\\pipe\\container-desktop-ssh-relay-x");
    assert_eq!(connection.relay, "/run/user/1000/podman/podman.sock");
    assert!(connection.dial_stdio_command.is_empty());

    let unasked = WslProfile::DOCKER.api_connection(&ResolvedApi {
        socket: "",
        seed: "unix:///seeded.sock",
        scope_uri: "",
        configured: &settings,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::WindowsNt,
    });
    assert_eq!(
        (unasked.uri.as_str(), unasked.relay.as_str()),
        ("", ""),
        "an unresolved end stays empty, which is what `API_SOCKET_UNRESOLVED` then refuses"
    );
}

#[test]
fn the_ssh_profile_resolves_the_local_end_in_three_ranked_steps() {
    // The order IS the behaviour, so each step is pinned against a rival that must lose.
    let settings = configured("/run/configured.sock", "/run/configured-relay.sock");

    // 1. An address the scope imposes outranks everything — a Windows client cannot reach the engine
    //    any other way, so a preset must not survive it.
    let imposed = SshProfile::PODMAN.api_connection(&resolved("/run/remote.sock", "", &settings));
    assert_eq!(imposed.uri, "\\\\.\\pipe\\container-desktop-ssh-relay-x");
    assert_eq!(imposed.relay, "/run/remote.sock");

    // 2. With no imposed address, what was PRESET wins over what would be derived: the orchestrator
    //    assigns the local end before detection, and detection must not overwrite it — a derived
    //    path would bind a socket no client is watching.
    let preset = SshProfile::PODMAN.api_connection(&ResolvedApi {
        socket: "/run/remote.sock",
        seed: "",
        scope_uri: "",
        configured: &settings,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    });
    assert_eq!(preset.uri, "/run/configured.sock");

    // 3. Only with neither is one derived, which is what lets the core connect a remote the oracle
    //    would have failed with "Local address not provided".
    let derived = SshProfile::DOCKER.api_connection(&ResolvedApi {
        socket: "",
        seed: "unix:///seeded.sock",
        scope_uri: "",
        configured: &configured("", ""),
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    });
    assert_eq!(derived.uri, "/tmp/cdt-ssh-deadbeef.sock");

    // The relay is a separate, two-step chain: a remote whose engine cannot be asked keeps the relay
    // the user set, and it never consults any local address.
    let unasked = SshProfile::DOCKER.api_connection(&ResolvedApi {
        socket: "",
        seed: "unix:///seeded.sock",
        scope_uri: "",
        configured: &settings,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    });
    assert_eq!(unasked.relay, "/run/configured-relay.sock");
    assert!(
        unasked.dial_stdio_command.is_empty(),
        "a profile given no dial-stdio argv composes none"
    );
}

#[test]
fn a_remote_carries_the_bridge_its_transport_resolved() {
    // The other end of `SshTransport::resolve_dial_stdio`. Composing a bridge and then dropping it
    // here is the same defect as never composing one: `proxy::endpoint` reads this field and nothing
    // else, so a connection to a podman MACHINE would go on resolving an address inside a VM that no
    // client on this machine can open.
    let settings = configured("", "");
    let bridge = [
        "ssh",
        "--",
        "ssh",
        "-i",
        "\"k\"",
        "podman",
        "system",
        "dial-stdio",
    ]
    .map(str::to_string)
    .to_vec();
    let connection = SshProfile::PODMAN.api_connection(&ResolvedApi {
        dial_stdio: &bridge,
        ..resolved("/run/user/1000/podman/podman.sock", "", &settings)
    });

    assert_eq!(
        connection.dial_stdio_command, bridge,
        "passed straight through, exactly as `getApiConnection` passes `bridge.command`"
    );
    assert_eq!(
        connection.relay, "/run/user/1000/podman/podman.sock",
        "and the relay still says what the engine reported, which is inside the VM: the original \
         composes an `ssh://` id for its relay PROCESS, and this port has no relay to name"
    );
}
