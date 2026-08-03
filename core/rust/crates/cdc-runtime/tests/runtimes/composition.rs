//! `runtimes/composition.rs` — the three traits, and what every implementation owes them.
//!
//! Not the implementations: a leaf's OS gate and its API ranking belong to the leaf, and live in
//! `profiles/`. What is here is the CONTRACT — the answers a trait requires of everyone, and the
//! DEFAULTS it supplies to the eleven that have nothing to say.

use crate::fakes::{FakeCommand, unit_host, unit_settings};
use cdc_runtime::domain::types::engine::{ApiSurface, ContainerEngine};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::runtimes::composition::EngineDialect;
use cdc_runtime::runtimes::composition::HostProfile;
use cdc_runtime::runtimes::dialects::container::AppleDialect;
use cdc_runtime::runtimes::dialects::docker::DockerDialect;
use cdc_runtime::runtimes::dialects::podman::PodmanDialect;
use cdc_runtime::runtimes::profiles::docker::DockerNativeProfile;
use cdc_runtime::runtimes::profiles::podman::{PodmanNativeProfile, PodmanVendorProfile};
use cdc_runtime::runtimes::profiles::shared::{LimaProfile, SshProfile, WslProfile};
use cdc_runtime::runtimes::transports::native::NativeTransport;

#[test]
fn each_dialect_names_its_engine_and_the_rest_surface_it_speaks() {
    assert_eq!(PodmanDialect.engine(), ContainerEngine::Podman);
    assert_eq!(PodmanDialect.api_surface(), ApiSurface::Libpod);
    assert_eq!(DockerDialect.engine(), ContainerEngine::Docker);
    assert_eq!(DockerDialect.api_surface(), ApiSurface::Docker);
}

#[tokio::test]
async fn only_apple_describes_an_api_bridge() {
    // Podman and Docker speak REST natively and contribute NOTHING to the api report — not an empty
    // line, which would show as a stray separator.
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        FakeCommand::agreeable(),
    );

    assert!(
        PodmanDialect
            .describe_api_bridge(&host, &unit_settings())
            .await
            .is_none()
    );
    assert!(
        DockerDialect
            .describe_api_bridge(&host, &unit_settings())
            .await
            .is_none()
    );
}
#[tokio::test]
async fn an_engine_with_no_notion_of_a_target_selects_nothing_even_when_one_is_named() {
    // The DEFAULT's value, and the reason it is asserted with a context SET: a dialect that ignored
    // its own concept-less-ness and passed the name through would compose `podman --context X`,
    // which podman refuses — and the connection would fail with an argv error rather than connect.
    let mut settings = unit_settings();
    settings.context = Some("desktop-linux".to_string());
    for dialect in [
        &PodmanDialect as &dyn EngineDialect,
        &AppleDialect as &dyn EngineDialect,
    ] {
        assert_eq!(
            dialect.target_args(&settings),
            Vec::<String>::new(),
            "{:?} has no contexts",
            dialect.engine()
        );
    }
}

#[tokio::test]
async fn an_engine_with_no_contexts_offers_none_and_runs_nothing_to_say_so() {
    // The trait's default for `list_contexts`. Asserted against the COMMAND log as well as the
    // answer: a default that shelled out to find nothing would cost every podman connection a
    // process per listing.
    let command = FakeCommand::agreeable();
    let log = command.log();
    let host = unit_host(
        "host.manual.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        command,
    );

    assert_eq!(
        PodmanDialect
            .list_contexts(&host, &unit_settings())
            .await
            .expect("the default never refuses"),
        Vec::new()
    );
    assert_eq!(
        AppleDialect
            .list_contexts(&host, &unit_settings())
            .await
            .expect("the default never refuses"),
        Vec::new()
    );
    assert!(
        log.lock().expect("asked").argv.is_empty(),
        "the default answered without asking the machine anything"
    );
}

#[tokio::test]
async fn a_leaf_with_nothing_to_probe_answers_an_absence() {
    // Eleven of the twelve leaves default `probe_uri`, and the default's VALUE is what this pins.
    // Nothing consumes `probed` today except Docker Desktop, which overrides the method — so a
    // default that answered junk would sit undetected until the next leaf wired `probed` into its
    // ranking, and then compose an address out of the junk.
    let host = crate::fakes::unit_host(
        "engine.default.podman.native",
        Box::new(NativeTransport),
        Box::new(PodmanDialect),
        Box::new(PodmanNativeProfile),
        OperatingSystem::Linux,
        crate::fakes::FakeCommand::agreeable(),
    );
    let settings = crate::fakes::unit_settings();

    for profile in [
        &PodmanNativeProfile as &dyn HostProfile,
        &DockerNativeProfile as &dyn HostProfile,
        &PodmanVendorProfile as &dyn HostProfile,
        &SshProfile::PODMAN as &dyn HostProfile,
        &WslProfile::DOCKER as &dyn HostProfile,
        &LimaProfile::PODMAN as &dyn HostProfile,
    ] {
        assert_eq!(
            profile.probe_uri(&host, &settings).await,
            "",
            "{} has nothing to look for",
            profile.host()
        );
    }
}

#[test]
fn the_two_leaves_whose_socket_a_sandbox_does_not_move_say_so_and_the_rest_inherit_yes() {
    // The oracle states this as a list of eight hosts; here it is the property that list encodes, so
    // both sides need asserting or the default is doing all the work. WSL is on this list twice over —
    // flatpak is Linux-only and that leaf is gated to Windows — and it is still stated, because a rule
    // that is true by accident stops being true when the accident changes.
    for opted_out in [
        &LimaProfile::PODMAN as &dyn HostProfile,
        &LimaProfile::DOCKER as &dyn HostProfile,
        &WslProfile::PODMAN as &dyn HostProfile,
        &WslProfile::DOCKER as &dyn HostProfile,
    ] {
        assert!(
            !opted_out.sandbox_maps_socket(),
            "{} binds its socket where a sandboxed process already reaches it",
            opted_out.host()
        );
    }
    for mapped in [
        &PodmanNativeProfile as &dyn HostProfile,
        &DockerNativeProfile as &dyn HostProfile,
        &PodmanVendorProfile as &dyn HostProfile,
        &SshProfile::PODMAN as &dyn HostProfile,
        &SshProfile::DOCKER as &dyn HostProfile,
    ] {
        assert!(
            mapped.sandbox_maps_socket(),
            "{} reaches a HOST path and must be re-spelled inside a sandbox",
            mapped.host()
        );
    }
}
