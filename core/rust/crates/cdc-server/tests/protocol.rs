//! The wire vocabulary, pinned against the shape a client actually parses.
//!
//! These assert JSON, not Rust values, and that is the point: the Go implementation and the app's
//! TypeScript both read these bytes, and a round-trip through `serde` alone would happily agree with
//! itself about a tag no other language expects.

use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResponse, CommandProxyResult, CommandProxyStreamEvent,
    CommandProxyStreamHandle, StreamEventType,
};
use cdc_runtime::domain::types::connection::Connection;
use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};
use cdc_runtime::domain::types::engine::EngineContext;
use cdc_runtime::domain::types::resource_sync_protocol::{
    AppRuntimeSnapshot, ConnectOrigin, ConnectProgress, ConnectionPhase,
};
use cdc_server::protocol::{
    Command, Event, Outbound, Outcome, PROTOCOL_VERSION, Push, Reply, Request, Response,
};
use serde_json::{Value, json};

fn connection() -> Connection {
    serde_json::from_value(json!({
      "id": "host.default.podman.native",
      "name": "podman-native",
      "label": "Native",
      "engine": "podman",
      "host": "podman.native",
      "settings": {
        "api": { "baseURL": "http://d", "connection": { "uri": "", "relay": "" } },
        "program": { "name": "podman", "path": "", "version": "" },
        "rootfull": false,
        "mode": "mode.automatic"
      }
    }))
    .expect("connection fixture parses")
}

fn snapshot() -> AppRuntimeSnapshot {
    AppRuntimeSnapshot {
        active: None,
        connections: Vec::new(),
        current_connector: None,
        now: 0,
        os_type: "linux".to_string(),
        phase: ConnectionPhase::Ready,
        running: true,
    }
}

fn encoded(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).expect("a protocol frame serializes")
}

#[test]
fn every_frame_carries_the_protocol_version() {
    // Carried from the first release on purpose: retrofitting a version tag onto clients that are
    // already deployed is far worse than paying for one now.
    let request = encoded(&Request::new("1", Command::GetRuntimeSnapshot));
    let response = encoded(&Response::ok(
        "1",
        Reply::Snapshot {
            snapshot: Box::new(snapshot()),
        },
    ));
    let push = encoded(&Push::new(Event::Snapshot {
        snapshot: Box::new(snapshot()),
    }));

    for frame in [&request, &response, &push] {
        assert_eq!(
            frame.get("version").and_then(Value::as_u64),
            Some(u64::from(PROTOCOL_VERSION)),
            "every frame is self-describing: {frame}"
        );
    }
}

#[test]
fn a_request_id_is_the_clients_and_comes_back_untouched() {
    // The server never interprets it, which is what lets a client correlate with whatever it already
    // has — a sequence number, a uuid, the span id it is tracing under.
    let response = Response::ok(
        "the-clients-own-id",
        Reply::Connections {
            connections: vec![connection()],
        },
    );

    assert_eq!(
        encoded(&response).get("id").and_then(Value::as_str),
        Some("the-clients-own-id")
    );
}

#[test]
fn each_command_carries_the_tag_it_is_named_by() {
    // These tags ARE the command surface — a Go server reading a
    // different spelling would refuse every frame this one sends.
    let cases = [
        (Command::ListConnections, "list_connections"),
        (
            Command::CreateConnection {
                connection: Box::new(connection()),
            },
            "create_connection",
        ),
        (
            Command::UpdateConnection {
                connection_id: "host.default.podman.native".to_string(),
                partial: json!({ "name": "renamed" }),
            },
            "update_connection",
        ),
        (
            Command::RemoveConnection {
                connection_id: "host.default.podman.native".to_string(),
            },
            "remove_connection",
        ),
        (
            Command::Connect {
                connection_id: "host.default.podman.native".to_string(),
                origin: ConnectOrigin::User,
            },
            "connect",
        ),
        (
            Command::Disconnect {
                connection_id: "host.default.podman.native".to_string(),
            },
            "disconnect",
        ),
        (Command::GetRuntimeSnapshot, "get_runtime_snapshot"),
        (
            Command::ProxyRequest {
                payload: Box::new(CommandProxyRequestPayload {
                    connection: Some(
                        json!({ "id": "host.default.podman.native" })
                            .as_object()
                            .cloned()
                            .expect("an object"),
                    ),
                    req: json!({ "method": "GET", "url": "/_ping" })
                        .as_object()
                        .cloned()
                        .expect("an object"),
                }),
            },
            "proxy_request",
        ),
        (
            Command::ListEngineContexts {
                connection_id: "host.default.docker.virtualized.vendor".to_string(),
            },
            "list_engine_contexts",
        ),
        (
            Command::DestroyStream {
                stream_id: "cps-1".to_string(),
            },
            "destroy_stream",
        ),
    ];

    for (command, tag) in cases {
        let frame = encoded(&Request::new("1", command.clone()));
        assert_eq!(
            frame.get("command").and_then(Value::as_str),
            Some(tag),
            "{command:?} must be tagged `{tag}`"
        );
        let parsed: Request =
            serde_json::from_value(frame).expect("a frame this crate wrote is one it can read");
        assert_eq!(
            parsed.command, command,
            "the tag round-trips to its variant"
        );
    }
}

