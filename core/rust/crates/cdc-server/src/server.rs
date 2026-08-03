//! What the server IS: the connections it owns, and the commands it answers.
//!
//! **The server owns connection state; clients are observers that also issue commands.** A client
//! going away never tears a connection down — that is the entire point of running one — so nothing
//! here is keyed by, or reachable from, a client. `disconnect` is a COMMAND and the only way down.
//!
//! It knows no host. Building a [`ConnectionMachine`] means choosing a platform's capabilities, which
//! is the host crate's job, so that arrives as [`MachineBuilder`]. What is left here is
//! the part that is the same on every platform: which connections exist, which are running, and what
//! a client is told about them.
//!
//! **Everything here takes `&self`, and NOTHING is serialised process-wide.** One mutex over the whole
//! server made every command wait behind the slowest one, and against a real engine that was measured
//! at 51 to 56 seconds: a retry sits inside `spawn_service` polling a socket that never answers, and
//! while it did, a second client's `list_connections` had nothing to do but queue. What replaced it is
//! three locks, each answering a different question:
//!
//! 1. **[`ConnectionSlots`], one lock per CONNECTION**, taken through `Operating` — which is the only
//!    thing that can `connect`, `disconnect`, `dropped` or `reconnect`, and now only ever for the one
//!    connection it names. Two mutations of one connection are a sequence; two of different
//!    connections are not each other's business.
//! 2. **A lock per MACHINE**, inside [`ActiveConnections`], so a forward, a ping or a stream attach
//!    against a connection nobody is moving waits for nothing at all.
//! 3. **A published projection.** Every read — `snapshot`, `watched`, `liveness` — answers from the
//!    `ConnectionRuntimeInfo` a machine last published rather than from the machine.
//!
//! The shape is the one `open-multi-agent`'s pi supervisor arrived at for the same reason.

use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::capabilities::fs::FsLocks;
use cdc_runtime::capabilities::http::HttpStreamOpen;
use cdc_runtime::domain::active_connections::ActiveConnections;
use cdc_runtime::domain::diagnostic::Diagnostic;
use cdc_runtime::domain::machine::proxy::ForwardedResponse;
use cdc_runtime::domain::machine::{ConnectListener, ConnectionMachine};
use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResult, CommandProxyStreamHandle,
};
use cdc_runtime::domain::types::connection::Connection;
use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};
use cdc_runtime::domain::types::os::OperatingSystem;
use cdc_runtime::domain::types::resource_sync_protocol::{
    AppRuntimeSnapshot, ConnectOrigin, ConnectProgress, ConnectionPhase, ConnectionSummary,
};
use cdc_runtime::runtimes::registry;
use cdc_runtime::settings::store::SettingsStore;
use tokio::sync::OwnedRwLockReadGuard;

use crate::protocol::{Command, Event, Push, Reply, Request, Response};
use crate::slots::{ConnectionSlots, Slot};
use crate::streams::ForwardedStreams;

/// Which attached client a command came from — the original's `senderId`.
///
/// The server owns no client state and holds no queues; this exists because a forwarded STREAM is the
/// one thing a client owns that the server has to hold for it, and a client that goes away must not
/// leak an engine connection per log view (`disposeForSender`,). Opaque on purpose: a
/// listener names its clients however it likes.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ClientId(pub String);

impl From<&str> for ClientId {
    fn from(id: &str) -> Self {
        Self(id.to_string())
    }
}

/// How a stored connection becomes a running machine.
///
/// A trait rather than a closure because it is asked once per connect and must outlive every one of
/// them — and because the module that implements it is where the platform is chosen ([`crate::host`]).
///
/// `Send + Sync` because a server serves every client from one shared instance, on a multi-threaded
/// scheduler.
pub trait MachineBuilder: Send + Sync {
    fn build(&self, connection: Connection) -> ConnectionMachine;
}

/// The connections this process owns, and the document they come from.
pub struct Server<F: FsLocks, B: MachineBuilder, C: Clock> {
    settings: SettingsStore<F>,
    active: ActiveConnections,
    /// Serialises the half that moves ONE connection — see [`Operating`], which is the only way to
    /// take a slot and the only thing that can.
    slots: ConnectionSlots,
    builder: B,
    clock: C,
    os_type: OperatingSystem,
    streams: Arc<ForwardedStreams>,
}

