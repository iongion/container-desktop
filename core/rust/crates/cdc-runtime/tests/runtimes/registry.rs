//! The connector table and what it composes — `runtimes/registry.ts`.
//!
//! The table is DATA, so it is asserted as data: twelve connectors, each with the engine binary and
//! the controller that enters its scope. A wrong constant here is a connection that shells out to the
//! wrong program, and there is no logic to catch it.

use cdc_runtime::domain::types::connection::SortMode;
use cdc_runtime::domain::types::engine::{ContainerEngine, ContainerEngineHost};
use cdc_runtime::runtimes::registry::{CONNECTORS, ComposeError, capabilities, compose, resolve};

#[test]
fn every_connector_the_app_offers_is_registered_with_its_two_binaries() {
    // Podman x 5, Docker x 5, Apple x 2 — asserted as the whole table rather than a count, because a
    // count is satisfied by twelve copies of the same entry.
    let table: Vec<(String, String, &str, &str)> = CONNECTORS
        .iter()
        .map(|it| {
            (
                it.engine.to_string(),
                it.host.to_string(),
                it.program,
                it.controller,
            )
        })
        .collect();

    assert_eq!(
        table,
        vec![
            (
                "podman".to_string(),
                "podman.native".to_string(),
                "podman",
                "podman"
            ),
            (
                "podman".to_string(),
                "podman.virtualized.vendor".to_string(),
                "podman",
                "podman"
            ),
            (
                "podman".to_string(),
                "podman.virtualized.wsl".to_string(),
                "podman",
                "wsl"
            ),
            (
                "podman".to_string(),
                "podman.virtualized.lima".to_string(),
                "podman",
                "limactl"
            ),
            (
                "podman".to_string(),
                "podman.remote".to_string(),
                "podman",
                "ssh"
            ),
            (
                "docker".to_string(),
                "docker.native".to_string(),
                "docker",
                "docker"
            ),
            (
                "docker".to_string(),
                "docker.virtualized.vendor".to_string(),
                "docker",
                "docker"
            ),
            (
                "docker".to_string(),
                "docker.virtualized.wsl".to_string(),
                "docker",
                "wsl"
            ),
            (
                "docker".to_string(),
                "docker.virtualized.lima".to_string(),
                "docker",
                "limactl"
            ),
            (
                "docker".to_string(),
                "docker.remote".to_string(),
                "docker",
                "ssh"
            ),
            // Apple's engine binary IS `container`, which is also the engine's wire value.
            (
                "container".to_string(),
                "container.native".to_string(),
                "container",
                "container"
            ),
            (
                "container".to_string(),
                "container.remote".to_string(),
                "container",
                "ssh"
            ),
        ]
    );
}

#[test]
fn a_pair_the_original_never_registered_is_refused_as_such() {
    // Not "unimplemented" — a Podman engine on a Docker host is not a thing, however complete both
    // halves are, and reporting it as a missing feature would send someone looking for a file to write.
    assert_eq!(
        resolve(ContainerEngine::Podman, ContainerEngineHost::DockerNative),
        None
    );
    assert_eq!(
        compose(ContainerEngine::Podman, ContainerEngineHost::DockerNative)
            .err()
            .expect("a mismatched pair is refused"),
        ComposeError::NotAConnector {
            engine: ContainerEngine::Podman,
            host: ContainerEngineHost::DockerNative,
        }
    );
}

#[test]
fn the_composed_connectors_get_the_units_their_host_calls_for() {
    for (engine, host, scoped) in [
        (
            ContainerEngine::Podman,
            ContainerEngineHost::PodmanNative,
            false,
        ),
        (
            ContainerEngine::Docker,
            ContainerEngineHost::DockerNative,
            false,
        ),
        (
            ContainerEngine::Podman,
            ContainerEngineHost::PodmanRemote,
            true,
        ),
        (
            ContainerEngine::Docker,
            ContainerEngineHost::DockerRemote,
            true,
        ),
        (
            ContainerEngine::Podman,
            ContainerEngineHost::PodmanVirtualizedWsl,
            true,
        ),
        (
            ContainerEngine::Docker,
            ContainerEngineHost::DockerVirtualizedWsl,
            true,
        ),
        (
            ContainerEngine::Podman,
            ContainerEngineHost::PodmanVirtualizedVendor,
            true,
        ),
        (
            ContainerEngine::Podman,
            ContainerEngineHost::PodmanVirtualizedLima,
            true,
        ),
        (
            ContainerEngine::Docker,
            ContainerEngineHost::DockerVirtualizedLima,
            true,
        ),
        // Docker's vendor host is UNSCOPED — it uses the NATIVE transport, where Podman's vendor host
        // enters a machine. Grouping the two is the mistake this pins.
        (
            ContainerEngine::Docker,
            ContainerEngineHost::DockerVirtualizedVendor,
            false,
        ),
        // Apple's native host is unscoped for the same reason Docker Desktop's is: socktainer binds
        // on THIS Mac. Its remote is an SSH host like the other two.
        (
            ContainerEngine::Apple,
            ContainerEngineHost::AppleNative,
            false,
        ),
        (
            ContainerEngine::Apple,
            ContainerEngineHost::AppleRemote,
            true,
        ),
    ] {
        let units = compose(engine, host).unwrap_or_else(|_| panic!("{host} is composed"));
        assert_eq!(
            units.dialect.engine(),
            engine,
            "the dialect is the engine's"
        );
        assert_eq!(units.profile.host(), host, "the profile is the host's");
        assert_eq!(
            units.transport.is_scoped(),
            scoped,
            "a remote host is scoped and a native one is not — reading this the wrong way round \
             would point a remote connection at the local engine"
        );
    }
}

