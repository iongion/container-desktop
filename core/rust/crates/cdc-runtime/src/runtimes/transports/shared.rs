//! `runtimes/transports/shared.ts` — what more than one transport needs.
//!
//! The original's `createPlainApiDriver` is the `Http` capability's and arrives. What
//! is shared TODAY is the three settings reads every scoped transport starts from, each of which the
//! original spells inline at a dozen call sites — and inline is where the twelve copies disagree.

use crate::capabilities::command::ReadinessCheck;
use crate::capabilities::http::Endpoint;
use crate::domain::machine::proxy::api_headers;
use crate::domain::ssh::forward::{windows_named_pipe_path, windows_pipe_name};
use crate::domain::types::connection::EngineConnectorSettings;
use crate::domain::types::machine::ControllerScope;
use crate::runtimes::composition::HostContext;

/// The controller binary that enters the scope — `controller?.path || controller?.name`, and then the
/// name the CONNECTOR registered (`wsl`, `limactl`, `podman`).
///
/// The third step is the podman-machine transport's `controllerPath || host.CONTROLLER` and it is
/// applied to every scoped transport, where the original leaves two of them falling through to `""`.
/// An empty launcher fails to spawn with `ENOENT ''`, which reaches a caller as a message about
/// nothing; the registered name is a real thing to try, for exactly the reason
/// [`program_launcher`] gives about an undetected engine — it may be on the PATH.
pub fn controller_launcher<'a>(
    settings: &'a EngineConnectorSettings,
    controller: &'a str,
) -> &'a str {
    let configured = settings.controller.as_ref();
    let path = configured.map(|it| it.path.trim()).unwrap_or_default();
    if !path.is_empty() {
        return path;
    }
    let name = configured.map(|it| it.name.trim()).unwrap_or_default();
    if !name.is_empty() {
        return name;
    }
    controller
}

/// What `settings.controller.scope` says, which is a NAME and may be nothing.
///
/// A name, never a scope: resolving one to the other needs the list of scopes the host offers, which
/// is [`crate::domain::machine::ConnectionMachine`]'s. A transport reads this only where the original
/// does — for an address KEYED by the scope, never to decide whether it has one.
pub fn named_scope(settings: &EngineConnectorSettings) -> &str {
    settings
        .controller
        .as_ref()
        .and_then(|controller| controller.scope.as_deref())
        .unwrap_or_default()
}

/// What a scope calls itself — `scope.Name`, which every kind carries.
///
/// Next to [`named_scope`] because they are the two halves of one question: that one reads the name
/// the SETTINGS carry, this one the name a SCOPE answers, and matching them is how a scope is
/// selected. Selecting one therefore needs no knowledge of which kind it is.
pub fn scope_name(scope: &ControllerScope) -> &str {
    match scope {
        ControllerScope::PodmanMachine(it) => &it.name,
        ControllerScope::WslDistribution(it) => &it.name,
        ControllerScope::LimaInstance(it) => &it.name,
        ControllerScope::SshHost(it) => &it.name,
    }
}

/// Whether anything can be asked of this scope — `scope.Usable`.
///
/// Absent means NO, exactly as the original's truthiness test reads it: `Usable` is filled in by
/// whoever listed the scope, so a scope that arrived without one was never assessed, and treating
/// "not assessed" as usable is how a probe ends up run against a stopped VM.
pub fn scope_usable(scope: &ControllerScope) -> bool {
    match scope {
        ControllerScope::PodmanMachine(it) => it.usable,
        ControllerScope::WslDistribution(it) => it.usable == Some(true),
        ControllerScope::LimaInstance(it) => it.usable == Some(true),
        ControllerScope::SshHost(it) => it.usable == Some(true),
    }
}

/// The engine binary — `program.path || program.name`.
///
/// During detection the path is a CANDIDATE, so this reads the settings it is handed and never the
/// context's: an undetected program is still probed BY NAME, because it may be on the PATH of
/// whatever will run the command.
pub fn program_launcher(settings: &EngineConnectorSettings) -> &str {
    settings
        .program
        .path
        .as_deref()
        .filter(|path| !path.is_empty())
        .unwrap_or(&settings.program.name)
}

/// Which LOCAL transport the resolved address is — the only two this core will open.
///
/// **Asked of the ADDRESS, never of the operating system**, which is the rule
/// [`is_named_pipe`](crate::domain::ssh::forward::is_named_pipe) already states for the other half of
/// the same question: what makes something a pipe is its spelling, and a settings file may carry one
/// anywhere. Branching on the OS got this wrong twice over — it called a Windows address that is NOT a
/// pipe one anyway, and it passed the address through verbatim, so a `DOCKER_HOST` of
/// `npipe:////./pipe/custom` (which `normalize_unix_socket_path` keeps whole, on purpose) produced
/// `NamedPipe("npipe:////./pipe/custom")`. No `CreateFileW` accepts that; a pipe must be named
/// `\\.\pipe\NAME`, which is what `windows_named_pipe_path` spells.
///
/// There is deliberately no third case: `Endpoint::Tcp` exists on the capability and **nothing here
/// produces one**, because a readiness probe that could turn a settings string into a network address
/// would be new outbound reach that no caller asked for. An address that is neither of these is refused
/// by `machine::proxy::endpoint` before a request is built.
pub fn api_endpoint(socket: &str) -> Endpoint {
    if let Some(name) = windows_pipe_name(socket) {
        return Endpoint::NamedPipe(windows_named_pipe_path(name));
    }
    Endpoint::UnixSocket(socket.to_string())
}

/// The readiness question every spawned API service is polled with — `isApiRunning`.
///
/// One helper rather than four literals, because it is one rule: the engine ANSWERS over the address
/// this service just opened, asked with the headers a forwarded request will carry. A transport that
/// spelled it out for itself would be free to ask a different question than the traffic that follows.
pub fn api_answers(
    address: &str,
    settings: &EngineConnectorSettings,
    host: &dyn HostContext,
) -> ReadinessCheck {
    ReadinessCheck::ApiAnswers {
        endpoint: api_endpoint(address),
        headers: api_headers(&settings.api, host.app_version()),
    }
}