impl<F: FsLocks, B: MachineBuilder, C: Clock> Server<F, B, C> {
    pub fn new(settings: SettingsStore<F>, builder: B, clock: C, os_type: OperatingSystem) -> Self {
        Self {
            settings,
            active: ActiveConnections::new(),
            slots: ConnectionSlots::default(),
            builder,
            clock,
            os_type,
            streams: Arc::new(ForwardedStreams::default()),
        }
    }

    /// Enter the mutating half FOR ONE CONNECTION, waiting for whatever is already in it.
    ///
    /// **Before the document is consulted, and deliberately.** A connection nobody stored is refused
    /// inside [`Operating::attempt`], because a check made out here is a check another client's
    /// `remove_connection` can run between — so an invented id does take a slot. What that costs is
    /// bounded by [`ConnectionSlots`], which forgets a slot the moment nothing holds it.
    async fn operate<'a>(&'a self, connection_id: &'a str) -> Operating<'a, F, B, C> {
        Operating {
            server: self,
            connection_id,
            _slot: self.slots.enter(connection_id).await,
        }
    }

    /// The forwarded streams this server is holding, for the callers that pump and reap them.
    ///
    /// **An `Arc`, so that both live outside every lock this type takes.** A stream pump and a
    /// departing client's reap must not queue behind a connect: the log a client is watching would stall
    /// while an unrelated connection came up, and a window that closed mid-log would keep its engine
    /// stream open until the connect finished. That reap is what the design exists to make
    /// prompt. [`ForwardedStreams::next_frame`] taking `&self` is the same decision one layer down.
    pub fn streams(&self) -> &Arc<ForwardedStreams> {
        &self.streams
    }

    /// Every connection down, in the order they come out of the table.
    ///
    /// **This is what kills the tunnels.** Each machine's own `disconnect` is what stops its services,
    /// so a shutdown that skipped this would leave an `ssh -NL` reparented to init with no handle
    /// anywhere — the leak the design names, arriving by a different door. Answers what the
    /// teardown published so a caller can log the last lines before the process goes.
    ///
    /// **One slot at a time, and there is nothing left for a wider lock to buy here.** The listener has
    /// already stopped accepting, asked every client to go and waited for the tasks that were mid-frame
    /// (`endpoint::run` — the order is), so there is no command left in the process
    /// that could connect something back up behind this loop.
    pub async fn shutdown(&self) -> Vec<ConnectProgress> {
        let mut published = Vec::new();
        for id in self.active.ids() {
            let operating = self.operate(&id).await;
            published.extend(operating.disconnect().await);
        }
        published
    }

    /// Answer one command, and say what should be PUSHED because of it.
    ///
    /// **This type owns no clients**, and a dispatcher that reached into a client list would be the
    /// thing that lets a slow reader stall the connection state machine. So what a
    /// command changed comes BACK, and what an attempt says while it is still running goes to
    /// `watching` — an outbound port the caller supplies, never a roster this type holds.
    ///
    /// **A connect's own lines are not among the pushes**, for the reason `Operating::connect` gives:
    /// they went to `watching` as they happened, and returning them as well would put every one of them
    /// on a client's socket twice.
    pub async fn dispatch(
        &self,
        client: &ClientId,
        request: Request,
        watching: &dyn ConnectListener,
    ) -> (Response, Vec<Push>) {
        let id = request.id.clone();
        match self.carry_out(client, request.command, watching).await {
            Ok((reply, pushes)) => (Response::ok(id, reply), pushes),
            Err(diagnostic) => (Response::failed(id, diagnostic), Vec::new()),
        }
    }

