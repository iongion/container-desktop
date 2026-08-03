//! One lock per connection: what a command takes to MOVE one, and nothing wider.
//!
//! **The measurement this exists for is 51 to 56 seconds.** [`crate::server::Server`] used to serialise
//! its mutating half behind a single process-wide mutex, and a failing attempt spends
//! `API_READINESS_ATTEMPTS × API_READINESS_WAIT` — ten polls five seconds apart — inside
//! `spawn_service` waiting for a socket that never answers. With two engines configured and one of them
//! down, the healthy one's `connect` queued behind the sick one's retry for the best part of a minute,
//! and so did that healthy connection's own watcher recording ITS engine going away — so a dead engine
//! rendered `ready` for a minute and began retrying a minute late.
//!
//! **The lock is on the SLOT rather than on the machine, and that is the whole design.** A connect
//! REBUILDS the machine from the document (`Operating::attempt` says why), so a lock living on the
//! machine would have two connects of one connection take two different locks: both would run, and the
//! first one's services would be left running with nothing holding their ids — the `ssh -NL` reparented
//! to init that the design names. A slot is keyed by the connection ID, which outlives every
//! machine that ID ever has.
//!
//! **A slot is forgotten as soon as nothing holds it, and that is the answer to who may create one.**
//! A command naming a connection nobody stored is refused only AFTER its slot has been taken — `stored`
//! reads the document inside the operation, because a check outside it is a check another client's
//! `remove_connection` can run between. So an id nobody has heard of does get a slot; what stops a
//! client minting one per invented id is that the table holds only what is in flight, never what has
//! ever been asked for.
//!
//! The map's own lock is `std`'s deliberately, as [`cdc_runtime::domain::active_connections`]'s is: it
//! is never held across an await, and a guard that cannot cross one is a rule the compiler keeps rather
//! than a comment that asks.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

/// The lock each connection is moved under, and nothing else about that connection.
///
/// Deliberately knows no connections: it is a table of locks keyed by id, so it needs no telling when
/// one is created, removed, connected or forgotten. What it holds is what is being operated on right
/// now.
#[derive(Debug, Default)]
pub struct ConnectionSlots {
    held: Mutex<BTreeMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl ConnectionSlots {
    /// Take one connection's slot, waiting for whatever already has it — and for nothing else.
    pub async fn enter(&self, connection_id: &str) -> Slot<'_> {
        // Cloned out from under the map's lock, so that the await below holds nothing of this type's.
        let slot = {
            let mut held = self.held.lock().expect("connection slots");
            Arc::clone(held.entry(connection_id.to_string()).or_default())
        };
        Slot {
            guard: Some(slot.lock_owned().await),
            slots: self,
            connection_id: connection_id.to_string(),
        }
    }

    /// How many connections are being operated on — which is the bound the paragraph about invented
    /// ids in this module's documentation rests on, and the only thing worth observing here.
    pub fn in_use(&self) -> usize {
        self.held.lock().expect("connection slots").len()
    }

    /// Give a slot back, forgetting it if this was the last operation that wanted it.
    ///
    /// **ONE reference: the map's own.** The releasing slot's went with its guard, on the line above the
    /// call, and every operation still queued on this connection is holding one of its own — which is
    /// exactly what makes the count the right question to ask. Reaping a slot something is waiting on
    /// would hand the NEXT arrival a different lock while the queued one still holds this: two
    /// operations on one connection, both running, arrived at through the tidying rather than through
    /// the locking. Both directions are pinned by tests, because over-counting never reaps and
    /// under-counting reaps too early, and only one of those looks like a leak.
    fn release(&self, connection_id: &str) {
        let mut held = self.held.lock().expect("connection slots");
        if held
            .get(connection_id)
            .is_some_and(|slot| Arc::strong_count(slot) == 1)
        {
            held.remove(connection_id);
        }
    }
}

/// One connection's slot, held for as long as this value lives.
///
/// The guard is never read: what it does is exclude the second one. Asking for this value is how a
/// caller says which connection it is about to move, and `server::Operating` is the only
/// thing that does.
#[derive(Debug)]
pub struct Slot<'a> {
    /// An `Option` so that [`Drop`] can put it back BEFORE the reap, which is not a detail: a waiter
    /// has to be able to take the lock, and the reference count the reap reads is only honest once
    /// this holder's own reference is gone.
    guard: Option<tokio::sync::OwnedMutexGuard<()>>,
    slots: &'a ConnectionSlots,
    connection_id: String,
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        drop(self.guard.take());
        self.slots.release(&self.connection_id);
    }
}
