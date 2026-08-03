//! Fan-out, and what a client that has stopped reading costs.
//!
//! `tests/queue.rs` asserts the queue's rules in isolation; this asserts what the roster does WITH them —
//! that a snapshot reaches everyone, that an overflow disconnects the one client it belongs to and nobody
//! else, and that a slow client cannot make an offer wait.

use std::sync::Arc;

use cdc_runtime::domain::types::resource_sync_protocol::{
    AppRuntimeSnapshot, ConnectOrigin, ConnectProgress, ConnectionPhase,
};
use cdc_server::listen::clients::Clients;
use cdc_server::protocol::{Event, Outbound, Push, Reply, Response};
use cdc_server::queue::Admission;

use crate::harness::PATIENCE;

fn attached_snapshot(
    clients: &Clients,
    capacity: usize,
) -> Arc<cdc_server::listen::clients::Attached> {
    let client = clients.attach("local", capacity);
    clients.hand_over(&client, snapshot("linux"));
    client
}

fn snapshot(os: &str) -> AppRuntimeSnapshot {
    AppRuntimeSnapshot {
        active: None,
        connections: Vec::new(),
        current_connector: None,
        now: 0,
        os_type: os.to_string(),
        phase: ConnectionPhase::Ready,
        running: true,
    }
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

#[test]
fn every_client_gets_an_id_of_its_own_across_listeners() {
    // One counter for every listener, because two clients sharing an id would have one of them reap the
    // other's forwarded streams — a hole rather than a mix-up.
    let clients = Clients::default();

    let first = clients.attach("local", 8);
    let second = clients.attach("local", 8);
    let remote = clients.attach("remote", 8);

    assert_eq!(first.id().0, "local-1");
    assert_eq!(second.id().0, "local-2");
    assert_eq!(
        remote.id().0,
        "remote-3",
        "the counter is shared, so a local and a remote client can never collide"
    );
    assert_eq!(clients.count(), 3);
}

#[test]
fn a_push_reaches_every_attached_client() {
    let clients = Clients::default();
    let first = clients.attach("local", 8);
    let second = clients.attach("local", 8);

    clients.broadcast(progress(1));

    assert_eq!(first.take().len(), 1, "the client that asked");
    assert_eq!(
        second.take().len(),
        1,
        "and the one that did not: progress is the server narrating its own work"
    );
}

#[test]
fn a_detached_client_hears_nothing_more() {
    let clients = Clients::default();
    let gone = clients.attach("local", 8);
    let staying = clients.attach("local", 8);

    clients.detach(gone.id());
    clients.broadcast(progress(1));

    assert_eq!(clients.count(), 1);
    assert!(gone.take().is_empty());
    assert_eq!(staying.take().len(), 1);
}

#[test]
fn the_state_a_client_arrives_to_counts_as_state_it_has_been_told() {
    // Otherwise the first command it issues finds nothing published and broadcasts state that has not
    // moved — a redundant snapshot on every session's first command, forever.
    let clients = Clients::default();
    let client = attached_snapshot(&clients, 8);

    let published_again = clients.publish(snapshot("linux"));

    assert!(!published_again, "it already has this");
    assert_eq!(client.take().len(), 1, "and it was handed it exactly once");
}

#[test]
fn state_is_published_only_when_it_has_moved() {
    // Whole-state frames are idempotent, so re-publishing identical state is not wrong — it is a bounded
    // queue kept busy for no information, on every command every client issues.
    let clients = Clients::default();
    let client = clients.attach("local", 8);

    assert!(clients.publish(snapshot("linux")), "the first is news");
    assert!(!clients.publish(snapshot("linux")), "the second is not");
    assert!(clients.publish(snapshot("darwin")), "a change is");

    // ONE frame, not two: the client never drained, so the second snapshot superseded the first. That is
    // the queue's rule showing through — only the latest whole state is worth anything.
    let frames = client.take();
    assert_eq!(frames.len(), 1, "the latest state, once: {frames:?}");
    assert!(matches!(
        &frames[0],
        Outbound::Pushed(push) if matches!(&push.event, Event::Snapshot { snapshot } if snapshot.os_type == "darwin")
    ));
}

#[test]
fn a_client_that_stops_reading_is_disconnected_rather_than_queued_for() {
    // The `Admission::Overflowed` rule, and the whole of it: never grow the queue, never drop a log
    // line, drop the CLIENT. Nothing here ever drains — the deliberately stalled reader task 6 asks for.
    let clients = Clients::default();
    let stalled = clients.attach("local", 2);
    // Room for the whole burst, which is what makes it the CONTROL: the only difference between the two
    // is how far behind each is allowed to fall.
    let healthy = clients.attach("local", 8);

    for ts in 0..3 {
        clients.broadcast(progress(ts));
    }

    assert!(
        stalled.cancelled().is_cancelled(),
        "the third undroppable frame had nowhere to go"
    );
    assert!(
        !healthy.cancelled().is_cancelled(),
        "and the client next to it is untouched"
    );
}

#[test]
fn an_overflowing_client_keeps_the_log_it_already_had() {
    // What it holds is a complete PREFIX of the log rather than a hole in the middle, which is what makes
    // disconnecting it honest: whoever reads its output can see exactly where it stopped.
    let clients = Clients::default();
    let stalled = clients.attach("local", 2);

    for ts in 0..5 {
        clients.broadcast(progress(ts));
    }

    let held = stalled.take();
    assert_eq!(held.len(), 2, "no more than its capacity: {held:?}");
    assert!(
        matches!(
            &held[0],
            Outbound::Pushed(push) if matches!(&push.event, Event::Progress { progress } if progress.ts == 0)
        ),
        "and it is the oldest lines it kept, not the newest"
    );
}

#[test]
fn a_slow_client_never_makes_a_snapshot_wait() {
    // The invariant task 6 exists for: an offer returns a verdict, it does not block. A snapshot into a
    // full queue is dropped and says so.
    let clients = Clients::default();
    let stalled = clients.attach("local", 1);
    clients.broadcast(progress(1));

    let admission = stalled.offer(Push::new(Event::Snapshot {
        snapshot: Box::new(snapshot("linux")),
    }));

    assert_eq!(admission, Admission::Dropped);
    assert!(
        !stalled.cancelled().is_cancelled(),
        "a dropped snapshot is not a reason to disconnect anyone: the next one is whole"
    );
}

#[tokio::test]
async fn a_waiting_writer_is_woken_by_a_frame() {
    // The writer is asleep almost always, and a frame offered from another task is what wakes it. A lost
    // wakeup here would be a client that receives nothing until it happens to be woken by something else.
    let clients = Arc::new(Clients::default());
    let client = clients.attach("local", 8);

    let waiting = tokio::spawn({
        let client = Arc::clone(&client);
        async move { client.next_batch().await }
    });
    tokio::task::yield_now().await;
    clients.broadcast(progress(7));

    let batch = tokio::time::timeout(PATIENCE, waiting)
        .await
        .expect("the writer wakes")
        .expect("the task did not panic")
        .expect("a batch rather than a cancellation");
    assert_eq!(batch.len(), 1);
}

#[tokio::test]
async fn a_frame_offered_before_the_wait_is_still_found() {
    // The lost-wakeup case in the other order: offered, THEN waited on. A permit stored while nobody was
    // listening is what makes this work, and getting it wrong is a writer that sleeps holding frames.
    let clients = Clients::default();
    let client = clients.attach("local", 8);

    clients.broadcast(progress(1));

    let batch = tokio::time::timeout(PATIENCE, client.next_batch())
        .await
        .expect("what was already queued needs no wakeup")
        .expect("a batch");
    assert_eq!(batch.len(), 1);
}

#[tokio::test]
async fn a_cancelled_client_stops_waiting() {
    let clients = Clients::default();
    let client = clients.attach("local", 8);

    client.cancel();

    assert!(
        tokio::time::timeout(PATIENCE, client.next_batch())
            .await
            .expect("cancellation is not a hang")
            .is_none(),
        "and it says finished rather than empty"
    );
}

#[tokio::test]
async fn a_cancelled_client_still_delivers_what_it_already_held() {
    // Shutdown cancels every client, and the frames already queued are the last thing a client renders. A
    // writer that dropped them on cancellation would lose the final progress lines of a clean stop.
    let clients = Clients::default();
    let client = clients.attach("local", 8);
    clients.broadcast(progress(1));

    client.cancel();

    let batch = tokio::time::timeout(PATIENCE, client.next_batch())
        .await
        .expect("no hang")
        .expect("the queue is drained before the session ends");
    assert_eq!(batch.len(), 1);
}

#[test]
fn shutdown_asks_every_client_to_go() {
    let clients = Clients::default();
    let first = clients.attach("local", 8);
    let second = clients.attach("remote", 8);

    clients.cancel_all();

    assert!(first.cancelled().is_cancelled());
    assert!(second.cancelled().is_cancelled());
}

#[test]
fn a_reply_and_a_push_share_one_ordered_queue() {
    // One writer, one queue, one order — which is what keeps a progress line out of the middle of a
    // reply. Both kinds go in, and they come out in the order they went in.
    let clients = Clients::default();
    let client = clients.attach("local", 8);

    client.offer(progress(1));
    client.offer(Response::ok(
        "1",
        Reply::Connections {
            connections: Vec::new(),
        },
    ));
    client.offer(progress(2));

    let frames = client.take();
    assert!(matches!(frames[0], Outbound::Pushed(_)));
    assert!(matches!(frames[1], Outbound::Answer(_)));
    assert!(matches!(frames[2], Outbound::Pushed(_)));
}