    async fn carry_out(
        &self,
        client: &ClientId,
        command: Command,
        watching: &dyn ConnectListener,
    ) -> Result<(Reply, Vec<Push>), ReportedDiagnostic> {
        match command {
            Command::ListConnections => Ok((self.connections_reply()?, Vec::new())),
            Command::CreateConnection { connection } => {
                // Infallible by construction: every field of a `Connection` is a string, an enum, a
                // number or a map with string keys, and `to_value` fails only for a shape none of
                // those can produce. A refusal here would be an arm no scenario can reach.
                let value = serde_json::to_value(&*connection).expect("a connection serializes");
                self.settings.create_connection(&value).map_err(stored)?;
                Ok((self.connections_reply()?, Vec::new()))
            }
            Command::UpdateConnection {
                connection_id,
                partial,
            } => {
                self.settings
                    .update_connection(&connection_id, &partial)
                    .map_err(stored)?;
                Ok((self.connections_reply()?, Vec::new()))
            }
            Command::RemoveConnection { connection_id } => {
                // Forget the running machine first: `ActiveConnections::remove` is documented as
                // requiring a disconnect beforehand, because dropping a machine mid-attempt loses the
                // service ids its own teardown needed — an orphaned `ssh -NL` with no handle anywhere.
                // The document edit is inside the same operation, so nothing can connect the
                // connection back up in the gap between taking it down and forgetting it.
                let operating = self.operate(&connection_id).await;
                operating.disconnect().await;
                self.settings
                    .remove_connection(&connection_id)
                    .map_err(stored)?;
                Ok((self.connections_reply()?, Vec::new()))
            }
            Command::Connect {
                connection_id,
                origin,
            } => Ok((
                self.operate(&connection_id)
                    .await
                    .connect(origin, watching)
                    .await?,
                Vec::new(),
            )),
            Command::Disconnect { connection_id } => {
                // The projection is taken inside the operation, as [`Operating::connect`]'s is: a
                // reply assembled after the slot went back describes whatever happened next, and a
                // client would read that as the answer to what IT asked for.
                let operating = self.operate(&connection_id).await;
                let progress = operating.disconnect().await;
                Ok((self.snapshot_reply()?, pushes(progress)))
            }
            Command::GetRuntimeSnapshot => Ok((self.snapshot_reply()?, Vec::new())),
            // **No slot, deliberately.** This asks a CLI a question and mutates nothing, so putting
            // it behind [`Operating`] would make a discovery wait out a retry that is up to a minute
            // long — for an answer a person needs BEFORE the connection works. The machine is built
            // and dropped here rather than taken from `active`, so it cannot disturb a running one.
            Command::ListEngineContexts { connection_id } => {
                let stored = self.stored(&connection_id)?;
                // Read from the STORED connection rather than from the machine's resolved settings:
                // the pin is what a user configured, and detection has nothing to say about it.
                let pinned = stored.settings.context.clone();
                let machine = self.builder.build(stored);
                Ok((
                    Reply::EngineContexts {
                        contexts: machine.list_contexts().await.map_err(refused)?,
                        connection_id,
                        pinned,
                    },
                    Vec::new(),
                ))
            }
            Command::ProxyRequest { payload } => self.proxy(client, &payload, watching).await,
            Command::DestroyStream { stream_id } => {
                self.streams.destroy(&stream_id);
                Ok((Reply::Destroyed, Vec::new()))
            }
        }
    }

    /// Forward one request through the connection the payload names.
    ///
    /// The connection is brought up first, exactly as the original's broker awaits `ensureConnected`
    /// before it asks for a driver — and through the server's OWN `connect`, so there is one path that
    /// starts a connection rather than two that can disagree. Whatever that connect published travels
    /// back with the answer.
    async fn proxy(
        &self,
        client: &ClientId,
        payload: &CommandProxyRequestPayload,
        watching: &dyn ConnectListener,
    ) -> Result<(Reply, Vec<Push>), ReportedDiagnostic> {
        let connection_id = routed_to(payload)?;
        let machine = self.connected(&connection_id, watching).await?;
        let forwarded = machine.forward(payload).await.map_err(refused)?;
        // Given back before the answer is assembled: what a stream carries is its own engine
        // connection, so holding this connection's machine while a client reads a log would be the
        // wait `Server::streams` exists to prevent, one layer up.
        drop(machine);
        let result = match forwarded {
            ForwardedResponse::Buffered(response) => CommandProxyResult::Buffered(response),
            ForwardedResponse::Stream(open) => {
                CommandProxyResult::Stream(CommandProxyStreamHandle {
                    headers: Some(
                        open.headers
                            .into_iter()
                            .map(|(name, value)| (name, serde_json::Value::String(value)))
                            .collect(),
                    ),
                    status: Some(open.status),
                    stream: true,
                    stream_id: self.streams.open(client, open.body),
                })
            }
        };
        Ok((
            Reply::Proxied {
                result: Box::new(result),
            },
            Vec::new(),
        ))
    }

