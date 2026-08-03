//! The connections this process is running, each with its own machine.
//!
//! **Not the original's `registry.ts`** — that is the twelve-connector TABLE and lives in
//! [`crate::runtimes::registry`]. This is live state, whose counterpart is `Application`'s own map,
//! and the two were conflated under one name here.
//!
//! There is NO primary connection here, and that absence is the design. `connectHostClient` was
//! carefully written not to mutate a shared "current" host so that several connections could run at
//! once; a registry with a `default` field would put that coupling straight back. Primary is a client
//! presentation choice — the settings document has `connector.default` for the client that wants one.
//!
//! Keyed and ordered by connection id, so a snapshot of several connections is stable and diffable
//! rather than dependent on insertion order.
//!
//! **A reader never waits on whatever is moving a machine, and that is what the locks here are for.**
//! A connect spends its time inside `spawn_service` polling for a socket to answer — ten attempts five
//! seconds apart, measured at 51 to 56 seconds against a real engine that never came up — and it needs
//! `&mut` on exactly ONE machine to do it. So a machine is behind a lock of its own, and what a reader
//! reads is the projection that machine last published, under a lock held for the length of a clone.
//! The map's own lock is `std`'s deliberately: it is never held across an await, and a guard that
//! cannot cross one is a rule the compiler keeps rather than a comment that asks.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

use crate::domain::machine::{ConnectListener, ConnectionMachine};
use crate::domain::types::resource_sync_protocol::{
    ConnectOrigin, ConnectProgress, ConnectionPhase, ConnectionRuntimeInfo,
};

#[derive(Debug, Default)]
pub struct ActiveConnections {
    live: Mutex<BTreeMap<String, Live>>,
}

/// One running connection: the machine an operation takes, and what that machine last said about
/// itself.
#[derive(Debug, Clone)]
struct Live {
    machine: Arc<RwLock<ConnectionMachine>>,
    /// The projection every reader reads. Written by whoever held the machine, as they give it back.
    seen: Arc<Mutex<ConnectionRuntimeInfo>>,
}

impl ActiveConnections {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add or replace the machine for a connection, publishing what it says about itself.
    pub fn insert(&self, machine: ConnectionMachine) {
        let (id, live) = entry(machine);
        self.live
            .lock()
            .expect("active connections")
            .insert(id, live);
    }

    /// The same, handing the machine straight back HELD — for a caller that is about to move it.
    ///
    /// **This is what makes an attempt visible while it runs.** A connect used to build its machine,
    /// move it for the minute `spawn_service` takes and only then put it in, so every read for that
    /// minute answered from the machine being REPLACED — a connection that was `reconnecting` went on
    /// saying `retry in 0.9s` while a new attempt was already well under way. The original has no such
    /// gap: `connectOne` writes `phase: "starting"` into the map every reader reads before it asks the
    /// host for anything.
    ///
    /// Inserted and held under one acquisition, so what comes back is the entry that went in whatever
    /// else reaches the table next — an `insert` followed by a `hold` would be two observations with a
    /// removal possible between them, and the `expect` that closed it would be a panic on a race.
    pub async fn take_over(&self, machine: ConnectionMachine) -> Held {
        let (id, live) = entry(machine);
        self.live
            .lock()
            .expect("active connections")
            .insert(id, live.clone());
        Held {
            machine: live.machine.write_owned().await,
            seen: live.seen,
        }
    }

    /// The machine, for a caller that is going to MOVE it.
    ///
    /// Waits for this connection's readers and for nothing else — a caller moving a DIFFERENT
    /// connection is not this one's problem. **It does not make two attempts at one connection a
    /// sequence**, and nothing here can: a caller that rebuilds the machine takes a lock on the new
    /// one, not on this. That exclusion belongs to whoever owns the rebuilding, and in this workspace
    /// that is `cdc-server`'s `ConnectionSlots` — a lock keyed by connection ID, which outlives every
    /// machine that ID ever has.
    pub async fn hold(&self, id: &str) -> Option<Held> {
        let live = self.live_at(id)?;
        Some(Held {
            machine: live.machine.write_owned().await,
            seen: live.seen,
        })
    }

    /// The machine, for a caller that is only going to READ it — a forward, a ping, a stream attach.
    ///
    /// Shared with every other reader, so a log a client is following and a watcher's ping are never
    /// each other's problem. It waits only for a caller that is moving this same connection.
    pub async fn reading(&self, id: &str) -> Option<OwnedRwLockReadGuard<ConnectionMachine>> {
        Some(self.live_at(id)?.machine.read_owned().await)
    }

    /// What a connection last said about itself, without waiting for whatever is moving it.
    ///
    /// **This is what every read answers from**, and what makes it exact is that both ends republish:
    /// [`Held`] on the way out, for a mutation that is over in the time a `kill` takes, and
    /// [`Held::connect`] at every line of an attempt, for the one that is not. So the staleness left is
    /// the gap BETWEEN two lines of an attempt rather than the whole of it — which used to be a minute
    /// of a connection rendering the state it was in before it began.
    pub fn seen(&self, id: &str) -> Option<ConnectionRuntimeInfo> {
        Some(self.live_at(id)?.seen.lock().expect("a projection").clone())
    }

