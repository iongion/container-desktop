//! What the server owns, and what it refuses to do on a client's behalf.
//!
//! The fake capabilities are `cdc-runtime`'s own, reached with `#[path]` rather than copied: one fake
//! set, parameterized, is the rule this workspace already follows for `tests/fakes/` and
//! `tests/harness/`. A second `MemoryFs` here would be a second thing to keep in step.

/// `list_engine_contexts`, split out for the 620-line cap — see the module.
///
/// `#[path]`, because a test target rooted at `tests/server.rs` resolves a bare `mod` against
/// `tests/` rather than against `tests/server/`.
/// concurrency, split out for the 620-line cap — see the module.
///
/// `#[path]`, because a test target rooted at `tests/server.rs` resolves a bare `mod`
/// against `tests/` rather than against `tests/server/`.
#[path = "server/concurrency.rs"]
mod concurrency;
#[path = "server/contexts.rs"]
mod contexts;
#[path = "../../cdc-runtime/tests/fakes/mod.rs"]
mod fakes;
#[path = "harness/mod.rs"]
mod harness;

use std::sync::Arc;

use cdc_runtime::capabilities::clock::Clock;
use cdc_runtime::domain::types::command_proxy_protocol::CommandProxyResult;
use cdc_runtime::domain::types::connection::Connection;
use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_runtime::domain::types::resource_sync_protocol::ConnectOrigin;
use cdc_server::protocol::{Command, Event, Outcome, Reply, Request};
use cdc_server::server::{MachineBuilder, Server};
use serde_json::{Value, json};

use crate::fakes::{FakeClock, Gate, Heard, MemoryFs, Unheard};
use crate::harness::{
    CONNECTION, OTHER_CONNECTION, SETTINGS, client, dispatched, engine_is_bound, proxy,
    running_server, seeded, server, server_on, streaming_server, two_connections_bound,
};

async fn ask<B: MachineBuilder>(
    server: &Server<MemoryFs, B, impl Clock>,
    command: Command,
) -> Reply {
    let (response, pushes) = server
        .dispatch(&client(), Request::new("1", command), &Unheard)
        .await;
    assert!(
        pushes.is_empty(),
        "a document command publishes nothing on its own: {pushes:?}"
    );
    match response.outcome {
        Outcome::Ok { reply } => reply,
        Outcome::Err { diagnostic } => panic!("refused: {diagnostic:?}"),
    }
}

fn connections(reply: Reply) -> Vec<Connection> {
    match reply {
        Reply::Connections { connections } => connections,
        other => panic!("expected connections, got {other:?}"),
    }
}

#[tokio::test]
async fn listing_answers_the_connections_the_document_holds() {
    let server = server(seeded());

    let listed = connections(ask(&server, Command::ListConnections).await);

    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, "host.default.podman.native");
}

#[tokio::test]
async fn a_mutation_answers_the_list_it_produced() {
    // So a client never has to ask again to find out what it just did — which is also what keeps two
    // clients consistent without either of them polling.
    let server = server(seeded());

    let after = connections(
        ask(
            &server,
            Command::RemoveConnection {
                connection_id: "host.default.podman.native".to_string(),
            },
        )
        .await,
    );

    assert!(after.is_empty(), "the removal is reflected in the answer");
}

#[tokio::test]
async fn creating_a_connection_writes_it_whole_and_answers_the_list() {
    // The connection is carried whole rather than as fields, because the document persists exactly six
    // of them and the core is not the thing that picks.
    let fs = seeded();
    let server = server(fs.clone());
    let mut created = connections(ask(&server, Command::ListConnections).await)
        .pop()
        .expect("the seeded one");
    created.id = "host.default.docker.native".to_string();
    created.name = "docker-native".to_string();

    let after = connections(
        ask(
            &server,
            Command::CreateConnection {
                connection: Box::new(created),
            },
        )
        .await,
    );

    assert_eq!(after.len(), 2, "the answer is the list it produced");
    let written: Value =
        serde_json::from_str(&fs.read(SETTINGS).expect("written")).expect("valid JSON");
    assert_eq!(
        written.pointer("/connections/1/id"),
        Some(&Value::String("host.default.docker.native".to_string()))
    );
}

