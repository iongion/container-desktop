//! One client's outbound queue, bounded.
//!
//! **A concern in-process IPC never had.** IPC delivered to a renderer in the same process; a
//! socket delivers to a peer that may stop reading. The rule that falls out of that is not "buffer
//! more" — it is that the connection state machine must never wait on a client, because a machine
//! that stalls is a machine whose `ssh -NL` sits half-open while a client is paused on a scrollback.
//!
//! Two kinds of frame, treated differently, and [`Outbound::is_droppable`] is where the difference is
//! stated so a queue cannot be written that forgets it:
//!
//! - a **snapshot** is whole-state, so an unread one is worth nothing once a newer one exists. It is
//!   superseded rather than queued behind, which also means a slow client's backlog cannot grow with
//!   the number of state changes it missed.
//! - **progress** is a LOG. A gap in a connect trace is a bug report nobody can answer, so a progress
//!   line is never dropped to make room for anything.
//!
//! Those two together decide what happens when a client is hopeless: the queue fills with frames that
//! may not be dropped, and the honest answer is to drop the CLIENT rather than the frames or the
//! invariant. [`Admission::Overflowed`] says so, and it is the caller's cue to disconnect it.

use std::collections::VecDeque;

use crate::protocol::Outbound;

/// What happened to a frame that was offered to a client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// Queued, with nothing displaced.
    Queued,
    /// Queued, having superseded state the client had not read yet. The count is how many — worth
    /// reporting rather than swallowing, because a client that supersedes constantly is one whose
    /// transport is too slow for the change rate, and that is operational information.
    Superseded { snapshots: usize },
    /// The frame itself was dropped: it was state, and the client is already holding as much as it
    /// may. The client keeps its place — the next snapshot it does receive is whole.
    Dropped,
    /// The queue is full of frames that must not be dropped. **Disconnect the client**; do not wait
    /// for it, and do not grow the queue.
    Overflowed,
}

/// A bounded queue of frames waiting to be written to one client.
#[derive(Debug)]
pub struct ClientQueue {
    capacity: usize,
    frames: VecDeque<Outbound>,
}

impl ClientQueue {
    /// A queue holding at most `capacity` frames.
    ///
    /// Capacity is in FRAMES rather than bytes, because what it is protecting against is a client
    /// that has stopped reading, not one that is reading large messages slowly.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            capacity,
            frames: VecDeque::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Offer a frame. Never blocks, and never waits on the client.
    ///
    /// Takes anything that IS an outbound frame, so a caller with a [`Push`](crate::protocol::Push) or a
    /// [`Response`](crate::protocol::Response) in hand does not have to name the union to queue it.
    pub fn offer(&mut self, frame: impl Into<Outbound>) -> Admission {
        let frame = frame.into();
        if frame.is_droppable() {
            return self.offer_state(frame);
        }
        self.offer_log(frame)
    }

    /// State: supersede whatever unread state is already queued, since only the latest matters.
    fn offer_state(&mut self, frame: Outbound) -> Admission {
        let superseded = self.discard_droppable();
        if self.frames.len() >= self.capacity {
            // Nothing left to displace and no room: the client is behind on its LOG, which may not be
            // dropped. Losing this state costs nothing — the next snapshot is whole.
            return Admission::Dropped;
        }
        self.frames.push_back(frame);
        if superseded > 0 {
            return Admission::Superseded {
                snapshots: superseded,
            };
        }
        Admission::Queued
    }

    /// A log line: room is made from state, and never from another log line.
    fn offer_log(&mut self, frame: Outbound) -> Admission {
        if self.frames.len() < self.capacity {
            self.frames.push_back(frame);
            return Admission::Queued;
        }
        let superseded = self.discard_droppable();
        if self.frames.len() >= self.capacity {
            return Admission::Overflowed;
        }
        self.frames.push_back(frame);
        Admission::Superseded {
            snapshots: superseded,
        }
    }

    /// Remove every queued frame that may be dropped, answering how many there were.
    fn discard_droppable(&mut self) -> usize {
        let before = self.frames.len();
        self.frames.retain(|frame| !frame.is_droppable());
        before - self.frames.len()
    }

    /// Take everything waiting, oldest first. What a writer does when the client is readable again.
    pub fn drain(&mut self) -> Vec<Outbound> {
        self.frames.drain(..).collect()
    }
}
