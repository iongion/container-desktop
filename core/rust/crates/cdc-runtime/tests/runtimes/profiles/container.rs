//! Apple's two leaves — `runtimes/profiles/container.ts`.
//!
//! Written from the original, like the code they cover: no macOS is reachable from anywhere this port
//! can be built, so what is asserted is what `profiles/container.ts` DOES, never what a Mac was seen
//! doing. That is also why the gate is pinned so exhaustively — it is the one thing here that cannot
//! be caught later by somebody running the app.

use cdc_runtime::domain::types::connection::ApiConnection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::engine::ContainerEngineHost;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::{HostPlatform, HostProfile, ResolvedApi};
use cdc_runtime::runtimes::profiles::container::{APPLE_SILICON, AppleNativeProfile};
use cdc_runtime::runtimes::profiles::shared::SshProfile;
use serde_json::json;

fn platform(os: OperatingSystem, arch: &str) -> HostPlatform<'_> {
    HostPlatform { os, arch }
}

fn nothing_configured() -> ApiConnection {
    ApiConnection {
        uri: String::new(),
        relay: String::new(),
        dial_stdio_command: Vec::new(),
    }
}

#[test]
fn apple_native_names_itself_as_the_original_does() {
    // "Container", not "Apple Container" — the label reaches a screen, and the original's is the one
    // the rest of the UI is written around.
    assert_eq!(AppleNativeProfile.label(), "Container");
    assert_eq!(AppleNativeProfile.host(), ContainerEngineHost::AppleNative);
    assert_eq!(APPLE_SILICON, "arm64");
}

#[test]
fn apple_native_refuses_every_operating_system_but_macos() {
    // The OS half is asked first, so an arm64 Linux box — a Raspberry Pi, an ARM server — is refused
    // for being the wrong OS and not for its architecture, which is the honest reason.
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::WindowsNt,
        OperatingSystem::Browser,
        OperatingSystem::Unknown,
    ] {
        let diagnostic = AppleNativeProfile
            .is_engine_available(platform(os, APPLE_SILICON))
            .expect_err("Apple's engine is macOS-only");
        assert_eq!(diagnostic.code, DiagnosticCode::EngineNotAvailableOnOs);
        assert_eq!(
            diagnostic.params,
            Some(json!({
                "host": ContainerEngineHost::AppleNative.to_string(),
                "osType": os.to_string(),
            })),
            "an arm64 {os} is refused for its OS, which is the reason that will help someone"
        );
    }
}

#[test]
fn apple_native_refuses_a_mac_that_is_not_apple_silicon() {
    // The second half, and the reason `is_engine_available` takes a whole platform rather than an
    // `OperatingSystem`. An Intel Mac passes the OS gate and must still be refused — with its OWN
    // code, because `ENGINE_NOT_AVAILABLE_ON_OS` would be a lie about a machine that IS a Mac.
    let intel = AppleNativeProfile
        .is_engine_available(platform(OperatingSystem::Darwin, "x64"))
        .expect_err("Apple's engine needs Apple silicon");
    assert_eq!(intel.code, DiagnosticCode::EngineNotAvailableOnArch);
    assert_eq!(
        intel.params,
        Some(json!({
            "host": ContainerEngineHost::AppleNative.to_string(),
            "arch": "x64",
            "required": APPLE_SILICON,
        })),
        "the client renders the prose, so the parameters carry what was found AND what was needed"
    );

    // An arch that could not be read is REFUSED, not assumed. The original wraps `getOsArch()` in a
    // try and answers `{ success: false }` from the catch, so an unreadable machine already fails
    // there — and guessing "probably arm64" would send a user chasing a missing binary instead.
    let unreadable = AppleNativeProfile
        .is_engine_available(platform(OperatingSystem::Darwin, ""))
        .expect_err("an unknown architecture is not a pass");
    assert_eq!(unreadable.code, DiagnosticCode::EngineNotAvailableOnArch);
    assert_eq!(
        unreadable
            .params
            .and_then(|it| it["arch"].as_str().map(str::to_string)),
        Some(String::new())
    );

    assert!(
        AppleNativeProfile
            .is_engine_available(platform(OperatingSystem::Darwin, APPLE_SILICON))
            .is_ok(),
        "and an Apple-silicon Mac is the one machine that passes both halves"
    );
}

