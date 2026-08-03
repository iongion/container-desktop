//! `runtimes/transports/native.ts` — the transport that has no scope.
//!
//! Defined by what it REFUSES: every scope question is answered with an absence rather than a
//! pretence, which is `facade.ts`'s "maximize symmetry, even with no-ops" and what lets callers
//! branch on capability instead of on host identity.

use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::Transport;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::docker::DockerNativeProfile;
use cdc_runtime::runtimes::profiles::podman::PodmanNativeProfile;
use cdc_runtime::runtimes::transports::native::NativeTransport;
use serde_json::json;

#[tokio::test]
async fn a_native_transport_answers_every_scope_question_without_pretending_to_have_one() {
    // Symmetry, even with no-ops (`facade.ts`): an unscoped host answers EVERY question with an
    // absence and a reason, so the caller branches on the answer and never on the host type.
    let host = crate::fakes::unit_host(
        "engine.default.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        crate::fakes::FakeCommand::agreeable(),
    );
    let settings = crate::fakes::unit_settings();
    let transport = NativeTransport;

    assert!(!transport.is_scoped());
    assert_eq!(
        transport.resolve_scope_uri(&host, &settings, "").await,
        "",
        "an unscoped host imposes no address, rather than deriving a socket path"
    );
    assert_eq!(
        transport.local_forward_fallback(&host).await,
        "",
        "nothing is forwarded to a native engine, so there is no local end to derive either"
    );
    assert_eq!(
        transport
            .start_scope(&host)
            .await
            .expect("answering is not failing"),
        cdc_runtime::domain::types::host::StartupStatus::Error,
        "asking an unscoped host to start a scope is the wrong question, and it says so"
    );
    assert!(!transport.stop_scope(&host).await.expect("answers"));
    assert!(
        transport
            .list_scopes(&host, &settings)
            .await
            .expect("answers")
            .is_empty()
    );
    assert!(
        transport
            .controller_default_scope(&host, &settings)
            .await
            .expect("answers")
            .is_none()
    );
    assert!(
        transport
            .diagnose_scope(&host, Some("podman"))
            .await
            .is_none(),
        "a host with no scope has no failed scope to explain — and it still answers the question"
    );
    assert_eq!(
        transport.resolve_guest_path(&host, "/tmp/ctx").await,
        "/tmp/ctx",
        "there is no guest, so a local path is already the path"
    );

    let diagnostic = transport
        .run_scope_command(&host, "podman", &["info".to_string()], &settings)
        .await
        .expect_err("scope is not supported in native mode");
    assert_eq!(diagnostic.code, DiagnosticCode::ScopeNotSet);
    assert_eq!(
        diagnostic.params,
        Some(json!({ "transport": "native", "program": "podman" }))
    );
}

#[tokio::test]
async fn docker_native_has_nothing_to_start_and_that_is_not_a_failure() {
    // `buildServiceArgs` answers null, so `startApi` answers false — "start the host manually",
    // which the caller FORGIVES. An `Err` here would fail an attempt that should carry on to the
    // availability check.
    let host = crate::fakes::unit_host(
        "engine.default.docker.native",
        Box::new(NativeTransport),
        Box::new(cdc_runtime::runtimes::dialects::docker::DockerDialect),
        Box::new(DockerNativeProfile),
        OperatingSystem::Linux,
        crate::fakes::FakeCommand::agreeable(),
    );
    let mut settings = crate::fakes::unit_settings();
    settings.api.connection.uri = "unix:///var/run/docker.sock".to_string();

    assert!(
        !NativeTransport
            .start_api(&host, &settings)
            .await
            .expect("no managed service is an answer, not an error")
    );
}

#[tokio::test]
async fn podman_native_refuses_to_start_a_service_on_an_unresolved_socket() {
    // `podman system service unix://` would bind nothing. Detection having failed to resolve an
    // address is the fault, and naming it beats spawning something that cannot listen.
    let host = crate::fakes::unit_host(
        "engine.default.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        crate::fakes::FakeCommand::agreeable(),
    );

    let diagnostic = NativeTransport
        .start_api(&host, &crate::fakes::unit_settings())
        .await
        .expect_err("an empty uri is refused");
    assert_eq!(diagnostic.code, DiagnosticCode::ApiSocketUnresolved);
}

#[tokio::test]
async fn a_sandboxed_start_creates_the_hosts_copy_of_the_socket_directory_as_well() {
    // **Both, and the prefixed one FIRST** — the original's order. The ENGINE binds the socket in the
    // host's namespace, so the directory that has to exist for it is the prefixed one; the unprefixed
    // path is what this process then checks for itself. Creating only one of the two leaves a
    // connection whose service cannot bind, reported as an engine that would not start.
    let fs = crate::fakes::MemoryFs::default();
    let mut settings = crate::fakes::unit_settings();
    settings.api.connection.uri = "unix:///run/user/1000/podman/podman.sock".to_string();
    let host = crate::fakes::unit_host_in_flatpak(
        "engine.default.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        crate::fakes::FakeCommand::agreeable(),
        fs.clone(),
    );

    NativeTransport
        .start_api(&host, &settings)
        .await
        .expect("the service starts");

    assert!(
        fs.made("/var/run/user/1000/podman"),
        "the host's copy, reached under /var because /run/user is bind-mounted there"
    );
    assert!(
        fs.made("/run/user/1000/podman"),
        "and this process's own view of it, which is what the presence check asks about"
    );
}

#[tokio::test]
async fn an_unsandboxed_start_creates_exactly_one_directory_and_no_prefixed_ghost() {
    // The negative half, and it is not a tautology: without the `is_flatpak` guard the prefixed mkdir
    // would run on every ordinary Linux install and litter `/var/run/host` on a machine that has no
    // such namespace.
    let fs = crate::fakes::MemoryFs::default();
    let mut settings = crate::fakes::unit_settings();
    settings.api.connection.uri = "unix:///run/user/1000/podman/podman.sock".to_string();
    let host = crate::fakes::unit_host_over(
        "engine.default.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        crate::fakes::FakeCommand::agreeable(),
        "ssh",
        fs.clone(),
    );

    NativeTransport
        .start_api(&host, &settings)
        .await
        .expect("the service starts");

    assert!(fs.made("/run/user/1000/podman"));
    assert!(!fs.made("/var/run/user/1000/podman"));
}
