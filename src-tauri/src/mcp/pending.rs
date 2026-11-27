// Requests waiting for the webview's answer, by id. The listener registers one per request and awaits it, and
// `mcp_reply` resolves it. A request that ends first (its timeout, a closed connection, a stopped server) takes its
// entry with it, so an answer that never comes leaves nothing behind.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::oneshot;

#[derive(Default)]
pub struct PendingReplies {
    next_id: AtomicU64,
    waiting: Mutex<HashMap<u64, oneshot::Sender<String>>>,
}

impl PendingReplies {
    pub fn register(self: &Arc<Self>) -> PendingReply {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (sender, receiver) = oneshot::channel();
        self.waiting.lock().unwrap().insert(id, sender);
        PendingReply {
            id,
            receiver,
            owner: Arc::clone(self),
        }
    }

    /// Hand `body` to the request `id`. False when no request waits under that id (answered, or gone).
    pub fn resolve(&self, id: u64, body: String) -> bool {
        match self.waiting.lock().unwrap().remove(&id) {
            Some(sender) => sender.send(body).is_ok(),
            None => false,
        }
    }

    fn forget(&self, id: u64) {
        self.waiting.lock().unwrap().remove(&id);
    }

    /// End every wait at once: the page that would have answered is gone (a reload), so none of them can be answered.
    pub fn abandon_all(&self) {
        self.waiting.lock().unwrap().clear();
    }

    #[cfg(test)]
    pub fn waiting(&self) -> usize {
        self.waiting.lock().unwrap().len()
    }
}

pub struct PendingReply {
    pub id: u64,
    receiver: oneshot::Receiver<String>,
    owner: Arc<PendingReplies>,
}

impl PendingReply {
    /// The answer, or None when it did not come within `limit`.
    pub async fn wait(mut self, limit: Duration) -> Option<String> {
        tokio::time::timeout(limit, &mut self.receiver)
            .await
            .ok()?
            .ok()
    }
}

impl Drop for PendingReply {
    fn drop(&mut self) {
        self.owner.forget(self.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mcp_pending_reply_receives_the_answer_for_its_id() {
        let pending = Arc::new(PendingReplies::default());
        let first = pending.register();
        let second = pending.register();
        assert_ne!(first.id, second.id);
        assert!(pending.resolve(second.id, "two".into()));
        assert!(pending.resolve(first.id, "one".into()));
        assert_eq!(
            first.wait(Duration::from_secs(1)).await.as_deref(),
            Some("one")
        );
        assert_eq!(
            second.wait(Duration::from_secs(1)).await.as_deref(),
            Some("two")
        );
        assert_eq!(pending.waiting(), 0);
    }

    #[tokio::test]
    async fn mcp_pending_reply_times_out_and_leaves_nothing_behind() {
        let pending = Arc::new(PendingReplies::default());
        let reply = pending.register();
        let id = reply.id;
        assert_eq!(reply.wait(Duration::from_millis(10)).await, None);
        assert_eq!(pending.waiting(), 0);
        assert!(
            !pending.resolve(id, "late".into()),
            "a late answer finds nobody waiting"
        );
    }

    #[tokio::test]
    async fn mcp_pending_reply_abandoned_ends_its_wait_at_once() {
        let pending = Arc::new(PendingReplies::default());
        let reply = pending.register();
        pending.abandon_all();
        assert_eq!(pending.waiting(), 0);
        let waited =
            tokio::time::timeout(Duration::from_secs(1), reply.wait(Duration::from_secs(60))).await;
        assert_eq!(
            waited,
            Ok(None),
            "an abandoned request does not wait out its limit"
        );
    }

    #[test]
    fn mcp_pending_reply_dropped_unanswered_is_forgotten() {
        let pending = Arc::new(PendingReplies::default());
        let id = pending.register().id;
        assert_eq!(pending.waiting(), 0);
        assert!(!pending.resolve(id, "late".into()));
        assert!(!pending.resolve(999, "unknown".into()));
    }
}