#[test]
fn apple_native_composes_the_dialects_socket_and_nothing_else() {
    // A one-step ranking, which is unusual here and is the original's: `appleNativeProfile` returns
    // `readEngineSocket` with `relay: ""`. Every rival field is deliberately populated below — a leaf
    // that consulted the seed would connect this host to somebody else's daemon, and one that
    // consulted the scope uri would compose the local end of a tunnel that does not exist.
    let configured = ApiConnection {
        uri: "/run/configured.sock".to_string(),
        relay: "/run/configured-relay.sock".to_string(),
        dial_stdio_command: Vec::new(),
    };
    let connection = AppleNativeProfile.api_connection(&ResolvedApi {
        socket: "/Users/tester/.socktainer/container.sock",
        seed: "unix:///var/run/docker.sock",
        scope_uri: "\\\\.\\pipe\\container-desktop-ssh-relay-x",
        configured: &configured,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "\\\\.\\pipe\\dockerDesktopLinuxEngine",
        dial_stdio: &[],
        os: OperatingSystem::Darwin,
    });

    assert_eq!(connection.uri, "/Users/tester/.socktainer/container.sock");
    assert_eq!(
        connection.relay, "",
        "socktainer binds on this Mac — there is no guest to relay to"
    );
    assert!(connection.dial_stdio_command.is_empty());

    // An unresolved socket stays unresolved rather than falling back to any of the above, which is
    // what lets `API_SOCKET_UNRESOLVED` refuse it instead of a wrong daemon accepting it.
    let unresolved = AppleNativeProfile.api_connection(&ResolvedApi {
        socket: "",
        seed: "unix:///var/run/docker.sock",
        scope_uri: "",
        configured: &configured,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Darwin,
    });
    assert_eq!(unresolved.uri, "");
}

#[test]
fn apples_remote_is_the_same_ssh_profile_the_other_two_engines_use() {
    // `appleSSHProfile` is `sshApiConnection` + `availableAlways`, character for character what
    // `podmanSSHProfile` and `dockerSSHProfile` are — so it is a third CONST, and the label is the
    // only thing that distinguishes it. A shared label would put the wrong engine's name on a screen.
    assert_eq!(SshProfile::APPLE.label(), "Container SSH");
    assert_eq!(SshProfile::APPLE.host(), ContainerEngineHost::AppleRemote);

    // `availableAlways`, INCLUDING on an x64 Linux desktop: the gate asks where the CLIENT runs, and
    // `ssh` runs everywhere. Whether the far end is an Apple-silicon Mac is the remote's business,
    // and applying the native leaf's arch gate here would refuse every non-Mac user a remote Mac.
    for os in [
        OperatingSystem::Linux,
        OperatingSystem::Darwin,
        OperatingSystem::WindowsNt,
        OperatingSystem::Unknown,
    ] {
        assert!(
            SshProfile::APPLE
                .is_engine_available(platform(os, "x64"))
                .is_ok()
        );
    }

    // And it ranks the two ends exactly as the other remotes do.
    let configured = nothing_configured();
    let connection = SshProfile::APPLE.api_connection(&ResolvedApi {
        socket: "/Users/remote/.socktainer/container.sock",
        seed: "",
        scope_uri: "",
        configured: &configured,
        local_fallback: "/tmp/cdt-ssh-deadbeef.sock",
        probed: "",
        dial_stdio: &[],
        os: OperatingSystem::Linux,
    });
    assert_eq!(connection.uri, "/tmp/cdt-ssh-deadbeef.sock");
    assert_eq!(connection.relay, "/Users/remote/.socktainer/container.sock");
}