#[test]
fn an_update_carries_a_partial_rather_than_a_connection() {
    // Deep-merge semantics: an absent field means "leave it alone", and a typed struct would make it
    // indistinguishable from a field the client meant to blank. The oracle's update relies on that.
    let frame = encoded(&Request::new(
        "1",
        Command::UpdateConnection {
            connection_id: "host.default.podman.native".to_string(),
            partial: json!({ "settings": { "rootfull": true } }),
        },
    ));

    assert_eq!(
        frame.pointer("/partial/settings/rootfull"),
        Some(&Value::Bool(true)),
        "the partial reaches the wire as written, with nothing filled in around it: {frame}"
    );
}

#[test]
fn a_connection_is_addressed_apart_from_the_requests_own_id() {
    // The bug this pins: `Command` is FLATTENED into `Request`, so a variant field called `id` shares
    // a key with the client's correlation id and one silently overwrites the other. It serialized
    // perfectly and would not parse back, which is the worst way for a wire format to be wrong.
    let frame = encoded(&Request::new(
        "correlation-7",
        Command::Disconnect {
            connection_id: "host.default.podman.native".to_string(),
        },
    ));

    assert_eq!(
        frame.get("id").and_then(Value::as_str),
        Some("correlation-7")
    );
    assert_eq!(
        frame.get("connection_id").and_then(Value::as_str),
        Some("host.default.podman.native"),
        "two identities, two keys: {frame}"
    );
}

#[test]
fn a_refusal_is_a_code_and_never_prose() {
    //, at the protocol edge: the server does not know what language its client renders in.
    let response = Response::failed(
        "1",
        ReportedDiagnostic {
            code: DiagnosticCode::ApiUnreachable,
            params: serde_json::Map::from_iter([(
                "socket".to_string(),
                Value::String("/run/podman.sock".to_string()),
            )]),
            severity: DiagnosticSeverity::Err,
        },
    );

    let frame = encoded(&response);
    assert_eq!(
        frame.get("outcome").and_then(Value::as_str),
        Some("err"),
        "success and failure are distinguishable without inspecting the payload"
    );
    assert_eq!(
        frame.pointer("/diagnostic/code"),
        Some(&Value::String("API_UNREACHABLE".to_string()))
    );
    assert_eq!(
        frame.pointer("/diagnostic/params/socket"),
        Some(&Value::String("/run/podman.sock".to_string())),
        "the parameters a client renders its own sentence from"
    );
}

#[test]
fn a_successful_reply_says_which_shape_it_carries() {
    let connections = encoded(&Response::ok(
        "1",
        Reply::Connections {
            connections: vec![connection()],
        },
    ));
    let snapshot = encoded(&Response::ok(
        "2",
        Reply::Snapshot {
            snapshot: Box::new(snapshot()),
        },
    ));

    assert_eq!(
        connections.get("outcome").and_then(Value::as_str),
        Some("ok")
    );
    assert_eq!(
        connections.get("reply").and_then(Value::as_str),
        Some("connections")
    );
    assert_eq!(
        snapshot.get("reply").and_then(Value::as_str),
        Some("snapshot"),
        "two successes with different payloads are told apart by a tag, not by probing keys"
    );
}