#[tokio::test]
async fn a_document_that_cannot_be_read_is_refused_rather_than_answered_empty() {
    // The file is shared with the desktop app, so an unreadable one is a real state. Answering an
    // empty list would tell a client every connection had been deleted.
    let server = server(MemoryFs::seeded(SETTINGS, "{ this is not json"));

    let (response, _) = dispatched(&server, Request::new("1", Command::ListConnections)).await;

    let Outcome::Err { diagnostic } = response.outcome else {
        panic!("an unreadable document is not an empty one");
    };
    assert_eq!(
        diagnostic.code,
        DiagnosticCode::NotChecked,
        "and the reason carries no filesystem path, which an exported frame must not carry"
    );
    assert!(diagnostic.params.is_empty());
}

#[tokio::test]
async fn a_mutation_keeps_the_keys_this_core_does_not_model() {
    // The whole of at the server's edge: the file is shared with the desktop app, and a
    // connection edit that dropped the user's AI configuration is the most destructive thing this
    // codebase could do.
    let fs = seeded();
    let server = server(fs.clone());

    ask(
        &server,
        Command::UpdateConnection {
            connection_id: "host.default.podman.native".to_string(),
            partial: json!({ "name": "renamed" }),
        },
    )
    .await;

    let written: Value = serde_json::from_str(&fs.read(SETTINGS).expect("the file was written"))
        .expect("valid JSON");
    assert_eq!(
        written.pointer("/ai/model"),
        Some(&Value::String("llama3".to_string())),
        "a key the core does not model survived a connection edit: {written}"
    );
    assert_eq!(
        written.pointer("/theme"),
        Some(&Value::String("dark".to_string()))
    );
    assert_eq!(
        written.pointer("/connections/0/name"),
        Some(&Value::String("renamed".to_string())),
        "and the edit itself landed"
    );
}

#[tokio::test]
async fn a_snapshot_lists_every_connection_and_names_no_primary() {
    // `currentConnector` is always absent, and that is the design rather than a gap: `connectHostClient`
    // was written not to mutate a shared "current" so several connections can run at once, and which
    // one is primary is a client presentation choice.
    let server = server(seeded());

    let reply = ask(&server, Command::GetRuntimeSnapshot).await;
    let Reply::Snapshot { snapshot } = reply else {
        panic!("expected a snapshot");
    };

    assert_eq!(snapshot.connections.len(), 1);
    assert_eq!(snapshot.connections[0].id, "host.default.podman.native");
    // A LISTED connection answers what it can do, running or not — a client draws its offer list from
    // this, and "not running" is not "cannot do anything".
    let capabilities = snapshot.connections[0]
        .capabilities
        .as_ref()
        .expect("a registered connector answers its table without being up");
    assert!(capabilities.extensions.machines, "podman manages machines");
    assert!(!capabilities.extensions.swarm, "and has no swarm");
    assert!(snapshot.current_connector.is_none());
    assert!(
        snapshot.active.is_none(),
        "nothing is running, and an empty list is not the same claim as none"
    );
    assert!(snapshot.running);
    assert_eq!(snapshot.os_type, "Linux");
}

#[tokio::test]
async fn a_snapshot_carries_the_clock_its_retry_stamps_are_measured_on() {
    // **The finding: the protocol carried no NOW.** `ConnectionRuntimeInfo::next_retry_at` is on the
    // core's monotonic clock, so a client holding a snapshot could see THAT a retry was pending and
    // never WHEN — the only way to learn a delay was to have been attached in time to catch the one
    // progress line stamping both, and a client attaching DURING a reconnect never sees that line.
    //
    // Read at the moment the projection is assembled, and asserted by MOVING the clock between two
    // snapshots: a `now` copied from anywhere else, or stamped once at startup, would not follow.
    let clock = FakeClock::at(0);
    let server = server_on(engine_is_bound(), &[], clock.clone());
    let Reply::Snapshot { snapshot } = ask(&server, Command::GetRuntimeSnapshot).await else {
        panic!("expected a snapshot");
    };
    assert_eq!(snapshot.now, 0, "the clock this server was handed");

    clock.advance(7_500);
    let Reply::Snapshot { snapshot } = ask(&server, Command::GetRuntimeSnapshot).await else {
        panic!("expected a snapshot");
    };

    assert_eq!(
        snapshot.now, 7_500,
        "every snapshot is stamped when it is taken, not when the server started"
    );
}

#[tokio::test]
async fn a_command_naming_a_connection_that_is_not_there_is_refused_rather_than_ignored() {
    let server = server(seeded());

    let (response, pushes) = dispatched(
        &server,
        Request::new(
            "1",
            Command::Connect {
                connection_id: "host.default.docker.native".to_string(),
                origin: ConnectOrigin::User,
            },
        ),
    )
    .await;

    assert!(
        matches!(response.outcome, Outcome::Err { .. }),
        "a connect for a connection nobody stored cannot silently succeed"
    );
    assert!(pushes.is_empty());
}

