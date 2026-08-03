//! One attached client, from its handshake to its last frame.
//!
//! **Generic over the stream, and that is the whole of "no local shortcut path".** A session cannot tell
//! whether it is serving a Unix socket, a named pipe or a TCP connection: what it is handed is a
//! `WebSocketStream<S>`, so the local case and the remote one execute the same lines. The difference
//! between them was decided before this module ran — [`super::Admitted`] said whether the address was
//! allowed and [`super::auth`] said whether the token was — and once a connection is accepted there is
//! nothing left for a transport to be special about.
//!
//! **Two tasks and one queue, because the ordering matters.** The reader answers commands; the writer
//! owns the sink and is the only thing that writes. Everything a client is sent — replies, progress,
//! snapshots, stream chunks — goes through [`super::clients::Attached`]'s queue, so it arrives in one
//! order that everyone agrees on. Two writers racing for one socket would interleave a progress line
//! into the middle of a reply, and the reply would be the thing that broke.
//!
//! **A command no longer stops a read, or another connection.** `dispatch` takes `&Server`; what it
//! serialises is the mutating half of ONE connection (`server::Operating`, over a slot from
//! [`crate::slots`]), so a `connect` that spends a minute inside `spawn_service` leaves every read
//! answering — including the snapshot a client is handed the moment it attaches — and leaves every
//! other connection free to be connected, dropped or taken down. The writing and the
//! pumping never waited even before that: the queues and the stream registry are reached through `Arc`s
//! of their own, which is why [`crate::streams::ForwardedStreams::next_frame`] takes `&self` and why
//! [`crate::server::Server::streams`] hands out an `Arc`.

use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_runtime::domain::machine::ConnectListener;
use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyResult;
use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};
use cdc_runtime::domain::types::resource_sync_protocol::{ConnectProgress, ConnectionRuntimeInfo};
use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::listen::HANDSHAKE_TIMEOUT;
use crate::listen::clients::{Attached, Clients};
use crate::protocol::{Event, PROTOCOL_VERSION, Push, Reply, Request, Response};
use crate::server::{MachineBuilder, Server};
use crate::streams::ForwardedStreams;
use crate::supervise::{WatchSchedule, Watchers};

/// Everything a session needs that is not its own socket.
///
/// One value rather than six arguments, and shared by every session: the server it dispatches into, the
/// roster it fans out through, the stream registry it pumps from, the tracker that makes shutdown wait
/// for it, and the token that tells it the process is going.
pub struct Shared<F: FsLocks, B: MachineBuilder, C: Clock> {
    /// **Not behind a lock, and that is [`crate::server`]'s doing rather than an oversight.** One
    /// mutex over the whole server put every command behind the slowest one; the server holds its own
    /// now, over the half that needs it.
    pub server: Server<F, B, C>,
    pub clients: Clients,
    /// The same registry the server holds, reachable without taking anything. Taken from
    /// [`Server::streams`] at construction so the two can never be different registries.
    pub streams: Arc<ForwardedStreams>,
    pub tasks: TaskTracker,
    pub shutdown: CancellationToken,
    /// How long a peer may take to prove it speaks this protocol: from the socket being accepted to the
    /// upgrade completing, and including the TLS handshake underneath it where there is one.
    ///
    /// **The one thing here that a session does not need**, and it is here anyway for the reason
    /// [`super`]'s module doc gives about the two listeners: a parameter is something each call site can
    /// pass differently, and the local path and the remote one are exactly the pair that must not drift.
    /// One value both read cannot. [`super::HANDSHAKE_TIMEOUT`] is what [`Shared::new`] puts in it.
    pub handshake_timeout: std::time::Duration,
    /// Which connections are being watched for a drop, and the handle that stops each watch.
    pub watchers: Watchers,
    /// How long a watch waits before believing an engine is gone. Here for the same reason
    /// `handshake_timeout` is: every watcher must judge a drop the same way.
    pub watch: WatchSchedule,
}

