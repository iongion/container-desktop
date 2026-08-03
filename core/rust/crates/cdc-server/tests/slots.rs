//! One lock per connection, and the two things that are easy to get wrong about a keyed one.
//!
//! No harness and no fakes: what is under test is a lock table, and everything it needs is a task that
//! takes a slot and says so.

use std::sync::Arc;
use std::time::Duration;

use cdc_server::slots::ConnectionSlots;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};
use tokio::sync::oneshot;

/// A positive answer is waited for generously — it is the one load can only delay.
const PATIENCE: Duration = Duration::from_secs(5);

/// A negative answer is waited for briefly, and that is safe in the direction that matters: load makes
/// a blocked task arrive LATER, which is what this asserts. It cannot go green because a machine was
/// busy.
const BRIEF: Duration = Duration::from_millis(50);

/// Who got into a slot, in the order they got in.
type Entered = UnboundedReceiver<&'static str>;

/// A task standing inside a slot, which it holds until told to let go.
struct Holder {
    release: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<()>,
}

impl Holder {
    /// Let go, and wait until it really has — so the next assertion is about the state after.
    async fn release(self) {
        drop(self.release);
        self.task.await.expect("the holder finishes");
    }
}

/// Ask for one connection's slot, announcing arrival on `entered` and holding it until released.
fn takes(
    slots: &Arc<ConnectionSlots>,
    id: &'static str,
    entered: &UnboundedSender<&'static str>,
) -> Holder {
    let (release, held) = oneshot::channel();
    let slots = Arc::clone(slots);
    let entered = entered.clone();
    let task = tokio::spawn(async move {
        let _slot = slots.enter(id).await;
        entered.send(id).expect("the test is listening");
        // A closed channel is the release; the value is never sent.
        let _ = held.await;
    });
    Holder { release, task }
}

/// The next task to get in.
async fn entered(waiting: &mut Entered) -> &'static str {
    tokio::time::timeout(PATIENCE, waiting.recv())
        .await
        .expect("something takes the slot it asked for")
        .expect("the announcing channel is open")
}

/// That nobody gets in — see [`BRIEF`] for why a short wait is the honest one here.
async fn nobody_enters(waiting: &mut Entered, why: &str) {
    assert!(
        tokio::time::timeout(BRIEF, waiting.recv()).await.is_err(),
        "{why}"
    );
}

/// A fresh table, the channel its holders announce on, and the receiver a test reads.
fn fresh() -> (Arc<ConnectionSlots>, UnboundedSender<&'static str>, Entered) {
    let (announce, waiting) = unbounded_channel();
    (Arc::new(ConnectionSlots::default()), announce, waiting)
}

#[tokio::test]
async fn two_operations_on_one_connection_are_a_sequence() {
    // The exclusion itself, and the thing a finer lock must not lose: `connect` REBUILDS the machine
    // from the document, so two of them overlapping would leave the first one's services running with
    // nothing holding their ids — the `ssh -NL` reparented to init that the design names.
    let (slots, announce, mut waiting) = fresh();

    let first = takes(&slots, "one", &announce);
    assert_eq!(entered(&mut waiting).await, "one");
    let second = takes(&slots, "one", &announce);

    nobody_enters(
        &mut waiting,
        "a second operation joined the first one inside its slot",
    )
    .await;
    first.release().await;
    assert_eq!(
        entered(&mut waiting).await,
        "one",
        "and it goes in once the first is out, rather than being refused"
    );
    second.release().await;
}

#[tokio::test]
async fn an_operation_on_another_connection_waits_for_nothing() {
    // **The whole reason this type exists.** One mutex over the server made a `connect` to a healthy
    // engine — and that connection's own watcher recording its drop — queue behind a sick engine's
    // attempt for the 51 to 56 seconds `spawn_service` spends polling a socket that never answers.
    let (slots, announce, mut waiting) = fresh();

    let holding = takes(&slots, "one", &announce);
    assert_eq!(entered(&mut waiting).await, "one");
    let other = takes(&slots, "two", &announce);

    assert_eq!(
        entered(&mut waiting).await,
        "two",
        "another connection waited for one it has nothing to do with"
    );
    other.release().await;
    holding.release().await;
}

#[tokio::test]
async fn a_slot_is_forgotten_once_nothing_holds_it() {
    // **What stops a client minting one slot per unknown id.** A command is refused for naming a
    // connection nobody stored only AFTER its slot has been taken — `stored` reads the document inside
    // the operation, because a check outside it is a check another client's `remove_connection` can run
    // between. So the table is bounded by what is in flight rather than by what has ever been asked
    // for, and a loop of connects to invented ids leaves nothing behind.
    let (slots, announce, mut waiting) = fresh();

    let holding = takes(&slots, "one", &announce);
    assert_eq!(entered(&mut waiting).await, "one");
    assert_eq!(slots.in_use(), 1, "a slot being held is a slot that exists");

    holding.release().await;

    assert_eq!(
        slots.in_use(),
        0,
        "a slot outlived the operation that needed it"
    );
}

#[tokio::test]
async fn a_slot_something_is_waiting_on_is_kept() {
    // **The soundness of forgetting one, and the case a table that always forgot would pass every test
    // above.** Reaping a slot a second operation is already queued on hands the THIRD a different lock:
    // the queued one holds the old one, the new arrival takes a fresh one, and both run — which is no
    // exclusion at all, arrived at through the tidying rather than through the locking.
    let (slots, announce, mut waiting) = fresh();

    let first = takes(&slots, "one", &announce);
    assert_eq!(entered(&mut waiting).await, "one");
    let second = takes(&slots, "one", &announce);
    first.release().await;
    assert_eq!(entered(&mut waiting).await, "one", "the queued one goes in");

    let third = takes(&slots, "one", &announce);

    nobody_enters(
        &mut waiting,
        "a third operation was handed a different lock than the one being held",
    )
    .await;
    second.release().await;
    assert_eq!(entered(&mut waiting).await, "one");
    third.release().await;
}