fn forwarded(reply: Reply) -> CommandProxyResult {
    match reply {
        Reply::Proxied { result } => *result,
        other => panic!("expected a forwarded answer, got {other:?}"),
    }
}

#[tokio::test]
async fn connecting_streams_every_progress_line_the_attempt_published() {
    // The trace is the whole reason a client attaches rather than polls, and it reaches one THROUGH
    // THE LISTENER: an attempt lasts as long as an engine takes to come up, so lines batched into the
    // reply would arrive a minute after they were true.
    let server = running_server(engine_is_bound());
    let heard = Heard::default();

    let (response, pushes) = server
        .dispatch(
            &client(),
            Request::new(
                "1",
                Command::Connect {
                    connection_id: "host.default.podman.native".to_string(),
                    origin: ConnectOrigin::User,
                },
            ),
            &heard,
        )
        .await;

    assert!(matches!(response.outcome, Outcome::Ok { .. }));
    assert!(
        !heard.lines().is_empty(),
        "the attempt published nothing a client could see"
    );
    assert!(
        pushes.is_empty(),
        "and nothing comes back to be published a second time: {pushes:?}"
    );
}

#[tokio::test]
async fn disconnecting_a_running_connection_publishes_that_it_went_down() {
    // The other half, and the one a client's connect view ends on. `disconnect` answering nothing
    // would leave a connection shown as live until something else happened to refresh it.
    let server = running_server(engine_is_bound());
    dispatched(
        &server,
        Request::new(
            "1",
            Command::Connect {
                connection_id: "host.default.podman.native".to_string(),
                origin: ConnectOrigin::User,
            },
        ),
    )
    .await;

    let (_, pushes) = dispatched(
        &server,
        Request::new(
            "2",
            Command::Disconnect {
                connection_id: "host.default.podman.native".to_string(),
            },
        ),
    )
    .await;

    assert_eq!(
        pushes.len(),
        1,
        "one line: the connection announcing it is idle — {pushes:?}"
    );
    assert!(matches!(pushes[0].event, Event::Progress { .. }));

    // **And a reader arriving afterwards is told the same thing.** The push above is written inside
    // the operation; what a LATER client reads is the running set, which `disconnect` leaves by
    // dropping the guard and only then removing the entry. Asserting the push alone would pass
    // against a server that announced `idle` and went on listing the connection as active.
    let Reply::Snapshot { snapshot } = ask(&server, Command::GetRuntimeSnapshot).await else {
        panic!("expected a snapshot");
    };
    assert!(
        snapshot.active.is_none(),
        "a disconnected connection is not running, and an empty list is not the same claim as none: \
         {:?}",
        snapshot.active
    );
}

#[tokio::test]
async fn a_forwarded_request_brings_the_connection_up_and_answers_the_engine() {
    // `commandProxyBroker.ts` awaits `ensureConnected` before it asks for a driver, and it does it
    // through the SAME connect the client could have asked for — one path that starts a connection
    // rather than two that can disagree. Whatever that connect published travels back with the answer.
    let server = running_server(engine_is_bound());
    let heard = Heard::default();

    let (response, _) = server
        .dispatch(
            &client(),
            Request::new(
                "1",
                proxy(Some(CONNECTION), json!({ "url": "/containers/json" })),
            ),
            &heard,
        )
        .await;

    let Outcome::Ok { reply } = response.outcome else {
        panic!("the forward was refused: {response:?}");
    };
    let CommandProxyResult::Buffered(answer) = forwarded(reply) else {
        panic!("a plain request must not come back as a stream handle");
    };
    assert!(answer.ok);
    assert_eq!(answer.status, Some(200));
    assert_eq!(answer.data, Some(json!([])));
    assert!(
        !heard.lines().is_empty(),
        "the connect it performed is published, not swallowed"
    );
}

#[tokio::test]
async fn a_forward_through_a_connection_that_is_already_up_connects_nothing() {
    // Idempotent on the original's own test: a connection the server is holding whose phase says
    // `ready` needs nothing. Reconnecting on every request would tear a tunnel down under live traffic.
    let server = running_server(engine_is_bound());
    dispatched(&server, connecting()).await;

    let (response, pushes) = dispatched(
        &server,
        Request::new("2", proxy(Some(CONNECTION), json!({ "url": "/_ping" }))),
    )
    .await;

    assert!(matches!(response.outcome, Outcome::Ok { .. }));
    assert!(
        pushes.is_empty(),
        "nothing was connected, so nothing was published: {pushes:?}"
    );
}