#[test]
fn a_context_listing_names_the_connection_it_answers_about_and_carries_its_pin() {
    // Both facts on one frame, because a client's cursor is free to move while this is in flight and
    // the two are read together. Round-tripped as well as spelled: `Reply` is tagged
    // `reply`, and a variant field named after the tag would write both to one key — the flatten trap
    // that `Command`'s `id` was caught by, which serializes cleanly and will not parse back.
    let reply = Reply::EngineContexts {
        connection_id: "host.default.docker.virtualized.vendor".to_string(),
        pinned: Some("desktop-linux".to_string()),
        contexts: vec![EngineContext {
            current: true,
            description: "Docker Desktop".to_string(),
            endpoint: "unix:///d.sock".to_string(),
            error: String::new(),
            name: "desktop-linux".to_string(),
        }],
    };
    let frame = encoded(&Response::ok("1", reply.clone()));

    assert_eq!(
        frame.get("reply").and_then(Value::as_str),
        Some("engine_contexts")
    );
    assert_eq!(
        frame.pointer("/pinned").and_then(Value::as_str),
        Some("desktop-linux")
    );
    assert_eq!(
        frame.pointer("/contexts/0/Name").and_then(Value::as_str),
        Some("desktop-linux"),
        "a context reaches the wire in docker's own spelling: {frame}"
    );
    let parsed: Response =
        serde_json::from_value(frame).expect("a frame this crate wrote is one it can read");
    assert_eq!(parsed.outcome, Outcome::Ok { reply });
}

#[test]
fn a_connection_that_pins_nothing_answers_a_listing_with_no_pin() {
    // `None` rather than an empty string, and the difference is the whole point: a connection with no
    // pin FOLLOWS the current context, and rendering that as a pin on `""` would show every row
    // unpinned with no way to say which one is actually in force.
    let frame = encoded(&Response::ok(
        "1",
        Reply::EngineContexts {
            connection_id: "host.default.docker.native".to_string(),
            pinned: None,
            contexts: Vec::new(),
        },
    ));

    assert_eq!(frame.pointer("/pinned"), Some(&Value::Null));
    assert_eq!(
        frame.pointer("/contexts"),
        Some(&Value::Array(Vec::new())),
        "an empty listing is a real answer and is carried as one"
    );
}

#[test]
fn a_snapshot_may_be_dropped_for_a_slow_client_and_progress_may_not() {
    // The whole of, as a property of the frame rather than of the queue: a snapshot
    // is whole-state, so a client that misses an intermediate one loses nothing. Progress is a LOG,
    // and a gap in a connect trace is a bug report nobody can answer.
    let snapshot = Push::new(Event::Snapshot {
        snapshot: Box::new(snapshot()),
    });
    let progress = Push::new(Event::Progress {
        progress: Box::new(progress()),
    });

    assert!(snapshot.is_droppable(), "only the latest state matters");
    assert!(
        !progress.is_droppable(),
        "a dropped progress line is a hole in a trace nobody can reconstruct"
    );
}

fn progress() -> ConnectProgress {
    ConnectProgress {
        attempt: None,
        code: None,
        connection_id: "host.default.podman.native".to_string(),
        next_retry_at: None,
        origin: Some(ConnectOrigin::User),
        phase: ConnectionPhase::Starting,
        step: None,
        ts: 0,
    }
}

fn stream_frame(type_: StreamEventType) -> Push {
    Push::new(Event::Stream {
        stream: Box::new(CommandProxyStreamEvent {
            payload: Some(Value::String("a line of log".to_string())),
            stream_id: "cps-1".to_string(),
            type_,
        }),
    })
}

#[test]
fn a_stream_frame_may_never_be_dropped() {
    // A client is REASSEMBLING a body, so a missing chunk is corruption rather than a stale view —
    // the opposite of what makes a snapshot safe to lose. This is the assertion that stops
    // `is_droppable` from being "generalised" to every event that is not progress.
    for type_ in [
        StreamEventType::Data,
        StreamEventType::End,
        StreamEventType::Error,
    ] {
        assert!(
            !stream_frame(type_).is_droppable(),
            "{type_} is part of a body"
        );
    }
}

#[test]
fn a_stream_frame_carries_the_originals_shape_under_its_own_key() {
    // Two rules in one frame. The PAYLOAD is `commandProxyProtocol.ts` verbatim — `streamId`, `type`,
    // `payload` — because a client written against the TypeScript reads these bytes. The KEY is
    // `stream` and not `event`, because this enum is tagged `event` and a field of that name would
    // write the tag and the payload to one key: it serializes cleanly and will not parse back, which
    // is exactly how `Command`'s `id` failed.
    let frame = encoded(&stream_frame(StreamEventType::Data));

    assert_eq!(frame.get("event").and_then(Value::as_str), Some("stream"));
    assert_eq!(
        frame.pointer("/stream/streamId"),
        Some(&Value::String("cps-1".to_string())),
        "camelCase inside, because the payload is the original's: {frame}"
    );
    assert_eq!(
        frame.pointer("/stream/type"),
        Some(&Value::String("data".to_string()))
    );
    let parsed: Push =
        serde_json::from_value(frame).expect("a frame this crate wrote is one it can read");
    assert!(matches!(parsed.event, Event::Stream { .. }));
}

