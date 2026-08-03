//! Two commands at once: what the per-connection slot serialises and what it deliberately does
//! not.
//!
//! Split from the parent for the 620-line cap; the fixtures stay there and arrive with
//! `use super::*`.

use super::*;
#[tokio::test]
async fn a_read_answers_while_a_connect_is_still_in_flight() {
    // **The measurement this exists for is 51 to 56 SECONDS**, taken live against podman with the
    // engine held down: a retry sits inside `spawn_service` polling a socket that never answers, and
    // every other client's every command used to wait behind it. The gate stands exactly there.
    let gate = Gate::shut();
    let server = Arc::new(harness::gated_server(engine_is_bound(), gate.clone()));

    let connect = alongside(&server, CONNECTION);
    gate.reached().await;

    let (listed, snapshot) = tokio::time::timeout(harness::PATIENCE, async {
        (
            server
                .dispatch(
                    &client(),
                    Request::new("list", Command::ListConnections),
                    &Unheard,
                )
                .await,
            server
                .dispatch(
                    &client(),
                    Request::new("now", Command::GetRuntimeSnapshot),
                    &Unheard,
                )
                .await,
        )
    })
    .await
    .expect("a read answers while a connect is still in flight");

    assert!(
        matches!(
            listed.0.outcome,
            Outcome::Ok {
                reply: Reply::Connections { .. }
            }
        ),
        "and it answers with the document, not with whatever the connect was doing: {:?}",
        listed.0.outcome
    );
    assert!(
        matches!(
            snapshot.0.outcome,
            Outcome::Ok {
                reply: Reply::Snapshot { .. }
            }
        ),
        "and so does the projection, which is the read a client holds a screen open on: {:?}",
        snapshot.0.outcome
    );
    gate.open();
    connect.await.expect("the connect finishes");
}

#[tokio::test]
async fn two_connects_do_not_run_at_once() {
    // The other half of the split, and the reason the mutating side keeps a lock of its own.
    // `connect` REBUILDS the machine from the document every time, so two of them overlapping would
    // leave the first one's services running with nothing holding their ids — an `ssh -NL` reparented
    // to init, which is the leak the design names, arriving through the door the split opened.
    let gate = Gate::shut();
    let server = Arc::new(harness::gated_server(engine_is_bound(), gate.clone()));

    let first = alongside(&server, CONNECTION);
    gate.reached().await;
    let second = alongside(&server, CONNECTION);

    assert!(
        tokio::time::timeout(BRIEF, gate.reached()).await.is_err(),
        "the second connect reached the engine while the first was still there"
    );

    gate.open();
    gate.reached().await;
    gate.open();
    first.await.expect("the first connect finishes");
    second.await.expect("the second connect finishes");
}

#[tokio::test]
async fn a_connect_runs_while_another_connection_is_still_connecting() {
    // **The symptom, with two engines configured and one of them down**: the healthy one's `connect` —
    // and, worse, its own watcher's `dropped`, which comes through the same door — used to queue behind
    // the sick one's attempt for the 51 to 56 seconds `spawn_service` spends polling a socket that never
    // answers. So a working connection rendered `ready` for a minute after its engine had gone, and
    // began its own retry cycle a minute late. The lock is on the connection's SLOT, so these two never
    // meet; `two_connects_do_not_run_at_once` is the half that must not move with it.
    let gate = Gate::shut();
    let server = Arc::new(harness::gated_server(two_connections_bound(), gate.clone()));

    let first = alongside(&server, CONNECTION);
    gate.reached().await;
    let second = alongside(&server, OTHER_CONNECTION);

    tokio::time::timeout(harness::PATIENCE, gate.reached())
        .await
        .expect("a connect on another connection waited out the first one's attempt");

    gate.open();
    gate.open();
    first.await.expect("the first connect finishes");
    second.await.expect("the second connect finishes");
}

#[tokio::test]
async fn the_supervisors_reads_answer_for_a_connection_that_is_no_longer_held() {
    // **A watcher and a command race by construction**, and this is the losing side of that race:
    // `supervise` decides to drop or retry a connection, takes the lock, and finds that a `disconnect`
    // or a `remove_connection` got there first. Answering "nothing happened" is what makes the watcher
    // stand down; a panic or a machine built on demand would have a departed connection come back to
    // life because something was still watching it.
    let server = server(seeded());

    assert_eq!(server.liveness("host.default.podman.native"), None);
    assert!(server.watched().is_empty());
    assert!(
        server
            .watch_events("host.default.podman.native")
            .await
            .is_none()
    );
    assert!(server.probe("host.default.podman.native").await.is_none());
    assert!(
        server
            .dropped(
                "host.default.podman.native",
                cdc_runtime::domain::types::diagnostic::DiagnosticCode::ApiUnreachable
            )
            .await
            .is_empty()
    );
    assert!(
        server
            .reconnect("host.default.podman.native", &Unheard)
            .await
            .is_empty()
    );
}
