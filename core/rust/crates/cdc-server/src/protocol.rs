//! The wire vocabulary.
//!
//! **Hand-written, like the domain types.** An earlier design generated these from a schema; the
//! generator was withdrawn with it, so the domain model is hand-written and this is too.
//!
//! What the in-process IPC version did not need and this does: **an envelope**. IPC had a channel per
//! message, so the channel name was the type tag and a reply arrived on its own channel. A socket has
//! one byte stream in each direction, so every frame carries its own type tag, a request id to
//! correlate a reply with its request, and a protocol version.
//!
//! **The version is carried from the very first release, deliberately.** Retrofitting a version tag
//! onto clients already deployed is far worse than paying four bytes for one now.

use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResult, CommandProxyStreamEvent,
};
use cdc_runtime::domain::types::connection::Connection;
use cdc_runtime::domain::types::diagnostic::ReportedDiagnostic;
use cdc_runtime::domain::types::engine::EngineContext;
use cdc_runtime::domain::types::resource_sync_protocol::{
    AppRuntimeSnapshot, ConnectOrigin, ConnectProgress,
};
use serde::{Deserialize, Serialize};

/// The version every frame carries. Bump it when a shape changes incompatibly, never for an addition
/// — a client that does not know a new command simply never sends it.
pub const PROTOCOL_VERSION: u32 = 1;

/// One frame from a client.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub version: u32,
    /// Chosen by the CLIENT and echoed back untouched. The server never interprets it, which is what
    /// lets a client use whatever it already has to correlate with — a sequence number, a uuid, the
    /// span id it is tracing under.
    pub id: String,
    #[serde(flatten)]
    pub command: Command,
}

impl Request {
    /// A frame at the current version.
    pub fn new(id: impl Into<String>, command: Command) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id: id.into(),
            command,
        }
    }
}

/// What a client may ask for.
///
/// **A connection is addressed as `connection_id`, never as `id`, and that is load-bearing rather
/// than a style choice.** The command is flattened into [`Request`], which already carries the
/// CLIENT's correlation `id` — so a variant with a field called `id` puts two different identities
/// on one key, and whichever is written second wins. The oracle names it the same way for the same
/// reason (`ResourceConnectProgress.connectionId`). A test pins every tag and every round-trip,
/// because this failed silently in exactly one direction: it SERIALIZED fine and would not parse.
///
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum Command {
    /// Every connection the settings document holds, running or not.
    ListConnections,
    /// `Application.createConnection`. The connection is carried whole rather than as fields,
    /// because the document persists exactly six of them and the core is not the thing that picks.
    CreateConnection {
        connection: Box<Connection>,
    },
    /// `Application.updateConnection` — a PARTIAL, deep-merged over the stored entry. Free-form JSON
    /// on purpose: a typed struct here would make every absent field indistinguishable from a field
    /// the client meant to blank, which is the merge semantics the oracle relies on.
    UpdateConnection {
        connection_id: String,
        partial: serde_json::Value,
    },
    RemoveConnection {
        connection_id: String,
    },
    /// Bring a connection up. `origin` is the client's, because only the client knows whether a user
    /// asked for this or a bootstrap did, and the renderer routes failures to a toast or a log by it.
    Connect {
        connection_id: String,
        origin: ConnectOrigin,
    },
    /// Take a connection down and suppress its reconnect. Never implied by a client going away — see
    /// [`Event`].
    Disconnect {
        connection_id: String,
    },
    GetRuntimeSnapshot,
    /// Forward one engine request through the connection the payload names.
    ///
    /// The routing key is `payload.connection.id`, which is what the original routes by
    /// (`commandProxyBroker.ts`) and why the whole connection rides along there. A payload naming none
    /// is REFUSED rather than sent to a default: the original falls back to its primary connection and
    /// this core deliberately has none.
    ProxyRequest {
        payload: Box<CommandProxyRequestPayload>,
    },
    /// The named endpoints this connection's engine offers — `docker context ls`.
    ///
    /// Addressed by connection because the answer depends on the whole connector: which CLI, on which
    /// machine, inside which scope. It does NOT connect and takes no slot — a person picks a context
    /// before the connection works, and a discovery queued behind a retry would arrive a minute late.
    ListEngineContexts {
        connection_id: String,
    },
    /// Tear a forwarded stream down — `COMMAND_PROXY.streamDestroy`.
    ///
    /// `stream_id`, not the original's `streamId`, for the same reason `connection_id` is spelled that
    /// way: the envelope is this port's own and it is snake_case throughout. What travels INSIDE it —
    /// [`CommandProxyStreamEvent`] and its `streamId` — is the original's shape verbatim, because a
    /// client written against the TypeScript reads those bytes.
    DestroyStream {
        stream_id: String,
    },
}

/// One frame answering a [`Request`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Response {
    pub version: u32,
    /// The id of the request this answers, echoed verbatim.
    pub id: String,
    #[serde(flatten)]
    pub outcome: Outcome,
}

impl Response {
    pub fn ok(id: impl Into<String>, reply: Reply) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id: id.into(),
            outcome: Outcome::Ok { reply },
        }
    }

    /// A refusal. **A code and its parameters, never prose**: the server does not know
    /// what language its client renders in, and it certainly does not know a client's wording.
    pub fn failed(id: impl Into<String>, diagnostic: ReportedDiagnostic) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            id: id.into(),
            outcome: Outcome::Err {
                diagnostic: Box::new(diagnostic),
            },
        }
    }
}