impl<F: FsLocks, B: MachineBuilder, C: Clock> Shared<F, B, C> {
    pub fn new(server: Server<F, B, C>, shutdown: CancellationToken) -> Arc<Self> {
        Self::built(
            server,
            shutdown,
            HANDSHAKE_TIMEOUT,
            WatchSchedule::default(),
        )
    }

    /// The same, with a handshake deadline of the caller's choosing.
    ///
    /// **Ten seconds is right for a listener and cannot be waited for by a suite**, which is the whole of
    /// why this exists: both arms that fire when a peer says nothing are unreachable at the default, and
    /// an arm nothing executes is an arm nobody has thought about. The two alternatives are worse. Ten
    /// real seconds per arm is ten seconds every run pays forever; and `tokio::time::pause` auto-advances
    /// the clock whenever the runtime is idle, which against a real socket fires the test's OWN bound
    /// before the I/O it is waiting on has woken — a flake that reads as the deadline being broken.
    pub fn with_handshake_timeout(
        server: Server<F, B, C>,
        shutdown: CancellationToken,
        handshake_timeout: std::time::Duration,
    ) -> Arc<Self> {
        Self::built(
            server,
            shutdown,
            handshake_timeout,
            WatchSchedule::default(),
        )
    }

    /// The same, with a watch schedule of the caller's choosing.
    ///
    /// Its own constructor for the same reason as the deadline above: the production numbers are six
    /// seconds of pinging and a second and a half of grace, and every arm of the drop decision is
    /// unreachable in a suite that has to wait for them.
    pub fn with_watch_schedule(
        server: Server<F, B, C>,
        shutdown: CancellationToken,
        watch: WatchSchedule,
    ) -> Arc<Self> {
        Self::built(server, shutdown, HANDSHAKE_TIMEOUT, watch)
    }

    fn built(
        server: Server<F, B, C>,
        shutdown: CancellationToken,
        handshake_timeout: std::time::Duration,
        watch: WatchSchedule,
    ) -> Arc<Self> {
        let streams = Arc::clone(server.streams());
        Arc::new(Self {
            server,
            clients: Clients::default(),
            streams,
            tasks: TaskTracker::new(),
            shutdown,
            handshake_timeout,
            watchers: Watchers::default(),
            watch,
        })
    }

    /// Take every connection down — the last thing a graceful shutdown does, and what kills the tunnels.
    pub async fn stop_connections(&self) {
        let published = self.server.shutdown().await;
        for line in &published {
            tracing::info!(
                connection = %line.connection_id,
                phase = %line.phase,
                step = ?line.step,
                "connection stopped"
            );
        }
    }
}

/// Every client hears each line of an attempt as it happens, rather than the lot when it is over.
///
/// **This is the seam an attempt that lasts a minute needs.** `spawn_service` polls a socket for 51 to
/// 56 seconds against an engine that never answers, and a client told only at the end renders the state
/// from before it began for all of them — a connection that was `reconnecting` goes on showing
/// `retry in 0.9s`, which reads as stuck. Through [`Shared::publish`] rather than reaching into the
/// roster, because a watcher and a command publish the same way and two fan-out paths are how they come
/// to disagree about what a client has been told.
///
/// The state is deliberately re-read rather than taken from `info`: what a client renders is the whole
/// snapshot, and by the time this is called the projection for this connection already carries that
/// value — [`cdc_runtime::domain::active_connections::Held::connect`] writes it before it forwards.
impl<F, B, C> ConnectListener for Shared<F, B, C>
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    fn progressed(&self, progress: &ConnectProgress, _info: &ConnectionRuntimeInfo) {
        self.publish(vec![Push::new(Event::Progress {
            progress: Box::new(progress.clone()),
        })]);
    }
}