    /// `engineDataService.ensureConnected` — bring it up unless it already is, and hold it for
    /// reading.
    ///
    /// Idempotent on the same test the original uses: a connection the server is holding whose phase
    /// says `ready` needs nothing. Anything else is connected, including one that is mid-back-off,
    /// because a forwarded request is explicit intent to use it.
    ///
    /// **The machine comes back with the answer rather than being looked up again**, and that is what
    /// the lock split costs here. Asking whether a connection is ready and then asking for it a second
    /// time is two observations, and between them another client's `remove_connection` is now able to
    /// run — so a lookup that used to be sound by construction would be a panic on a race. What holds
    /// instead is the operation: nothing can remove a connection while the connect that brought it up
    /// still has it.
    async fn connected(
        &self,
        connection_id: &str,
        watching: &dyn ConnectListener,
    ) -> Result<OwnedRwLockReadGuard<ConnectionMachine>, ReportedDiagnostic> {
        // Scoped, and it MUST be: a read guard still held when `operate` was entered would be waiting
        // for the write lock its own connect is about to ask for.
        if let Some(machine) = self.active.reading(connection_id).await
            && machine.phase() == ConnectionPhase::Ready
        {
            return Ok(machine);
        }
        let operating = self.operate(connection_id).await;
        // `attempt` rather than `connect`, so the projection a `connect` COMMAND is answered with —
        // which costs a settings read and a parse — is not assembled inside this slot and thrown away.
        operating.attempt(ConnectOrigin::User, watching).await?;
        Ok(self
            .active
            .reading(connection_id)
            .await
            .expect("a connect that answered left its machine in the table"))
    }

    /// What a connection is doing, and when its next attempt is due — in ONE read.
    ///
    /// **One read rather than two accessors**, because the pair is what the supervisor acts on: asking
    /// the phase and then the schedule is two observations and can see two different states, and the
    /// decision made from them would belong to neither. `now` travels with them for the same reason
    /// [`Server::snapshot`] reads it inline — a delay is a DIFFERENCE, and two clock reads separated
    /// by an acquisition make it wrong by however long the acquisition took.
    ///
    /// Answered from the published projection, so a supervisor deciding what to do next never waits on
    /// the attempt it is deciding about — and it reads the same two numbers a client renders.
    pub fn liveness(&self, connection_id: &str) -> Option<Liveness> {
        let seen = self.active.seen(connection_id)?;
        Some(Liveness {
            phase: seen.phase,
            // The projection carries the wire's signed millisecond stamp; a clock reading is never
            // negative, so the floor is total arithmetic rather than a case that can happen.
            next_retry_at: seen.next_retry_at.map(|at| at.max(0) as u64),
            now: self.clock.now_millis(),
        })
    }

    /// Which connections a watcher should exist for.
    ///
    /// `ready` because a live connection has to be watched, and `reconnecting` because the watcher IS
    /// what is retrying it — a reconciliation that dropped a watcher the moment its connection left
    /// `ready` would cancel the cycle it had just started.
    ///
    /// **And not one that has already given up.** A watcher that stood down because the engine serves
    /// no usable `/events` would otherwise be re-spawned by the next command — this runs after every
    /// one — so an Apple connection paid a fresh attach and its 3.5s bound per command, forever.
    ///
    /// Read off [`ActiveConnections::phases`] rather than the whole projection, because a reconcile
    /// follows every command and this is the whole of what it needs.
    pub fn watched(&self) -> Vec<String> {
        self.active
            .phases()
            .into_iter()
            .filter(|(_, phase, watched)| {
                *watched
                    && matches!(
                        phase,
                        ConnectionPhase::Ready | ConnectionPhase::Reconnecting
                    )
            })
            .map(|(id, _, _)| id)
            .collect()
    }

    /// Attach to a connection's engine event stream — the liveness signal a watcher reads.
    ///
    /// **The stream is handed OUT of the machine deliberately.** [`HttpStreamOpen`] owns its own engine
    /// connection, so reading it needs nothing from this type — and a watcher that held its
    /// connection's machine for the lifetime of a `/events` stream would hold it until the engine died,
    /// which is that connection's own retry blocked forever.
    pub async fn watch_events(
        &self,
        connection_id: &str,
    ) -> Option<Result<HttpStreamOpen, Diagnostic>> {
        Some(
            self.active
                .reading(connection_id)
                .await?
                .watch_events()
                .await,
        )
    }

    /// Ask a connection's engine whether it is still answering — one attempt.
    pub async fn probe(&self, connection_id: &str) -> Option<Result<(), Diagnostic>> {
        Some(self.active.reading(connection_id).await?.probe().await)
    }