/// Whether the command was carried out, and what it produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum Outcome {
    Ok {
        #[serde(flatten)]
        reply: Reply,
    },
    Err {
        diagnostic: Box<ReportedDiagnostic>,
    },
}

/// What a successful command produced.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "reply", rename_all = "snake_case")]
pub enum Reply {
    /// The answer to `list_connections`, and to the three commands that mutate the document — each
    /// returns the list it produced, so a client never has to ask again to find out what it did.
    Connections { connections: Vec<Connection> },
    /// The answer to `get_runtime_snapshot`, and to `connect` / `disconnect`.
    Snapshot { snapshot: Box<AppRuntimeSnapshot> },
    /// What a forwarded request produced: a whole response, or the handle a stream's chunks arrive
    /// under. Untagged between the two exactly as the original is, discriminated by the `stream`
    /// literal both shapes carry.
    Proxied { result: Box<CommandProxyResult> },
    /// The answer to `list_engine_contexts`. EMPTY is a real answer — an engine with no notion of a
    /// context, and a docker whose store could not be read, both give it.
    ///
    /// **It names the connection it answers about, and carries that connection's PIN beside the
    /// list.** Both because a client's cursor is free to move while this is in flight, and because
    /// the two facts are read together — which of these endpoints this connection resolves against
    /// is the whole question. Sending them separately would be two things able to disagree.
    EngineContexts {
        connection_id: String,
        pinned: Option<String>,
        contexts: Vec<EngineContext>,
    },
    /// A forwarded stream is gone. Answered whether or not one was there: a client tearing down a
    /// stream the server already ended is describing the state it wants, not making a claim.
    Destroyed,
}

/// A frame the server sends without being asked.
///
/// **Two kinds, and they are treated differently under backpressure**: a snapshot
/// is whole-state, so a slow client may miss intermediate ones and lose nothing — only the latest
/// matters. Progress is a LOG, and a gap in a connect trace is a bug report nobody can answer, so it
/// is never dropped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Push {
    pub version: u32,
    #[serde(flatten)]
    pub event: Event,
}

impl Push {
    pub fn new(event: Event) -> Self {
        Self {
            version: PROTOCOL_VERSION,
            event,
        }
    }

    /// Whether this frame may be dropped to let a slow client catch up.
    ///
    /// The rule lives on the type rather than in the queue, so a queue cannot be written that
    /// forgets it — and so the next transport gets it for free.
    ///
    /// **Only a snapshot, and [`Event::Stream`] must never be added to it.** A stream chunk is part of
    /// a body the client is reassembling, so a dropped one is corruption rather than a stale view —
    /// the opposite of what makes a snapshot safe to lose.
    pub fn is_droppable(&self) -> bool {
        matches!(self.event, Event::Snapshot { .. })
    }
}

/// One frame the server WRITES, of whichever kind.
///
/// A client has one byte stream in each direction, so a reply and an unsolicited push travel the same
/// way and have to be ORDERED against each other: a progress line delivered after the response it
/// belongs to reads as a line from the next command, and two writers racing for one socket is the
/// "second path" the design forbids. One queue per client, holding this, is what makes the order
/// total.
///
/// **`untagged`, and the arms are distinguishable by a key each one requires** — a [`Response`] has
/// `outcome`, a [`Push`] has `event`. That is what makes writing this byte-identical to writing either
/// one directly, which is the property a client depends on: nothing about this type reaches the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Outbound {
    Answer(Response),
    Pushed(Push),
}

impl Outbound {
    /// Whether this frame may be dropped to let a slow client catch up.
    ///
    /// **A response never may.** A client waiting on a correlation id cannot tell a dropped reply from
    /// a server that has not finished, and it cannot ask again for what it has already asked — where a
    /// dropped snapshot costs nothing, because the next one is whole.
    pub fn is_droppable(&self) -> bool {
        match self {
            Self::Answer(_) => false,
            Self::Pushed(push) => push.is_droppable(),
        }
    }
}

impl From<Response> for Outbound {
    fn from(response: Response) -> Self {
        Self::Answer(response)
    }
}

impl From<Push> for Outbound {
    fn from(push: Push) -> Self {
        Self::Pushed(push)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    /// Whole-state, matching the app's existing coarse-but-correct choice. Deltas are a later
    /// optimisation to be made from profiling rather than from assumption.
    Snapshot { snapshot: Box<AppRuntimeSnapshot> },
    /// One connect-progress line, as a connection comes up or retries after a drop.
    Progress { progress: Box<ConnectProgress> },
    /// One frame of a forwarded stream, keyed by the handle the request answered with.
    ///
    /// The payload is the original's shape verbatim — `data` / `end` / `error` under a `streamId` —
    /// because clients already speak it retains it rather than reinventing it.
    ///
    /// **The field is `stream` and not `event`, and that is the flatten trap again.** This enum is
    /// tagged `event`, so a variant field of that name writes the tag and the payload to one key: it
    /// serializes cleanly and will not parse back, which is exactly how `Command`'s `id` failed. Named
    /// after its variant, like `Snapshot { snapshot }` and `Progress { progress }`.
    Stream {
        stream: Box<CommandProxyStreamEvent>,
    },
}