/// Serve one client until it goes away, the process shuts down, or it falls too far behind.
///
/// Returns when the socket is finished with. The client's forwarded streams are reaped on the way out —
/// `disposeForSender` — and its CONNECTIONS are deliberately left alone, which is the
/// asymmetry that makes a server worth running: a window closing must not take an engine down with it.
pub async fn serve<S, F, B, C>(
    socket: WebSocketStream<S>,
    attached: Arc<Attached>,
    shared: Arc<Shared<F, B, C>>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let client = attached.id().clone();
    tracing::info!(client = %client.0, attached = shared.clients.count(), "client attached");

    // The snapshot every attaching client is handed before it asks for anything.
    // Offered rather than published, because a new client needs the current state even when it is the
    // same state the others were last told about.
    match shared.server.snapshot() {
        Ok(snapshot) => shared.clients.hand_over(&attached, snapshot),
        // The settings document is unreadable. The client is told, in the same vocabulary a command
        // would use, rather than being left holding a session with no state and no explanation.
        Err(diagnostic) => {
            attached.offer(Response::failed(String::new(), diagnostic));
        }
    }

    let (sink, stream) = socket.split();
    let writer = shared
        .tasks
        .spawn(write_frames(sink, Arc::clone(&attached)));

    read_requests(stream, &attached, &shared).await;

    // Whatever ended the session, everything belonging to this client stops now.
    attached.cancel();
    let _ = writer.await;
    let reaped = shared.streams.disconnect(&client);
    shared.clients.detach(&client);
    tracing::info!(
        client = %client.0,
        reaped,
        attached = shared.clients.count(),
        "client detached"
    );
}

/// Read frames and answer them, until the client stops or is cancelled.
async fn read_requests<S, F, B, C>(
    mut stream: futures_util::stream::SplitStream<WebSocketStream<S>>,
    attached: &Arc<Attached>,
    shared: &Arc<Shared<F, B, C>>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let cancelled = attached.cancelled();
    loop {
        let message = tokio::select! {
            message = stream.next() => message,
            _ = cancelled.cancelled() => return,
        };
        let Some(message) = message else {
            return;
        };
        match message {
            // The only frame this protocol carries. A binary frame is a client speaking something
            // else, and it is refused the same way malformed text is rather than closing the session.
            Ok(Message::Text(text)) => answer(&text, attached, shared).await,
            Ok(Message::Close(_)) => return,
            // Ping and pong are tungstenite's own business: it queues the reply and the writer flushes
            // it. Nothing here needs to know they happened.
            Ok(_) => {}
            // A framing error, a reset, or a peer that vanished. Not distinguishable in a way that
            // changes what happens: the client is gone.
            Err(error) => {
                tracing::debug!(client = %attached.id().0, %error, "client connection ended");
                return;
            }
        }
    }
}

/// Answer one frame, publish what it changed, and pump anything it opened.
async fn answer<F, B, C>(text: &str, attached: &Arc<Attached>, shared: &Arc<Shared<F, B, C>>)
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let request = match parse(text) {
        Ok(request) => request,
        Err(refusal) => {
            attached.offer(refusal);
            return;
        }
    };

    let (response, pushes) = shared
        .server
        .dispatch(attached.id(), request, shared.as_ref())
        .await;

    // Progress is a LOG and goes to everyone, then the state those lines were narrating, once, and
    // only if it moved. Through `Shared::publish` rather than inline, because a watcher publishes a
    // drop the same way and nobody issued a command for that one — two fan-out paths are how the two
    // come to disagree about what a client has been told.
    shared.publish(pushes);

    // A command is the only thing that can bring a connection up or take one down from outside, so it
    // is the only thing that can change which connections need watching (`supervise`).
    shared.reconcile().await;

    // The handle has to be in the client's hands before the first chunk is, so the response is queued
    // before the pump is started. One queue is what makes that ordering a fact rather than a race.
    let opened = opened_stream(&response);
    attached.offer(response);
    if let Some(stream_id) = opened {
        pump(stream_id, attached, shared);
    }
}

