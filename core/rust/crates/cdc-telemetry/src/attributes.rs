//! The span and attribute vocabulary.
//!
//! Centralised as constants rather than string literals at each call site, deliberately: the
//! taxonomy is being defined before the connection state machine that would naturally shape it
//!, so it *will* need revision at. Keeping it in one module makes that a single
//! edit rather than a hunt through the runtime.
//!
//! Span names and attribute keys are part of the specification, not an implementation detail — Go
//! must emit the same ones or traces from the two implementations cannot be compared.

/// Span names. One per unit of work an operator would ask "how long did that take, and did it fail?"
pub mod span {
    /// Root span for bringing a connection up. Everything else nests under it.
    pub const CONNECT: &str = "cdc.connection.connect";
    pub const DISCONNECT: &str = "cdc.connection.disconnect";

    /// The invariant bring-up ordering: scope -> detect -> api -> availability.
    pub const SCOPE_START: &str = "cdc.scope.start";
    pub const SCOPE_STOP: &str = "cdc.scope.stop";
    pub const DETECT_PROGRAM_PATH: &str = "cdc.detect.program_path";
    pub const DETECT_PROGRAM_VERSION: &str = "cdc.detect.program_version";
    pub const DETECT_ENGINE_SOCKET: &str = "cdc.detect.engine_socket";
    pub const API_START: &str = "cdc.api.start";
    pub const API_STOP: &str = "cdc.api.stop";
    pub const AVAILABILITY_CHECK: &str = "cdc.availability.check";

    /// Leaf work performed through the capabilities.
    pub const EXEC: &str = "cdc.exec";
    pub const HTTP_REQUEST: &str = "cdc.http.request";
    pub const SSH_TUNNEL: &str = "cdc.ssh.tunnel";
    pub const SSH_DIAL_STDIO: &str = "cdc.ssh.dial_stdio";

    pub const RECONNECT_ATTEMPT: &str = "cdc.reconnect.attempt";

    /// Every span name, for the exhaustiveness test.
    pub const ALL: &[&str] = &[
        CONNECT,
        DISCONNECT,
        SCOPE_START,
        SCOPE_STOP,
        DETECT_PROGRAM_PATH,
        DETECT_PROGRAM_VERSION,
        DETECT_ENGINE_SOCKET,
        API_START,
        API_STOP,
        AVAILABILITY_CHECK,
        EXEC,
        HTTP_REQUEST,
        SSH_TUNNEL,
        SSH_DIAL_STDIO,
        RECONNECT_ATTEMPT,
    ];
}

/// Attribute keys.
///
/// Being listed here does NOT make an attribute exportable — `crate::privacy` decides that, and its
/// allowlist is deliberately narrower than this list. Keys naming values that must never leave the
/// machine are still defined here so the runtime has one name for them and the allowlist has
/// something explicit to exclude.
pub mod attr {
    /// Opaque generated id (`host.<uuid>.<host>`). Exportable.
    pub const CONNECTION_ID: &str = "cdc.connection.id";
    /// Closed vocabulary: podman | docker | container. Exportable.
    pub const ENGINE: &str = "cdc.connection.engine";
    /// Closed vocabulary: the ContainerEngineHost values. Exportable.
    pub const HOST: &str = "cdc.connection.host";
    /// Closed vocabulary: idle | starting | ready | failed | reconnecting. Exportable.
    pub const PHASE: &str = "cdc.connection.phase";
    /// Closed vocabulary: native | ssh | wsl | lima | vm. Exportable.
    pub const TRANSPORT: &str = "cdc.transport";
    /// Closed vocabulary: docker | libpod. Exportable.
    pub const API_SURFACE: &str = "cdc.api.surface";
    /// Closed vocabulary: started | stopped | running | error. Exportable.
    pub const STARTUP_STATUS: &str = "cdc.startup.status";
    /// A SCREAMING_SNAKE diagnostic code. Exportable.
    pub const DIAGNOSTIC_CODE: &str = "cdc.diagnostic.code";

    /// Program BASENAME only — never the full path. Exportable.
    pub const EXEC_PROGRAM: &str = "cdc.exec.program";
    pub const EXEC_EXIT_CODE: &str = "cdc.exec.exit_code";
    pub const EXEC_DURATION_MS: &str = "cdc.exec.duration_ms";
    pub const ATTEMPT: &str = "cdc.attempt";
    pub const MAX_RETRIES: &str = "cdc.max_retries";
    pub const HTTP_STATUS: &str = "cdc.http.status";

    /// Every exportable key, for the allowlist and its exhaustiveness test.
    pub const EXPORTABLE: &[&str] = &[
        CONNECTION_ID,
        ENGINE,
        HOST,
        PHASE,
        TRANSPORT,
        API_SURFACE,
        STARTUP_STATUS,
        DIAGNOSTIC_CODE,
        EXEC_PROGRAM,
        EXEC_EXIT_CODE,
        EXEC_DURATION_MS,
        ATTEMPT,
        MAX_RETRIES,
        HTTP_STATUS,
    ];

    /// Named so the runtime has one spelling for each, and so the allowlist excludes them by name
    /// rather than by accident. NONE are exportable — each leaks a username (absolute paths and
    /// socket URIs run through the home directory or uid), a hostname (SSH host, scope aliases), or
    /// a credential (argv, stdin, proxy URLs).
    pub mod sensitive {
        pub const EXEC_PROGRAM_PATH: &str = "cdc.exec.program_path";
        pub const EXEC_ARGV: &str = "cdc.exec.argv";
        pub const EXEC_STDIN: &str = "cdc.exec.stdin";
        pub const EXEC_STDOUT: &str = "cdc.exec.stdout";
        pub const EXEC_STDERR: &str = "cdc.exec.stderr";
        pub const CONNECTION_URI: &str = "cdc.connection.uri";
        pub const CONNECTION_RELAY: &str = "cdc.connection.relay";
        pub const SCOPE_NAME: &str = "cdc.scope.name";
        pub const SSH_HOST: &str = "cdc.ssh.host";
        pub const SSH_USER: &str = "cdc.ssh.user";
        pub const SSH_IDENTITY_FILE: &str = "cdc.ssh.identity_file";
        pub const PROXY_URL: &str = "cdc.proxy.url";
        pub const REGISTRY: &str = "cdc.registry";

        pub const ALL: &[&str] = &[
            EXEC_PROGRAM_PATH,
            EXEC_ARGV,
            EXEC_STDIN,
            EXEC_STDOUT,
            EXEC_STDERR,
            CONNECTION_URI,
            CONNECTION_RELAY,
            SCOPE_NAME,
            SSH_HOST,
            SSH_USER,
            SSH_IDENTITY_FILE,
            PROXY_URL,
            REGISTRY,
        ];
    }
}

/// Reduce a program path to its basename, so `/home/istoica/bin/podman` exports as `podman`.
///
/// An absolute path is the most common accidental username leak in this subsystem: every detected
/// engine path on Linux and macOS runs through a home directory.
pub fn program_basename(path: &str) -> &str {
    path.rsplit(['/', '\\'])
        .find(|segment| !segment.is_empty())
        .unwrap_or(path)
}