    /// Tell a connection its engine is gone. Answers what that published, empty if it was not running.
    pub async fn dropped(&self, connection_id: &str, code: DiagnosticCode) -> Vec<ConnectProgress> {
        self.operate(connection_id).await.dropped(code).await
    }

    /// Record that the watch has given up on this connection: its engine serves no usable `/events`.
    ///
    /// **Not a phase change.** The connection keeps working; what changes is that nothing will notice
    /// when it stops, and [`Server::watched`] must stop asking for a watcher that will only give up
    /// again. Answers whether there was a connection to tell.
    pub async fn stood_down(&self, connection_id: &str) -> bool {
        self.operate(connection_id).await.stood_down().await
    }

    /// Make the scheduled attempt, on the machine that scheduled it.
    pub async fn reconnect(
        &self,
        connection_id: &str,
        watching: &dyn ConnectListener,
    ) -> Vec<ConnectProgress> {
        self.operate(connection_id).await.reconnect(watching).await
    }

    fn stored(&self, connection_id: &str) -> Result<Connection, ReportedDiagnostic> {
        self.connections()?
            .into_iter()
            .find(|it| it.id == connection_id)
            .ok_or_else(|| {
                refusal(
                    DiagnosticCode::HostNotSupported,
                    serde_json::json!({ "connection": connection_id }),
                )
            })
    }

    fn connections(&self) -> Result<Vec<Connection>, ReportedDiagnostic> {
        self.settings.connections().map_err(stored)
    }

    fn connections_reply(&self) -> Result<Reply, ReportedDiagnostic> {
        Ok(Reply::Connections {
            connections: self.connections()?,
        })
    }

    fn snapshot_reply(&self) -> Result<Reply, ReportedDiagnostic> {
        Ok(Reply::Snapshot {
            snapshot: Box::new(self.snapshot()?),
        })
    }

    /// What every attaching client is handed, and what every change re-publishes.
    ///
    /// Whole-state, matching the app's existing coarse-but-simple-and-correct choice.
    /// Deltas are a later optimisation to be made from profiling rather than from assumption.
    pub fn snapshot(&self) -> Result<AppRuntimeSnapshot, ReportedDiagnostic> {
        let active = self.active.runtime_infos();
        Ok(AppRuntimeSnapshot {
            active: (!active.is_empty()).then_some(active),
            connections: self.connections()?.iter().map(summary).collect(),
            // Never populated, and `AppRuntimeSnapshot::current_connector` says why: there is no
            // primary connection in this core, deliberately.
            current_connector: None,
            // Read HERE rather than passed in, so it is the instant the projection was taken and not
            // the instant the command arrived. A client subtracts a connection's `next_retry_at` from
            // it, and the two have to be the same clock read at the same moment or the answer is a
            // countdown that is wrong by however long the snapshot took to assemble.
            now: self.clock.now_millis() as i64,
            os_type: self.os_type.to_string(),
            // The APPLICATION's phase, not any one connection's. A server that is answering is up,
            // whatever its connections are doing — a client reads those from `active`.
            phase: ConnectionPhase::Ready,
            running: true,
        })
    }
}

/// The half of a server that MOVES ONE connection, and that connection's slot while it does.
///
/// **What is serialised is moving a connection, and nothing else.** Reading the document, projecting a
/// snapshot and forwarding a request are all outside this, which is the whole point: a
/// `list_connections` has no reason to wait behind a retry that will be here for the best part of a
/// minute. Neither has a `connect` to a different engine — [`ConnectionSlots`] is keyed, so with two
/// configured and one of them down, the healthy one comes up while the sick one is still polling, and
/// its own watcher can record its drop the moment it happens rather than a minute later.
///
/// **The connection is a FIELD rather than a parameter, and that is what makes it sound.** Every method
/// below moves the connection whose slot this value holds, and there is no way to spell any other one:
/// a signature that took an id would let a caller hold the slot for one connection and move a second,
/// which is the whole exclusion gone and nothing to notice it by.
///
/// **Existing so that the inner halves cannot take the slot twice.** `remove_connection` disconnects a
/// connection and edits the document under one acquisition, and a `tokio::sync::Mutex` is not
/// reentrant, so an inner half that locked for itself would hang the process rather than fail. Asking
/// for this value is how a caller says it already holds the slot, and there is no other way to reach
/// these four.
struct Operating<'a, F: FsLocks, B: MachineBuilder, C: Clock> {
    server: &'a Server<F, B, C>,
    connection_id: &'a str,
    /// Held for as long as this value lives, and never read: what it does is exclude the second one.
    _slot: Slot<'a>,
}