/// A frame this server will not act on, as the answer the client gets.
///
/// **The correlation id is recovered when it can be**, which is what lets one bad call fail instead of
/// the session: a client that sent an unknown command still learns that THAT call was refused. A frame
/// with no readable id at all is answered with an empty one — there is nothing else honest to echo.
fn parse(text: &str) -> Result<Request, Response> {
    let refuse = |id: String, field: &str, extra: serde_json::Value| {
        let mut params = serde_json::json!({ "field": field });
        if let (Some(params), Some(extra)) = (params.as_object_mut(), extra.as_object()) {
            params.extend(extra.clone());
        }
        Response::failed(
            id,
            ReportedDiagnostic {
                code: DiagnosticCode::RequestInvalid,
                params: params.as_object().cloned().unwrap_or_default(),
                severity: DiagnosticSeverity::Err,
            },
        )
    };
    let loose: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| refuse(String::new(), "frame", serde_json::json!({})))?;
    let id = loose
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    // The version FIRST: a client speaking a protocol this server does not know may have sent a shape
    // that happens to parse, and answering it would be worse than refusing it.
    let version = loose.get("version").and_then(serde_json::Value::as_u64);
    if version != Some(u64::from(PROTOCOL_VERSION)) {
        return Err(refuse(
            id,
            "version",
            serde_json::json!({ "expected": PROTOCOL_VERSION }),
        ));
    }
    serde_json::from_value(loose).map_err(|_| refuse(id, "command", serde_json::json!({})))
}

/// The stream a forwarded request opened, if it opened one.
fn opened_stream(response: &Response) -> Option<String> {
    let crate::protocol::Outcome::Ok {
        reply: Reply::Proxied { result },
    } = &response.outcome
    else {
        return None;
    };
    match result.as_ref() {
        CommandProxyResult::Stream(handle) => Some(handle.stream_id.clone()),
        CommandProxyResult::Buffered(_) => None,
    }
}

/// One task per open stream, which is what the original's `emitter.on("data", …)` chain is.
///
/// It holds the registry through an `Arc` and never the server's lock, so a log that has nothing to say
/// costs nothing and a log that has plenty keeps arriving while other commands run. It ends when the
/// stream ends, when the client goes, or when the process does — and a terminal frame is delivered
/// before it stops, because `end` and `error` are what tell a client to stop waiting.
fn pump<F, B, C>(stream_id: String, attached: &Arc<Attached>, shared: &Arc<Shared<F, B, C>>)
where
    F: FsLocks + Send + 'static,
    B: MachineBuilder + 'static,
    C: Clock + 'static,
{
    let attached = Arc::clone(attached);
    let streams = Arc::clone(&shared.streams);
    let cancelled = attached.cancelled();
    shared.tasks.spawn(async move {
        loop {
            let frame = tokio::select! {
                frame = streams.next_frame(&stream_id) => frame,
                _ = cancelled.cancelled() => return,
            };
            let Some(frame) = frame else {
                return;
            };
            attached.offer(frame);
        }
    });
}

/// The only thing that writes to this client's socket.
async fn write_frames<S>(
    mut sink: futures_util::stream::SplitSink<WebSocketStream<S>, Message>,
    attached: Arc<Attached>,
) where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    while let Some(frames) = attached.next_batch().await {
        for frame in frames {
            let text = match serde_json::to_string(&frame) {
                Ok(text) => text,
                // Impossible by construction — every frame is protocol types over `Connection`,
                // `AppRuntimeSnapshot` and `serde_json::Value`, none of which can fail to serialize —
                // and named rather than swallowed, because a silently skipped reply would look like a
                // hung server.
                Err(error) => {
                    tracing::error!(client = %attached.id().0, %error, "a frame would not serialize");
                    continue;
                }
            };
            if sink.send(Message::text(text)).await.is_err() {
                // The peer is gone. Nothing left to say, and the reader will reach the same conclusion.
                attached.cancel();
                return;
            }
        }
    }
    // A close frame is a courtesy the local socket does not need and a WebSocket peer does: it is the
    // difference between "the server is finished with you" and a connection that simply stopped.
    let _ = sink
        .send(Message::Close(Some(CloseFrame {
            code: CloseCode::Away,
            reason: "server is closing this session".into(),
        })))
        .await;
    let _ = sink.close().await;
}
