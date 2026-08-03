//! The clients currently attached, and what each of them is owed.
//!
//! **A client is an observer that also issues commands**, so most of what it receives was not asked for
//! by it: a snapshot changes because somebody else connected something, and a progress line is the
//! server narrating work it is doing. That makes fan-out this module's whole job, and it makes the two
//! fan-out rules the thing to get right:
//!
//! - a **snapshot** and a **progress** line go to EVERY attached client. They describe the server, and a
//!   client that only heard about its own commands would render a stale workspace.
//! - a **stream** frame goes to ONE. It is part of a body that one client is reassembling, and it is
//!   worth nothing to anybody else — which is also why it may never be dropped (`Push::is_droppable`).
//!
//! **Nothing here waits on a client**, which is the invariant the design exists for: every offer
//! is into a bounded queue and returns immediately, so the connection state machine cannot be stalled by
//! a client that is paused on a scrollback. When a client is hopeless — its queue full of frames that may
//! not be dropped — the honest answer is to drop the CLIENT, and [`Admission::Overflowed`] is turned
//! into exactly that here, by cancelling it. Growing the queue would trade a bounded amount of memory
//! for an unbounded one, and dropping a progress line would put a hole in a connect trace that a bug
//! report can never explain.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cdc_runtime::domain::types::resource_sync_protocol::AppRuntimeSnapshot;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::protocol::{Event, Outbound, Push};
use crate::queue::{Admission, ClientQueue};
use crate::server::ClientId;

/// One attached client's outbound half: what it is owed, and how it is woken.
///
/// The queue is behind a `std::sync::Mutex` and NEVER held across an await — the wait happens on
/// [`Notify`], which is what lets an offer stay synchronous and non-blocking.
pub struct Attached {
    id: ClientId,
    queue: Mutex<ClientQueue>,
    wake: Notify,
    /// Cancelled when this client must go: it overflowed, or the process is shutting down. The session
    /// owns the socket and closes it; this is how anything else asks for that to happen.
    cancel: CancellationToken,
}

impl Attached {
    pub fn id(&self) -> &ClientId {
        &self.id
    }

    /// The token to select on. A session waits for frames and for this at the same time.
    pub fn cancelled(&self) -> CancellationToken {
        self.cancel.clone()
    }

    /// Ask this client to go away. Idempotent, and safe from any thread.
    pub fn cancel(&self) {
        self.cancel.cancel();
    }

    /// Offer one frame. Never blocks, never waits, never grows.
    ///
    /// An overflow cancels the client and says so: the caller does not have to remember the rule, and a
    /// second caller cannot implement it differently.
    pub fn offer(&self, frame: impl Into<Outbound>) -> Admission {
        let admission = self.queue.lock().expect("client queue").offer(frame.into());
        match admission {
            Admission::Overflowed => {
                tracing::warn!(
                    client = %self.id.0,
                    "client is too far behind to keep a complete log; disconnecting it"
                );
                self.cancel();
            }
            Admission::Superseded { snapshots } => tracing::debug!(
                client = %self.id.0,
                snapshots,
                "client is slower than the change rate; superseded unread state"
            ),
            // A dropped snapshot is not worth a line: the next one a client receives is whole, so
            // nothing is missing by the time it renders anything.
            Admission::Dropped | Admission::Queued => {}
        }
        if admission != Admission::Overflowed {
            self.wake.notify_one();
        }
        admission
    }

    /// Everything waiting, oldest first. Empty when there is nothing.
    pub fn take(&self) -> Vec<Outbound> {
        self.queue.lock().expect("client queue").drain()
    }

    /// Wait until there is something to write, or until this client is finished.
    ///
    /// `None` means finished. A permit stored by `notify_one` while nobody was waiting is what makes
    /// this free of the lost-wakeup race: a frame offered between the drain and the wait is still there
    /// to be found on the next turn of the loop.
    pub async fn next_batch(&self) -> Option<Vec<Outbound>> {
        loop {
            let frames = self.take();
            if !frames.is_empty() {
                return Some(frames);
            }
            if self.cancel.is_cancelled() {
                return None;
            }
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = self.cancel.cancelled() => return None,
            }
        }
    }
}