impl<F: FsLocks, B: MachineBuilder, C: Clock> Operating<'_, F, B, C> {
    /// Bring a connection up, answering every progress line it produced.
    ///
    /// The machine is REBUILT from the stored connection on every connect, exactly as the original
    /// rebuilds its host from `connection.settings`: the units are stateful, and reusing one across a
    /// reconnect is how a stale scope survives a retry.
    /// Nothing comes back but whether it could be started: every line went to `watching` as the
    /// attempt produced it, which is the only moment any of them was worth having.
    async fn attempt(
        &self,
        origin: ConnectOrigin,
        watching: &dyn ConnectListener,
    ) -> Result<(), ReportedDiagnostic> {
        let connection = self.server.stored(self.connection_id)?;
        let machine = self.server.builder.build(connection);
        // The machine being REPLACED is held across the SWAP, so no reader is part-way through the
        // old one when the new one takes its place. It used to be held for the whole ATTEMPT, and
        // that was the only way to keep a reader off a machine already being replaced: the new one
        // did not reach the table until the attempt was over.
        let displaced = self.server.active.hold(self.connection_id).await;
        // **The new machine goes in FIRST, and that is what makes the attempt visible.** A minute
        // inside `spawn_service` used to be a minute of every read answering from the machine being
        // replaced — a connection that was `reconnecting` went on saying `retry in 0.9s` while a new
        // attempt was well under way. `connectOne` has no such gap: it records `starting` before it
        // asks the host for anything. So what a reader now waits on is the attempt itself.
        let mut held = self.server.active.take_over(machine).await;
        drop(displaced);
        held.connect(origin, Some(watching)).await;
        Ok(())
    }

    /// The same, as the answer a client's `connect` command gets.
    ///
    /// The projection is taken INSIDE the operation, so what a client is told is the state its own
    /// command produced rather than whatever happened next.
    ///
    /// **No pushes come back, and that is the single fan-out path rather than an omission.** Every
    /// line was handed to `watching` as the attempt produced it — which is the whole point of an
    /// attempt that lasts a minute — so returning them here as well would put each of them on a
    /// client's socket twice.
    async fn connect(
        &self,
        origin: ConnectOrigin,
        watching: &dyn ConnectListener,
    ) -> Result<Reply, ReportedDiagnostic> {
        self.attempt(origin, watching).await?;
        self.server.snapshot_reply()
    }

    /// Take a connection down. Answers whatever it published, which is empty when it was not running.
    async fn disconnect(&self) -> Vec<ConnectProgress> {
        let Some(mut machine) = self.server.active.hold(self.connection_id).await else {
            return Vec::new();
        };
        let progress = machine.disconnect().await;
        // Only once it has torn its services down, per `ActiveConnections::remove`'s contract, and
        // only once the machine is given back — which is what republishes the phase it ended in.
        drop(machine);
        self.server.active.remove(self.connection_id);
        progress
    }

    /// Tell a connection its engine is gone. Answers what that published, empty if it was not running.
    async fn dropped(&self, code: DiagnosticCode) -> Vec<ConnectProgress> {
        let Some(mut machine) = self.server.active.hold(self.connection_id).await else {
            return Vec::new();
        };
        machine.dropped(code).await
    }

    /// Record that nothing is watching this connection any more. `Held::drop` publishes it.
    async fn stood_down(&self) -> bool {
        let Some(mut machine) = self.server.active.hold(self.connection_id).await else {
            return false;
        };
        machine.stood_down();
        true
    }

    /// Make the scheduled attempt, on the machine that scheduled it.
    ///
    /// **The existing machine, where [`Operating::connect`] builds a new one, and the difference is the
    /// whole back-off.** `attempt`, `next_retry_at` and the stability window live on the machine, so a
    /// retry through a REBUILT one would reset the counter on every cycle and retry forever at the
    /// initial delay — a retry storm produced by the code meant to prevent one. The original keeps the
    /// same distinction: `scheduleReconnect` captures the connection at the drop and hands that same
    /// value to `connectOne`, while an explicit user connect re-reads. A settings edit is therefore
    /// picked up by the next USER connect and not mid-cycle, which is also what the original does.
    async fn reconnect(&self, watching: &dyn ConnectListener) -> Vec<ConnectProgress> {
        let Some(mut machine) = self.server.active.hold(self.connection_id).await else {
            return Vec::new();
        };
        machine
            .connect(ConnectOrigin::Reconnect, Some(watching))
            .await
    }
}