#[test]
fn every_registered_connector_composes() {
    // `ComposeError::Unimplemented` used to live here, naming the unit an unported connector was
    // waiting for. Both Apple arms landed, so it became unconstructible and was deleted — and this
    // is the assertion that replaces it: the table and the `match` agree, for all twelve.
    for connector in CONNECTORS {
        assert!(
            compose(connector.engine, connector.host).is_ok(),
            "{} is registered but does not compose",
            connector.host
        );
    }
}

#[test]
fn a_pair_no_release_ever_registered_is_refused_by_name() {
    // The one failure `compose` still has, and it is reachable: a settings file can name any engine
    // beside any host, and `podman` on a `docker.native` host is not a missing feature — it is not a
    // thing. Refused rather than resolved to whichever unit the host alone would have chosen.
    let engine = ContainerEngine::Podman;
    let host = ContainerEngineHost::DockerNative;

    assert!(resolve(engine, host).is_none());
    assert_eq!(
        compose(engine, host).err().expect("not a connector"),
        ComposeError::NotAConnector { engine, host },
        "the refusal carries BOTH halves — which engine, and which host it was asked for"
    );
}

#[test]
fn the_table_accounts_for_every_host_type_exactly_once() {
    // A host type with no connector is unreachable configuration; one with two is a lookup whose
    // answer depends on order. `compose`'s exhaustive match is what stops the first at compile time,
    // and this stops the second.
    let mut hosts: Vec<String> = CONNECTORS.iter().map(|it| it.host.to_string()).collect();
    let total = hosts.len();
    hosts.sort();
    hosts.dedup();
    assert_eq!(hosts.len(), total, "a host type is registered twice");
    assert_eq!(total, 12);
}

#[test]
fn every_connector_answers_the_capability_table_the_oracle_computes() {
    // `HostClient` sets `capabilities` to `profile.adjustCapabilities(dialect.capabilitiesBase)` and
    // nothing else, so the table is DATA and is asserted as data — a wrong flag here is a UI that
    // offers an action the engine does not have, and there is no logic to catch it.
    //
    // **Podman and Docker disagree in every column below.** A table asserted against one engine is a
    // table that cannot be wrong: `machines`/`kube`/`registries` are podman's, `contexts`/`swarm` are
    // docker's, and Apple has none of them.
    let rows: Vec<_> = CONNECTORS
        .iter()
        .map(|it| {
            let capabilities =
                capabilities(it.engine, it.host).expect("a registered connector composes");
            (
                it.host.to_string(),
                capabilities.resources.pods,
                capabilities.resources.secrets,
                capabilities.extensions.machines,
                capabilities.extensions.kube,
                capabilities.extensions.contexts,
                capabilities.extensions.swarm,
                capabilities.extensions.compose,
                capabilities.extensions.registries,
                capabilities.extensions.controller_version,
            )
        })
        .collect();

    assert_eq!(
        rows,
        vec![
            //                              pods   secrets machines kube  contexts swarm compose registries ctrlVer
            (
                "podman.native".to_string(),
                true,
                true,
                true,
                true,
                false,
                false,
                true,
                true,
                false
            ),
            // The vendor machine is the ONE host that reports its CONTROLLER's version (`podman machine`).
            (
                "podman.virtualized.vendor".to_string(),
                true,
                true,
                true,
                true,
                false,
                false,
                true,
                true,
                true
            ),
            // WSL, LIMA and SSH keep every podman capability EXCEPT machine management: the machine is
            // the guest they are already inside, so `podman machine` there would address the wrong thing.
            (
                "podman.virtualized.wsl".to_string(),
                true,
                true,
                false,
                true,
                false,
                false,
                true,
                true,
                false
            ),
            (
                "podman.virtualized.lima".to_string(),
                true,
                true,
                false,
                true,
                false,
                false,
                true,
                true,
                false
            ),
            (
                "podman.remote".to_string(),
                true,
                true,
                false,
                true,
                false,
                false,
                true,
                true,
                false
            ),
            // Docker adjusts nothing on any host — all five rows are the dialect base verbatim.
            (
                "docker.native".to_string(),
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false
            ),
            (
                "docker.virtualized.vendor".to_string(),
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false
            ),
            (
                "docker.virtualized.wsl".to_string(),
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false
            ),
            (
                "docker.virtualized.lima".to_string(),
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false
            ),
            (
                "docker.remote".to_string(),
                false,
                false,
                false,
                false,
                true,
                true,
                true,
                false,
                false
            ),
            // Apple speaks the docker REST surface and has none of the extension groups.
            (
                "container.native".to_string(),
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false
            ),
            (
                "container.remote".to_string(),
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false,
                false
            ),
        ]
    );
}

#[test]
fn the_sort_table_is_the_engines_own_and_podman_carries_more_of_it() {
    // The map is per FIELD, not per resource, and podman's is docker's plus pods, secrets and
    // machines. Asserted as a difference rather than as two literals: what matters is that a podman
    // connector can sort a pod list and a docker one is never asked to.
    let podman = capabilities(ContainerEngine::Podman, ContainerEngineHost::PodmanNative)
        .expect("podman native composes");
    let docker = capabilities(ContainerEngine::Docker, ContainerEngineHost::DockerNative)
        .expect("docker native composes");

    assert_eq!(podman.sort.get("containers.name"), Some(&SortMode::Client));
    assert_eq!(docker.sort.get("containers.name"), Some(&SortMode::Client));
    assert_eq!(
        podman.sort.get("pods.name"),
        Some(&SortMode::Client),
        "podman lists pods, so a pod list is sortable"
    );
    assert_eq!(
        docker.sort.get("pods.name"),
        None,
        "docker has no pods, so the field is absent rather than declared unsortable"
    );
    assert_eq!(docker.sort.get("machines.name"), None, "and no machines");
}