#[test]
fn a_forwarded_answer_says_whether_the_body_is_here_or_is_coming() {
    // Untagged between the two, discriminated by the `stream` literal both shapes carry — which is how
    // the original discriminates it, so a client written against the TypeScript needs no change.
    let whole = encoded(&Response::ok(
        "1",
        Reply::Proxied {
            result: Box::new(CommandProxyResult::Buffered(CommandProxyResponse {
                data: Some(json!([])),
                headers: None,
                message: None,
                ok: true,
                status: Some(200),
                status_text: Some("OK".to_string()),
                stream: false,
            })),
        },
    ));
    let coming = encoded(&Response::ok(
        "2",
        Reply::Proxied {
            result: Box::new(CommandProxyResult::Stream(CommandProxyStreamHandle {
                headers: None,
                status: Some(200),
                stream: true,
                stream_id: "cps-1".to_string(),
            })),
        },
    ));

    assert_eq!(whole.get("reply").and_then(Value::as_str), Some("proxied"));
    assert_eq!(whole.pointer("/result/stream"), Some(&Value::Bool(false)));
    assert_eq!(whole.pointer("/result/status"), Some(&json!(200)));
    assert_eq!(coming.pointer("/result/stream"), Some(&Value::Bool(true)));
    assert_eq!(
        coming.pointer("/result/streamId"),
        Some(&Value::String("cps-1".to_string()))
    );

    let parsed: Response =
        serde_json::from_value(coming).expect("a stream handle round-trips to its own variant");
    let cdc_server::protocol::Outcome::Ok {
        reply: Reply::Proxied { result },
    } = parsed.outcome
    else {
        panic!("expected a proxied reply");
    };
    assert!(
        matches!(*result, CommandProxyResult::Stream(_)),
        "untagged must not read a stream handle as a buffered response"
    );
}

#[test]
fn a_torn_down_stream_is_answered_without_a_payload() {
    let frame = encoded(&Response::ok("1", Reply::Destroyed));

    assert_eq!(frame.get("outcome").and_then(Value::as_str), Some("ok"));
    assert_eq!(
        frame.get("reply").and_then(Value::as_str),
        Some("destroyed")
    );
}

#[test]
fn an_outbound_frame_is_indistinguishable_from_the_frame_it_carries() {
    // The property a client depends on: nothing about the union the writer holds reaches the wire. A
    // wrapper that added a key would be a protocol change disguised as an implementation detail.
    let response = Response::ok("1", Reply::Destroyed);
    let push = Push::new(Event::Snapshot {
        snapshot: Box::new(snapshot()),
    });

    assert_eq!(
        serde_json::to_string(&Outbound::Answer(response.clone())).expect("serializes"),
        serde_json::to_string(&response).expect("serializes"),
        "a reply is written exactly as a reply"
    );
    assert_eq!(
        serde_json::to_string(&Outbound::Pushed(push.clone())).expect("serializes"),
        serde_json::to_string(&push).expect("serializes"),
        "and a push exactly as a push"
    );
}

#[test]
fn the_two_kinds_of_outbound_frame_are_told_apart_by_a_key_each_one_requires() {
    // `untagged` picks the first arm that parses, so the arms have to be distinguishable — a reply has
    // `outcome`, a push has `event`. If a future field made them overlap, serde would silently choose the
    // wrong one, so the variant is asserted rather than just the bytes.
    let reply: Outbound = serde_json::from_value(encoded(&Response::ok("1", Reply::Destroyed)))
        .expect("a reply parses");
    let pushed: Outbound = serde_json::from_value(encoded(&Push::new(Event::Progress {
        progress: Box::new(progress()),
    })))
    .expect("a push parses");

    assert!(matches!(reply, Outbound::Answer(_)), "got {reply:?}");
    assert!(matches!(pushed, Outbound::Pushed(_)), "got {pushed:?}");
}

#[test]
fn a_reply_is_never_droppable_however_it_is_wrapped() {
    // A dropped snapshot costs a client nothing. A dropped REPLY leaves it waiting on a correlation id
    // that will never be answered — indistinguishable from a server that has not finished.
    assert!(!Outbound::from(Response::ok("1", Reply::Destroyed)).is_droppable());
    assert!(
        Outbound::from(Push::new(Event::Snapshot {
            snapshot: Box::new(snapshot())
        }))
        .is_droppable(),
        "while whole state still is"
    );
    assert!(
        !Outbound::from(Push::new(Event::Progress {
            progress: Box::new(progress())
        }))
        .is_droppable()
    );
}
