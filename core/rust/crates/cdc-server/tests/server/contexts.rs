//! `list_engine_contexts` at the server's edge.
//!
//! A child of [`super`] because that file reached the 620-line cap, and this is the seam it has: every
//! other command there moves a connection or edits the document, while these three are about a
//! question asked OF one — which is also why the command takes no slot.
//!
//! Helpers stay in the parent and are reached with `super::`, as `tests/runtimes/transports/lima.rs`
//! and its `lima/socket.rs` already do.

use std::sync::Arc;

use cdc_runtime::domain::types::diagnostic::DiagnosticCode;
use cdc_server::protocol::{Command, Outcome, Reply, Request};

use super::harness;
use super::{CONNECTION, OTHER_CONNECTION};
use super::{Unheard, alongside, ask, client, engine_is_bound, seeded, server, server_on};
use crate::fakes::{FakeClock, Gate};

#[tokio::test]
async fn a_context_listing_answers_while_that_same_connection_is_connecting() {
    // **The claim makes about taking no slot, asserted where it could fail.** The gate holds
    // the connect for THIS connection inside its attempt; a listing routed through `Operating` would
    // block behind it for the 51 to 56 seconds an attempt really takes — for the answer a person needs
    // in order to pin the context that would fix the connection they are watching fail.
    let gate = Gate::shut();
    let server = Arc::new(harness::gated_server(engine_is_bound(), gate.clone()));

    let connect = alongside(&server, CONNECTION);
    gate.reached().await;

    let listed = tokio::time::timeout(
        harness::PATIENCE,
        server.dispatch(
            &client(),
            Request::new(
                "contexts",
                Command::ListEngineContexts {
                    connection_id: CONNECTION.to_string(),
                },
            ),
            &Unheard,
        ),
    )
    .await
    .expect("a listing answers while its own connection is mid-attempt");

    assert!(
        matches!(
            listed.0.outcome,
            Outcome::Ok {
                reply: Reply::EngineContexts { .. }
            }
        ),
        "{:?}",
        listed.0.outcome
    );
    gate.open();
    connect.await.expect("the connect finishes");
}

#[tokio::test]
async fn a_listing_names_the_connection_and_the_context_it_is_pinned_to() {
    // The two facts arriving together, from the STORED connection rather than from anything detection
    // resolved — a pin is what a user configured, and detection has nothing to say about it.
    let server = server_on(harness::docker_connection_pinned(), &[], FakeClock::at(0));

    let reply = ask(
        &server,
        Command::ListEngineContexts {
            connection_id: OTHER_CONNECTION.to_string(),
        },
    )
    .await;

    match reply {
        Reply::EngineContexts {
            connection_id,
            pinned,
            contexts,
        } => {
            assert_eq!(connection_id, OTHER_CONNECTION);
            assert_eq!(pinned.as_deref(), Some("desktop-linux"));
            assert_eq!(
                contexts
                    .iter()
                    .map(|it| it.name.as_str())
                    .collect::<Vec<_>>(),
                vec!["desktop-linux", "colima"]
            );
            assert!(
                contexts[0].current,
                "the CLI's own mark travels, and it is a different fact from the pin"
            );
        }
        other => panic!("expected a listing, got {other:?}"),
    }
}

#[tokio::test]
async fn a_listing_for_a_connection_the_document_does_not_hold_is_refused() {
    let server = server(seeded());

    let (response, _) = server
        .dispatch(
            &client(),
            Request::new(
                "1",
                Command::ListEngineContexts {
                    connection_id: "host.default.docker.remote".to_string(),
                },
            ),
            &Unheard,
        )
        .await;

    match response.outcome {
        Outcome::Err { diagnostic } => {
            assert_eq!(diagnostic.code, DiagnosticCode::HostNotSupported)
        }
        other => panic!("expected a refusal, got {other:?}"),
    }
}