/// What a connection is doing and when it is next due, read together.
///
/// A value rather than three accessors, for the reason [`Server::liveness`] gives: they are one
/// observation, and a supervisor that assembled them from three lock acquisitions would be acting on
/// a state that never existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Liveness {
    pub phase: ConnectionPhase,
    /// When the scheduled attempt is due, on the same clock as `now`. `None` when nothing is pending.
    pub next_retry_at: Option<u64>,
    /// The core's clock as this was taken — what `next_retry_at` is a distance from.
    pub now: u64,
}

impl Liveness {
    /// How long until the scheduled attempt, or `None` when there is none.
    ///
    /// Saturating, so a retry that is already overdue is due NOW rather than a duration that wrapped:
    /// the machine schedules against a clock read at the drop, and any work between then and here is
    /// time the delay has already been served.
    pub fn until_retry(&self) -> Option<std::time::Duration> {
        self.next_retry_at
            .map(|at| std::time::Duration::from_millis(at.saturating_sub(self.now)))
    }
}

/// One connection as the snapshot lists it.
fn summary(connection: &Connection) -> ConnectionSummary {
    ConnectionSummary {
        // Beside `capabilities` and answered on the same terms — see the field. A client picks its REST
        // root from this, so a connector no release registered says so rather than defaulting to one.
        api_surface: registry::api_surface(connection.engine, connection.host).ok(),
        // Answered for a connection that is merely CONFIGURED, not only for one that is running: a
        // client renders the offer list from this, and what an engine can do does not depend on
        // whether it happens to be up.
        capabilities: registry::capabilities(connection.engine, connection.host).ok(),
        engine: connection.engine,
        host: Some(connection.host),
        id: connection.id.clone(),
        name: connection.name.clone(),
    }
}

fn pushes(progress: Vec<ConnectProgress>) -> Vec<Push> {
    progress
        .into_iter()
        .map(|line| {
            Push::new(Event::Progress {
                progress: Box::new(line),
            })
        })
        .collect()
}

/// Which connection a forwarded request is for — `payload.connection.id`.
///
/// **A payload naming none is REFUSED**, and that is a decision rather than a gap. The original falls
/// back to its primary connection (`?? primary`); this core deliberately has none, because
/// `connectHostClient` was written not to mutate a shared "current" so that several connections could
/// run at once. Guessing one here would put that coupling back.
fn routed_to(payload: &CommandProxyRequestPayload) -> Result<String, ReportedDiagnostic> {
    payload
        .connection
        .as_ref()
        .and_then(|connection| connection.get("id"))
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            refusal(
                DiagnosticCode::ProxyRequestInvalid,
                serde_json::json!({ "field": "connection" }),
            )
        })
}

fn refusal(code: DiagnosticCode, params: serde_json::Value) -> ReportedDiagnostic {
    ReportedDiagnostic {
        code,
        params: params.as_object().cloned().unwrap_or_default(),
        severity: DiagnosticSeverity::Err,
    }
}

/// A unit's refusal, as the report entry a client is sent.
///
/// The code and its parameters travel whole: unlike a `SettingsError` they are already
/// vocabulary, typed and free of paths this process should not export.
fn refused(diagnostic: cdc_runtime::domain::diagnostic::Diagnostic) -> ReportedDiagnostic {
    ReportedDiagnostic {
        code: diagnostic.code,
        params: diagnostic
            .params
            .as_ref()
            .and_then(|params| params.as_object().cloned())
            .unwrap_or_default(),
        severity: DiagnosticSeverity::Err,
    }
}

/// The settings document could not be read or written.
///
/// The reason is deliberately NOT forwarded: a `SettingsError` carries a filesystem path and an I/O
/// message, and this frame may be crossing a WebSocket to a remote client (the design keeps paths out
/// of anything exported). What a client can act on is that the document is unreadable.
fn stored(_error: cdc_runtime::settings::store::SettingsError) -> ReportedDiagnostic {
    refusal(DiagnosticCode::NotChecked, serde_json::json!({}))
}
