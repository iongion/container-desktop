//! What a client that has stopped reading costs.
//!
//! The deliberately stalled reader is this file: nothing here ever drains until the
//! assertion does, which is exactly the shape of a client paused on its scrollback while an engine is
//! coming up.

use cdc_runtime::domain::types::resource_sync_protocol::{
    AppRuntimeSnapshot, ConnectOrigin, ConnectProgress, ConnectionPhase,
};
use cdc_server::protocol::{Event, Outbound, Push, Reply, Response};
use cdc_server::queue::{Admission, ClientQueue};

fn snapshot() -> Push {
    Push::new(Event::Snapshot {
        snapshot: Box::new(AppRuntimeSnapshot {
            active: None,
            connections: Vec::new(),
            current_connector: None,
            now: 0,
            os_type: "linux".to_string(),
            phase: ConnectionPhase::Ready,
            running: true,
        }),
    })
}

fn progress(ts: i64) -> Push {
    Push::new(Event::Progress {
        progress: Box::new(ConnectProgress {
            attempt: None,
            code: None,
            connection_id: "host.default.podman.native".to_string(),
            next_retry_at: None,
            origin: Some(ConnectOrigin::User),
            phase: ConnectionPhase::Starting,
            step: None,
            ts,
        }),
    })
}

fn stamps(drained: &[Outbound]) -> Vec<i64> {
    drained
        .iter()
        .filter_map(|frame| match frame {
            Outbound::Pushed(push) => match &push.event {
                Event::Progress { progress } => Some(progress.ts),
                Event::Snapshot { .. } | Event::Stream { .. } => None,
            },
            Outbound::Answer(_) => None,
        })
        .collect()
}

/// A reply to a command, which is the frame kind a queue may never drop.
fn answer(id: &str) -> Response {
    Response::ok(
        id,
        Reply::Connections {
            connections: Vec::new(),
        },
    )
}

#[test]
fn a_reply_is_never_dropped_to_make_room() {
    // A dropped snapshot costs a client nothing — the next one is whole. A dropped REPLY leaves it
    // waiting on a correlation id that will never be answered, which it cannot tell from a server that
    // has not finished, and cannot ask again for.
    let mut queue = ClientQueue::with_capacity(2);
    queue.offer(progress(1));
    queue.offer(progress(2));

    assert_eq!(queue.offer(answer("1")), Admission::Overflowed);
    assert!(
        !Outbound::from(answer("1")).is_droppable(),
        "and it is the frame type that says so, not the queue"
    );
}

#[test]
fn a_reply_displaces_state_the_client_has_not_read() {
    // The room a reply needs comes from superseded snapshots, exactly as a progress line's does.
    let mut queue = ClientQueue::with_capacity(2);
    queue.offer(snapshot());
    queue.offer(progress(1));

    assert_eq!(
        queue.offer(answer("1")),
        Admission::Superseded { snapshots: 1 }
    );
    let drained = queue.drain();
    assert_eq!(drained.len(), 2, "the snapshot went, the log line stayed");
    assert!(matches!(drained[1], Outbound::Answer(_)));
}

#[test]
fn a_newer_snapshot_supersedes_one_the_client_never_read() {
    // Whole-state means an unread snapshot is worth nothing the moment a newer one exists. Queueing
    // both would make a slow client's backlog grow with the number of changes it missed.
    let mut queue = ClientQueue::with_capacity(8);

    assert_eq!(queue.offer(snapshot()), Admission::Queued);
    assert_eq!(
        queue.offer(snapshot()),
        Admission::Superseded { snapshots: 1 }
    );

    assert_eq!(queue.len(), 1, "one state frame, and it is the latest");
}

#[test]
fn progress_is_never_dropped_to_make_room_for_anything() {
    // A gap in a connect trace is a bug report nobody can answer. Snapshots yield to progress; the
    // reverse never happens.
    let mut queue = ClientQueue::with_capacity(3);
    queue.offer(snapshot());
    queue.offer(progress(1));
    queue.offer(progress(2));

    // The queue is full. A fourth frame must displace the SNAPSHOT and keep both log lines.
    assert_eq!(
        queue.offer(progress(3)),
        Admission::Superseded { snapshots: 1 }
    );

    assert_eq!(
        stamps(&queue.drain()),
        vec![1, 2, 3],
        "every line, in the order it happened"
    );
}

#[test]
fn a_client_that_cannot_keep_up_with_the_log_overflows_rather_than_stalling_the_machine() {
    // The honest end of the rule: when the queue holds nothing but frames that may not be dropped,
    // something has to give, and it is the CLIENT rather than the trace or the state machine.
    let mut queue = ClientQueue::with_capacity(2);
    queue.offer(progress(1));
    queue.offer(progress(2));

    assert_eq!(queue.offer(progress(3)), Admission::Overflowed);

    assert_eq!(
        stamps(&queue.drain()),
        vec![1, 2],
        "the queue is left intact for whoever reports the disconnection"
    );
}

#[test]
fn state_is_dropped_rather_than_evicting_a_log_line() {
    // The mirror of the case above, and the reason `Dropped` is distinct from `Overflowed`: losing a
    // snapshot costs nothing, because the next one a client receives is whole.
    let mut queue = ClientQueue::with_capacity(2);
    queue.offer(progress(1));
    queue.offer(progress(2));

    assert_eq!(queue.offer(snapshot()), Admission::Dropped);

    assert_eq!(queue.len(), 2, "the log is untouched");
    assert_eq!(stamps(&queue.drain()), vec![1, 2]);
}

#[test]
fn draining_empties_the_queue_and_keeps_the_order_it_was_offered_in() {
    let mut queue = ClientQueue::with_capacity(8);
    queue.offer(progress(1));
    queue.offer(snapshot());
    queue.offer(progress(2));
    assert!(
        !queue.is_empty(),
        "a queue holding frames is not empty — the half a writer parks on"
    );

    let drained = queue.drain();

    assert_eq!(drained.len(), 3);
    assert_eq!(stamps(&drained), vec![1, 2]);
    assert!(queue.is_empty(), "a drained queue holds nothing");
}

#[test]
fn a_queue_that_is_offered_nothing_stays_empty() {
    // `is_empty` is what a writer parks on, so it has to be true before anything happens rather than
    // only after a drain.
    let queue = ClientQueue::with_capacity(4);

    assert!(queue.is_empty());
    assert_eq!(queue.len(), 0);
}
