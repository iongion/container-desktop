//! `wsl-args.ts` — the argv that runs an engine's OWN `system dial-stdio` inside a WSL distribution.
//!
//! **This is the whole of how a native Windows client reaches an engine living in WSL.** The socket the
//! engine binds is the distribution's, on a filesystem no Windows process can open and at a path no
//! `CreateFileW` accepts; there is no forward to make either of those false, because `ssh -NL` is not in
//! play and a distribution is not a host. What IS available is that the engine can be told to bridge its
//! own socket to a pipe pair — `dial-stdio` — and `wsl.exe --exec` is what starts a process in there.
//! So the address is not a path at all: it is a COMMAND, and the bytes travel over its stdin and stdout.
//!
//! Nothing is copied into the distribution. The `podman` or `docker` that already lives in there is what
//! runs, which is why the program name is a parameter and not a constant.
//!
//! **Pure, and here rather than in the transport, for the reason `ssh/args.rs` is**: the argv IS the
//! observable behaviour. A flag in the wrong place produces a command that runs and talks to the wrong
//! socket, and that is a thing to assert in a test rather than to discover against a live distribution.
//! It is also shared — the original keeps it node-free precisely so both the JS relay and the
//! Tauri/Wails webview bindings build the same argv from one source, and this port has the same two
//! consumers in [`crate::runtimes::transports::wsl`] and the relay.

use crate::domain::types::engine::ContainerEngine;

/// What the command needs to know. Grouped for [`crate::runtimes::composition::ResolvedApi`]'s reason:
/// `distribution` and `program` are both bare strings, and a caller that swapped them would build a
/// command that runs the distribution's name as a program inside a distribution named after the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WslDialStdio<'a> {
    /// The distribution to enter — `settings.controller.scope`.
    pub distribution: &'a str,
    /// The engine binary as it is named INSIDE the distribution, not on this machine.
    pub program: &'a str,
    /// Which spelling of the socket flag this engine takes.
    pub engine: ContainerEngine,
    /// The engine's socket inside the guest, bare: the scheme is this module's to add.
    pub socket_path: &'a str,
}

/// `buildWSLDialStdioArgs` — argv for argv.
///
/// The socket is passed explicitly rather than left to the engine's default, so a rootless podman under
/// `/run/user/<uid>` or a custom `DOCKER_HOST` resolves instead of whatever the distribution would pick.
pub fn dial_stdio_args(options: &WslDialStdio<'_>) -> Vec<String> {
    let url = format!("unix://{}", options.socket_path);
    vec![
        "--distribution".to_string(),
        options.distribution.to_string(),
        "--exec".to_string(),
        options.program.to_string(),
        socket_flag(options.engine).to_string(),
        url,
        "system".to_string(),
        "dial-stdio".to_string(),
    ]
}

/// Which global flag names the socket to talk to.
///
/// The original spells this as a ternary on DOCKER, so everything that is not Docker takes podman's
/// `--url` — Apple included, which is unreachable in a distribution but is still what the rule says.
/// Written as an exhaustive match so a fourth engine cannot be added without answering the question.
fn socket_flag(engine: ContainerEngine) -> &'static str {
    match engine {
        ContainerEngine::Docker => "-H",
        ContainerEngine::Podman | ContainerEngine::Apple => "--url",
    }
}
