//! `runtimes/dialects/` — engine commands and endpoints, one per ENGINE.

pub mod container;
pub mod docker;
// The targets a Docker CLI can be pointed at on one machine, and the flag that pins a connection to
// one of them. Beside the dialect rather than inside it: the parse is pure, and the
// dialect is where the command is RUN.
pub mod docker_contexts;
pub mod podman;

// The podman-MACHINE dialects, which are not connector-level units: they appear nowhere in the
// connector table, because every Podman connector uses the podman dialect. They are the strategies a
// transport chooses BETWEEN — the rootless-connection rule, the native Windows pipe, and the nested
// SSH hop a remote machine is reached by. The third one's consumer is `SshTransport::resolve_dial_stdio`.
pub mod podman_machine_connections;
pub mod podman_machine_pipe;
pub mod podman_machine_ssh;

// The socket-path rule every dialect goes through.
pub mod shared;