#[tokio::test]
async fn a_forward_through_a_connection_that_is_not_ready_brings_it_up_again() {
    // The other half of the same rule: anything that is NOT `ready` is connected, including one that
    // is mid-back-off, because a forwarded request is explicit intent to use it. A first connect that
    // failed leaves its machine in the table saying `failed`, which is exactly that case.
    let fs = seeded();
    let server = running_server(fs.clone());
    dispatched(&server, connecting()).await;
    // The engine turns up between the two.
    fs.put("/run/podman.sock", "");

    let heard = Heard::default();
    let (response, _) = server
        .dispatch(
            &client(),
            Request::new("2", proxy(Some(CONNECTION), json!({ "url": "/_ping" }))),
            &heard,
        )
        .await;

    assert!(matches!(response.outcome, Outcome::Ok { .. }));
    assert!(
        !heard.lines().is_empty(),
        "and this one DID connect, so it published — unlike a forward through one already up"
    );
}

#[tokio::test]
async fn a_forward_that_names_no_connection_is_refused_rather_than_sent_to_a_default() {
    // The original falls back to its primary connection; this core deliberately has none, because
    // `connectHostClient` was written not to mutate a shared "current" so several connections could
    // run at once. Guessing one here would put that coupling back.
    let server = running_server(engine_is_bound());

    let (response, _) = dispatched(
        &server,
        Request::new("1", proxy(None, json!({ "url": "/_ping" }))),
    )
    .await;

    let Outcome::Err { diagnostic } = response.outcome else {
        panic!("a forward with no route must not be sent anywhere");
    };
    assert_eq!(diagnostic.code, DiagnosticCode::ProxyRequestInvalid);
    assert_eq!(
        diagnostic.params.get("field"),
        Some(&Value::String("connection".to_string()))
    );
}

#[tokio::test]
async fn a_forward_the_connection_refuses_reaches_the_client_as_its_own_code() {
    // The machine's refusal is already vocabulary — a code and typed parameters — so it
    // travels whole rather than being flattened into a generic failure. A client renders the field it
    // has to fix.
    let server = running_server(engine_is_bound());

    let (response, _) = dispatched(
        &server,
        Request::new(
            "1",
            proxy(
                Some(CONNECTION),
                json!({ "url": "/containers/json", "params": { "all": true } }),
            ),
        ),
    )
    .await;

    let Outcome::Err { diagnostic } = response.outcome else {
        panic!("a query this core cannot serialize must not be sent");
    };
    assert_eq!(diagnostic.code, DiagnosticCode::ProxyRequestInvalid);
    assert_eq!(
        diagnostic.params.get("field"),
        Some(&Value::String("params".to_string())),
        "the machine's own parameters, not an empty refusal"
    );
}

#[tokio::test]
async fn a_forward_naming_a_connection_nobody_stored_is_refused() {
    let server = running_server(engine_is_bound());

    let (response, _) = dispatched(
        &server,
        Request::new(
            "1",
            proxy(
                Some("host.default.docker.native"),
                json!({ "url": "/_ping" }),
            ),
        ),
    )
    .await;

    assert!(matches!(response.outcome, Outcome::Err { .. }));
}

#[tokio::test]
async fn a_streaming_forward_is_named_and_held_for_the_client_that_asked() {
    // The two halves of a stream reply: the client is handed a HANDLE at once, and the body arrives
    // afterwards as frames keyed by it. Holding the stream is what lets the client's own socket be
    // written to without the command surface waiting on a log that has nothing to say.
    let server = streaming_server(engine_is_bound(), &["first ", "second"]);

    let (response, _) = dispatched(
        &server,
        Request::new(
            "1",
            proxy(
                Some(CONNECTION),
                json!({ "url": "/containers/web/logs?follow=1", "responseType": "stream" }),
            ),
        ),
    )
    .await;

    let Outcome::Ok { reply } = response.outcome else {
        panic!("the stream was refused: {response:?}");
    };
    let CommandProxyResult::Stream(handle) = forwarded(reply) else {
        panic!("a stream request must not come back buffered");
    };
    assert_eq!(handle.stream_id, "cps-1");
    assert!(handle.stream);
    assert!(server.streams().is_open(&handle.stream_id));

    // Bounded, and that bound is not tidiness: a mutant that removes a loop's exit makes the body
    // yield forever, and an unbounded `while let` then allocates until the kernel OOM-kills the whole
    // cgroup — which under `cargo mutants` is the run's own scope and every sibling job in it.
    let mut delivered = Vec::new();
    while let Some(push) = server.streams().next_frame(&handle.stream_id).await {
        assert!(delivered.len() <= 64, "the stream never ended");
        delivered.push(push);
    }
    assert_eq!(
        delivered.len(),
        3,
        "two chunks and the end that tells a client to stop reassembling"
    );
    assert!(delivered.iter().all(|push| !push.is_droppable()));
}