/// Every client attached to this process, and the last state they were told about.
#[derive(Default)]
pub struct Clients {
    /// Mints client ids. **One counter for every listener**, so a local client and a remote one can
    /// never be handed the same id — two clients sharing an id would have one of them reap the other's
    /// forwarded streams, which is a hole rather than a mix-up.
    next: AtomicU64,
    attached: Mutex<BTreeMap<ClientId, Arc<Attached>>>,
    /// What was last broadcast, so an unchanged snapshot is not sent again. Whole-state frames are
    /// idempotent, so this is an economy rather than a correctness rule — but a server that re-publishes
    /// identical state on every command turns a bounded queue into a busy one for no information.
    published: Mutex<Option<AppRuntimeSnapshot>>,
}

impl Clients {
    /// Attach a client, minting its id. `kind` names the listener it arrived on, which is what makes an
    /// id worth reading in a log line.
    pub fn attach(&self, kind: &str, capacity: usize) -> Arc<Attached> {
        let id = ClientId(format!(
            "{kind}-{}",
            self.next.fetch_add(1, Ordering::SeqCst) + 1
        ));
        let attached = Arc::new(Attached {
            id: id.clone(),
            queue: Mutex::new(ClientQueue::with_capacity(capacity)),
            wake: Notify::new(),
            cancel: CancellationToken::new(),
        });
        self.attached
            .lock()
            .expect("clients")
            .insert(id, Arc::clone(&attached));
        attached
    }

    /// Forget a client. Its streams are reaped by the session that owned it — see
    /// [`crate::listen::session`] — because those belong to the server's registry and not to this list.
    pub fn detach(&self, id: &ClientId) {
        self.attached.lock().expect("clients").remove(id);
    }

    pub fn count(&self) -> usize {
        self.attached.lock().expect("clients").len()
    }

    /// One frame to every attached client.
    ///
    /// The list is copied and the lock released before anything is offered: an offer can cancel a client
    /// and wake a task, and neither of those should happen with the roster locked.
    pub fn broadcast(&self, push: Push) {
        for client in self.roster() {
            client.offer(push.clone());
        }
    }

    /// The state one client is handed on arrival, recorded as what everybody has been told.
    ///
    /// **Both halves matter.** A new client needs the current state even when it is the state the others
    /// already have, so this OFFERS rather than publishes. And it records it, because otherwise the first
    /// command that client issues would find nothing published and broadcast state that had not moved —
    /// a snapshot on every session's first command, forever.
    ///
    /// Recording state that only one client received is sound because of who can change it: only a
    /// dispatch can, and every dispatch publishes. So at the moment a client attaches, what is current is
    /// either already what everyone holds or is the very first state there has been.
    pub fn hand_over(&self, attached: &Attached, snapshot: AppRuntimeSnapshot) {
        *self.published.lock().expect("published") = Some(snapshot.clone());
        attached.offer(Push::new(Event::Snapshot {
            snapshot: Box::new(snapshot),
        }));
    }

    /// The current state to every attached client, if it is not what they were last told.
    ///
    /// Answers whether it published, which is what a test asserts on rather than reaching into the
    /// queues to count.
    pub fn publish(&self, snapshot: AppRuntimeSnapshot) -> bool {
        {
            let mut published = self.published.lock().expect("published");
            if published.as_ref() == Some(&snapshot) {
                return false;
            }
            *published = Some(snapshot.clone());
        }
        self.broadcast(Push::new(Event::Snapshot {
            snapshot: Box::new(snapshot),
        }));
        true
    }

    /// Ask every client to go — the shutdown path. The sessions close their own
    /// sockets; this is the request, not the closing.
    pub fn cancel_all(&self) {
        for client in self.roster() {
            client.cancel();
        }
    }

    fn roster(&self) -> Vec<Arc<Attached>> {
        self.attached
            .lock()
            .expect("clients")
            .values()
            .map(Arc::clone)
            .collect()
    }
}