    /// Forget a connection, answering whether there was one.
    ///
    /// The caller is responsible for having disconnected it first — dropping a machine mid-attempt
    /// loses the service ids its teardown needed.
    pub fn remove(&self, id: &str) -> bool {
        self.live
            .lock()
            .expect("active connections")
            .remove(id)
            .is_some()
    }

    pub fn ids(&self) -> Vec<String> {
        self.live
            .lock()
            .expect("active connections")
            .keys()
            .cloned()
            .collect()
    }

    pub fn len(&self) -> usize {
        self.live.lock().expect("active connections").len()
    }

    pub fn is_empty(&self) -> bool {
        self.live.lock().expect("active connections").is_empty()
    }

    /// Every connection's id, the phase it last published, and whether anything is watching it.
    ///
    /// **Not [`ActiveConnections::runtime_infos`] filtered**, because the caller for this runs after
    /// every command a client issues: deep-cloning each projection — the names, the versions, the uris,
    /// a diagnostic's whole parameter map — to read one `Copy` field off each of them is work that
    /// scales with how much is wrong rather than with how much was asked.
    pub fn phases(&self) -> Vec<(String, ConnectionPhase, bool)> {
        self.live
            .lock()
            .expect("active connections")
            .iter()
            .map(|(id, live)| {
                let seen = live.seen.lock().expect("a projection");
                (id.clone(), seen.phase, seen.watched.unwrap_or(true))
            })
            .collect()
    }

    /// Every connection's projection — the `active` array of the runtime snapshot.
    pub fn runtime_infos(&self) -> Vec<ConnectionRuntimeInfo> {
        self.live
            .lock()
            .expect("active connections")
            .values()
            .map(|live| live.seen.lock().expect("a projection").clone())
            .collect()
    }

    /// The handles for one connection, taken out from under the map's lock so that nothing this type
    /// owns is held across an await.
    fn live_at(&self, id: &str) -> Option<Live> {
        self.live
            .lock()
            .expect("active connections")
            .get(id)
            .cloned()
    }
}

/// One machine as this table keeps it: keyed by its connection, published as it stands.
fn entry(machine: ConnectionMachine) -> (String, Live) {
    let id = machine.connection().id.clone();
    (
        id,
        Live {
            seen: Arc::new(Mutex::new(machine.runtime_info())),
            machine: Arc::new(RwLock::new(machine)),
        },
    )
}

/// A machine taken out to be moved, and the projection it republishes when it goes back.
///
/// **Republished on the way out rather than at each call site, and that is the whole reason this type
/// exists.** Every read answers from that projection, so a caller that moved a machine and forgot to
/// say so would leave a snapshot asserting a phase the connection had left — and the omission would be
/// invisible, because what it produces is a stale value rather than an error. There is no way to hold
/// this and not republish.
#[derive(Debug)]
pub struct Held {
    machine: OwnedRwLockWriteGuard<ConnectionMachine>,
    seen: Arc<Mutex<ConnectionRuntimeInfo>>,
}

impl Held {
    /// Bring the connection up, republishing the projection at every line the attempt produces.
    ///
    /// **`Drop` alone is not enough for the one operation that takes a minute.** Republishing when the
    /// machine goes back is what keeps every OTHER mutation honest — a `dropped`, a `disconnect` — and
    /// each of those is over in the time a `kill` takes. A connect is not: it sits inside
    /// `spawn_service` for 51 to 56 seconds against an engine that never comes up, and a projection
    /// that waits for the end of that describes the connection as it was before it began.
    ///
    /// Whoever else is listening is told AFTER the projection is written, and that order is the point:
    /// what a listener does with a line is publish the state it narrates, and it reads that state from
    /// here.
    pub async fn connect(
        &mut self,
        origin: ConnectOrigin,
        watching: Option<&dyn ConnectListener>,
    ) -> Vec<ConnectProgress> {
        let publishing = Publishing {
            seen: &self.seen,
            watching,
        };
        self.machine.connect(origin, Some(&publishing)).await
    }
}

/// The projection, written before anybody else hears the line that moved it.
struct Publishing<'a> {
    seen: &'a Mutex<ConnectionRuntimeInfo>,
    watching: Option<&'a dyn ConnectListener>,
}

impl ConnectListener for Publishing<'_> {
    fn progressed(&self, progress: &ConnectProgress, info: &ConnectionRuntimeInfo) {
        // In a statement of its own, and it MUST be: a listener's whole job is to read the state this
        // line narrates, and every read of it comes through this same lock. Holding the guard across
        // the call below would be this task waiting for itself.
        *self.seen.lock().expect("a projection") = info.clone();
        if let Some(watching) = self.watching {
            watching.progressed(progress, info);
        }
    }
}

impl std::ops::Deref for Held {
    type Target = ConnectionMachine;

    fn deref(&self) -> &Self::Target {
        &self.machine
    }
}

impl std::ops::DerefMut for Held {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.machine
    }
}

impl Drop for Held {
    fn drop(&mut self) {
        *self.seen.lock().expect("a projection") = self.machine.runtime_info();
    }
}