#[tokio::test]
async fn a_client_that_goes_away_takes_its_streams_and_leaves_its_connection() {
    // The asymmetry that is the whole point of running a server: a stream is a body ONE client was
    // reassembling, and a connection is not.
    let server = streaming_server(engine_is_bound(), &["a line"]);
    dispatched(
        &server,
        Request::new(
            "1",
            proxy(
                Some(CONNECTION),
                json!({ "url": "/events", "responseType": "stream" }),
            ),
        ),
    )
    .await;

    // Through the registry itself, which is what the LISTENER holds: reaping a departed client must
    // never queue behind a command that is holding a connection.
    let reaped = server.streams().disconnect(&client());

    assert_eq!(reaped, 1);
    assert!(server.streams().is_empty());
    let Reply::Snapshot { snapshot } = ask(&server, Command::GetRuntimeSnapshot).await else {
        panic!("expected a snapshot");
    };
    assert!(
        snapshot.active.is_some(),
        "the connection the client was using is still up: {snapshot:?}"
    );
}

#[tokio::test]
async fn a_client_can_tear_its_own_stream_down() {
    // `COMMAND_PROXY.streamDestroy`. A log view that closes must not leave an engine connection open.
    let server = streaming_server(engine_is_bound(), &["a line"]);
    dispatched(
        &server,
        Request::new(
            "1",
            proxy(
                Some(CONNECTION),
                json!({ "url": "/events", "responseType": "stream" }),
            ),
        ),
    )
    .await;

    let reply = ask(
        &server,
        Command::DestroyStream {
            stream_id: "cps-1".to_string(),
        },
    )
    .await;

    assert!(matches!(reply, Reply::Destroyed));
    assert!(server.streams().is_empty());
    assert!(
        matches!(
            ask(
                &server,
                Command::DestroyStream {
                    stream_id: "cps-1".to_string()
                }
            )
            .await,
            Reply::Destroyed
        ),
        "and tearing down one that has already gone is the state the client wants, not a refusal"
    );
}

#[tokio::test]
async fn disconnecting_something_that_was_never_running_is_not_an_error() {
    // A client may disconnect a connection it believes is up; the server owning the truth means the
    // answer is the current state, not a refusal. It also must not build a machine to find out.
    let server = server(seeded());

    let reply = ask(
        &server,
        Command::Disconnect {
            connection_id: "host.default.podman.native".to_string(),
        },
    )
    .await;

    assert!(matches!(reply, Reply::Snapshot { .. }));
}

type GatedServer = Server<MemoryFs, harness::BuildsAMachine, FakeClock>;

fn connecting_to(connection_id: &str) -> Request {
    Request::new(
        "connect",
        Command::Connect {
            connection_id: connection_id.to_string(),
            origin: ConnectOrigin::User,
        },
    )
}

fn connecting() -> Request {
    connecting_to(CONNECTION)
}

/// One connect, running on its own so the test can carry on and ask this server something else.
fn alongside(
    server: &Arc<GatedServer>,
    connection_id: &str,
) -> tokio::task::JoinHandle<(
    cdc_server::protocol::Response,
    Vec<cdc_server::protocol::Push>,
)> {
    let server = Arc::clone(server);
    let request = connecting_to(connection_id);
    tokio::spawn(async move { dispatched(&server, request).await })
}

/// Long enough that a server which serialises nothing would be caught, short enough to pay every run.
///
/// **A negative wait, and it is safe in the direction that matters**: load makes a second connect
/// arrive LATER, which is the answer this asserts. It cannot go green because the machine was busy.
const BRIEF: std::time::Duration = std::time::Duration::from_millis(50);

#[tokio::test]
async fn a_watcher_standing_down_on_a_connection_that_has_gone_records_nothing() {
    // The race between a watcher deciding an engine serves no events and a client disconnecting: the
    // record has to find no machine and say so, rather than putting a departed connection back into
    // the table for nobody to read.
    let server = server(seeded());

    assert!(
        !server.stood_down("host.default.podman.native").await,
        "a connection nothing is running cannot be the one nothing is watching"
    );
    assert!(
        server.snapshot().expect("a snapshot").active.is_none(),
        "and it was not resurrected by being told"
    );
}
