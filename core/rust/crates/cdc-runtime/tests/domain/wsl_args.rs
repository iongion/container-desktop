//! `wsl-args.ts` — the argv that reaches an engine inside a WSL distribution.
//!
//! The whole argv is asserted every time, never its tail: this is the one command that stands between
//! a Windows client and an engine it cannot otherwise dial, and a flag in the wrong position is a
//! command that runs and talks to the wrong socket.

use cdc_runtime::domain::types::engine::ContainerEngine;
use cdc_runtime::domain::wsl_args::{WslDialStdio, dial_stdio_args};

/// The original's first case, argv for argv (`tests/wsl-args.test.ts`).
///
/// `--url` is podman's global flag for the socket to talk to, so a rootless socket under
/// `/run/user/<uid>` resolves instead of the distribution's default.
#[test]
fn podman_targets_the_in_distro_socket_with_url() {
    assert_eq!(
        dial_stdio_args(&WslDialStdio {
            distribution: "Ubuntu-24.04",
            program: "podman",
            engine: ContainerEngine::Podman,
            socket_path: "/run/user/1000/podman/podman.sock",
        }),
        vec![
            "--distribution",
            "Ubuntu-24.04",
            "--exec",
            "podman",
            "--url",
            "unix:///run/user/1000/podman/podman.sock",
            "system",
            "dial-stdio",
        ]
    );
}

/// The original's second case. Docker spells the same thing `-H`, and getting this wrong is silent:
/// `docker --url …` is not a flag docker has, so the process would fail rather than mis-target — but
/// `podman -H …` IS accepted and means something else.
#[test]
fn docker_targets_the_in_distro_socket_with_dash_h() {
    assert_eq!(
        dial_stdio_args(&WslDialStdio {
            distribution: "Ubuntu",
            program: "docker",
            engine: ContainerEngine::Docker,
            socket_path: "/var/run/docker.sock",
        }),
        vec![
            "--distribution",
            "Ubuntu",
            "--exec",
            "docker",
            "-H",
            "unix:///var/run/docker.sock",
            "system",
            "dial-stdio",
        ]
    );
}

/// Apple takes podman's spelling, which is what the original's ternary does — it tests for DOCKER and
/// everything else falls through to `--url`.
///
/// Asserted rather than left to the match: Apple's `container` is macOS-only and can never appear in a
/// distribution, so nothing else in this tree would notice if the arm changed.
#[test]
fn apple_takes_the_non_docker_spelling() {
    assert_eq!(
        dial_stdio_args(&WslDialStdio {
            distribution: "Ubuntu",
            program: "container",
            engine: ContainerEngine::Apple,
            socket_path: "/var/run/container.sock",
        })[4],
        "--url"
    );
}

/// The socket arrives BARE and this function is what adds the scheme — asserted because the split of
/// responsibility is the whole contract, and both halves are elsewhere.
///
/// Every caller in the original strips it first (`\`${remoteAddress}\`.replace("unix://", "")` in the
/// Tauri and Wails bridges, `unixSocketPath` in `wsl-relay.ts`), so there is deliberately NO guard
/// against a doubled scheme here: a guard would be behaviour with no producer, and this port has just
/// finished withdrawing three diagnostic codes for exactly that. The Rust caller normalises the same
/// way — `start_api` puts `relay` through `normalize_unix_socket_path` — so if `unix://unix://` ever
/// appears, the defect is upstream and belongs fixed there rather than absorbed here.
#[test]
fn the_scheme_is_this_functions_to_add() {
    let argv = dial_stdio_args(&WslDialStdio {
        distribution: "Ubuntu",
        program: "podman",
        engine: ContainerEngine::Podman,
        socket_path: "/run/podman.sock",
    });
    assert_eq!(argv[5], "unix:///run/podman.sock");
}
