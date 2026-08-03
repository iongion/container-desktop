//! One task owns the socket; everything else asks it.
//!
//! [`Client`] takes `&mut self` on both halves and is not `Sync`, so a `Forwarder` — which is `&self`
//! and `Send + Sync` — cannot hold one.

use std::collections::BTreeMap;

use async_trait::async_trait;
use cdc_runtime::command_proxy::{ForwardError, Forwarded, ForwardedStream, Forwarder};
use cdc_runtime::domain::types::command_proxy_protocol::{
    CommandProxyRequestPayload, CommandProxyResult, CommandProxyStreamEvent, StreamEventType,
};
use cdc_runtime::domain::types::diagnostic::{
    DiagnosticCode, DiagnosticSeverity, ReportedDiagnostic,
};
use cdc_server::protocol::{Command, Event, Outbound, Outcome, Reply};
use tokio::sync::{mpsc, oneshot};

use crate::{Client, ClientError};

/// How many chunks of one stream are held for a reader that is between reads.
///
/// **Small, and its own number rather than the server's.** What this absorbs is the gap between two
/// `next_chunk` calls of a reader that is looping, which is a handful of chunks — where the server's
/// per-client queue of two hundred is sized for a whole connect's worth of progress lines, per CLIENT
/// rather than per stream. Borrowing that number here would hold two hundred chunks for every open log.
///
/// A reader that falls further behind than this has its stream torn down rather than the socket stalled:
/// the pump also reads every other stream and every reply, so waiting here would stop all of them. What
/// the reader then gets is the truncation error, which is the honest answer — never a wait that does not
/// end.
const CHUNK_QUEUE_CAPACITY: usize = 16;

/// What a client wants issued, and where its answer goes.
struct Issued {
    command: Command,
    /// `None` for a command nobody is waiting on — a fire-and-forget destroy.
    answered: Option<oneshot::Sender<Answered>>,
}

/// One command's outcome, as the mux read it off the socket.
enum Answered {
    Replied(Reply),
    /// A forwarded STREAM, carrying the channel its chunks will arrive on.
    Streamed(ForwardedStream),
    Refused(Box<ReportedDiagnostic>),
    /// The socket went before the reply came.
    Gone,
}

/// A handle onto the task that owns the socket.
///
/// Cloneable and `Send + Sync`: what it holds is a channel, so any number of tasks may issue commands
/// and the total order the server guarantees still survives on one writer.
#[derive(Clone)]
pub struct Mux {
    issue: mpsc::UnboundedSender<Issued>,
}

/// Everything the mux read that was not somebody's reply.
///
/// **A channel rather than a callback**, because the consumer is an event loop: it selects on this
/// beside its keyboard, exactly as it used to select on [`Client::next`].
pub type Frames = mpsc::UnboundedReceiver<Result<Outbound, ClientError>>;

impl Mux {
    /// Take ownership of a client, and answer with a handle and the frames nobody asked for.
    ///
    /// The task ends when the session does or when every handle is dropped, whichever is first.
    pub fn spawn(client: Client) -> (Self, Frames) {
        let (issue, issues) = mpsc::unbounded_channel();
        let (frames, unsolicited) = mpsc::unbounded_channel();
        let mux = Self { issue };
        tokio::spawn(pump(client, issues, frames));
        (mux, unsolicited)
    }

    /// Issue one command and wait for the reply that carries its id.
    pub async fn ask(&self, command: Command) -> Answer {
        let (answered, answer) = oneshot::channel();
        if self
            .issue
            .send(Issued {
                command,
                answered: Some(answered),
            })
            .is_err()
        {
            return Answer::Gone;
        }
        match answer.await {
            Ok(Answered::Replied(reply)) => Answer::Replied(reply),
            Ok(Answered::Streamed(stream)) => Answer::Streamed(stream),
            Ok(Answered::Refused(diagnostic)) => Answer::Refused(diagnostic),
            Ok(Answered::Gone) | Err(_) => Answer::Gone,
        }
    }

    /// Issue one command and never wait — what a `Drop` can do.
    ///
    /// **It still reports a session that has already ended**, because a closed channel means the pump
    /// has gone and nothing will ever be written again. What it cannot report is a write that fails
    /// AFTER this returns; that arrives on [`Frames`] as an error, which is the only place it can.
    pub fn tell(&self, command: Command) -> Result<(), ClientError> {
        self.issue
            .send(Issued {
                command,
                answered: None,
            })
            .map_err(|_| ClientError::Disconnected)
    }
}

/// What `ask` came back with.
pub enum Answer {
    Replied(Reply),
    /// A forwarded stream, and the channel its chunks will arrive on.
    ///
    /// Its own arm rather than a `Reply`, because the channel cannot be recovered afterwards: it is
    /// registered as the handle is read, and a caller handed only the handle would have nothing to read.
    Streamed(ForwardedStream),
    Refused(Box<ReportedDiagnostic>),
    /// The session is over. Told apart from a refusal because there is nothing to fix and nothing to
    /// retry — the same distinction [`ClientError::Disconnected`] makes one layer down.
    Gone,
}

#[async_trait]
impl Forwarder for Mux {
    async fn forward(
        &self,
        payload: &CommandProxyRequestPayload,
    ) -> Result<Forwarded, ForwardError> {
        let command = Command::ProxyRequest {
            payload: Box::new(payload.clone()),
        };
        match self.ask(command).await {
            Answer::Replied(Reply::Proxied { result }) => match *result {
                CommandProxyResult::Buffered(response) => Ok(Forwarded::Buffered(response)),
                // Unreachable: a stream reply is turned into `Answer::Streamed` by the pump, in the step
                // that registers its channel. Named rather than swallowed, because it is what a far side
                // sending a handle this mux did not register would look like.
                CommandProxyResult::Stream(handle) => Err(ForwardError::Refused {
                    diagnostic: Box::new(unexpected(&handle.stream_id)),
                }),
            },
            Answer::Streamed(stream) => Ok(Forwarded::Stream(stream)),
            Answer::Replied(_) => Err(ForwardError::Refused {
                diagnostic: Box::new(unexpected("reply")),
            }),
            Answer::Refused(diagnostic) => Err(ForwardError::Refused { diagnostic }),
            Answer::Gone => Err(ForwardError::Disconnected),
        }
    }

    fn destroy(&self, stream_id: &str) {
        // A session that has already gone has already forgotten every stream it held.
        let _ = self.tell(Command::DestroyStream {
            stream_id: stream_id.to_string(),
        });
    }
}

/// A reply this client cannot have asked for, as the refusal it reports.
fn unexpected(what: &str) -> ReportedDiagnostic {
    ReportedDiagnostic {
        code: DiagnosticCode::NotChecked,
        params: serde_json::json!({ "unexpected": what })
            .as_object()
            .cloned()
            .unwrap_or_default(),
        severity: DiagnosticSeverity::Err,
    }
}

/// The one task that reads and writes the socket.
async fn pump(
    mut client: Client,
    mut issues: mpsc::UnboundedReceiver<Issued>,
    frames: mpsc::UnboundedSender<Result<Outbound, ClientError>>,
) {
    let mut pending: BTreeMap<String, oneshot::Sender<Answered>> = BTreeMap::new();
    let mut streams: BTreeMap<String, mpsc::Sender<CommandProxyStreamEvent>> = BTreeMap::new();
    loop {
        tokio::select! {
            // **Biased on the socket.** A reply already on the wire settles a caller that is waiting,
            // where a command not yet issued has nobody blocked on it — and reading first is what
            // keeps the pending map from growing while frames queue in the kernel.
            biased;
            received = client.next() => match received {
                Some(Ok(frame)) => absorb(frame, &mut pending, &mut streams, &frames),
                Some(Err(error)) => {
                    let _ = frames.send(Err(error));
                }
                None => break,
            },
            issued = issues.recv() => match issued {
                Some(Issued { command, answered }) => {
                    match client.send(command).await {
                        Ok(id) => {
                            if let Some(answered) = answered {
                                pending.insert(id, answered);
                            }
                        }
                        // Every waiter is answered before this returns, by `pending` being dropped.
                        Err(error) => {
                            let _ = frames.send(Err(error));
                            break;
                        }
                    }
                }
                // Every handle has gone. Nothing more will be issued and nobody is waiting.
                None => break,
            },
        }
    }
    // A caller waiting on a reply that will never come is told so, rather than left on a `oneshot`
    // whose sender was dropped — which reads as the same thing but says nothing about why.
    for (_, answered) in pending {
        let _ = answered.send(Answered::Gone);
    }
}

/// One frame: somebody's reply, one stream's chunk, or news for the loop.
fn absorb(
    frame: Outbound,
    pending: &mut BTreeMap<String, oneshot::Sender<Answered>>,
    streams: &mut BTreeMap<String, mpsc::Sender<CommandProxyStreamEvent>>,
    frames: &mpsc::UnboundedSender<Result<Outbound, ClientError>>,
) {
    match frame {
        Outbound::Answer(response) => {
            let Some(answered) = pending.remove(&response.id) else {
                // A reply to a request this client never made, or one whose caller has gone. The loop
                // is told, because two ends disagreeing about what was asked is news.
                let _ = frames.send(Ok(Outbound::Answer(response)));
                return;
            };
            let _ = answered.send(match response.outcome {
                Outcome::Ok { reply } => registered(reply, streams),
                Outcome::Err { diagnostic } => Answered::Refused(diagnostic),
            });
        }
        Outbound::Pushed(push) => match push.event {
            // Routed to whoever opened it, and never to the loop: a chunk is part of a body somebody
            // is reassembling.
            Event::Stream { stream } => deliver(*stream, streams),
            event => {
                let _ = frames.send(Ok(Outbound::Pushed(cdc_server::protocol::Push::new(event))));
            }
        },
    }
}

/// A reply, with a stream's chunk channel registered in the same step that read its handle.
///
/// **This is the atomic point.** One task reads one ordered socket, so nothing can deliver a chunk
/// between the handle being read here and the channel existing — which is exactly the race a caller
/// subscribing after its own reply would lose. It is also why the RECEIVER travels back with the reply:
/// there is no way to ask for it afterwards.
fn registered(
    reply: Reply,
    streams: &mut BTreeMap<String, mpsc::Sender<CommandProxyStreamEvent>>,
) -> Answered {
    if let Reply::Proxied { result } = &reply
        && let CommandProxyResult::Stream(handle) = &**result
    {
        let (sender, chunks) = mpsc::channel(CHUNK_QUEUE_CAPACITY);
        streams.insert(handle.stream_id.clone(), sender);
        return Answered::Streamed(ForwardedStream {
            handle: handle.clone(),
            chunks,
        });
    }
    Answered::Replied(reply)
}

/// One chunk to whoever is reading that stream.
fn deliver(
    stream: CommandProxyStreamEvent,
    streams: &mut BTreeMap<String, mpsc::Sender<CommandProxyStreamEvent>>,
) {
    let terminal = matches!(stream.type_, StreamEventType::End | StreamEventType::Error);
    let Some(chunks) = streams.get(&stream.stream_id) else {
        return;
    };
    // `try_send` rather than a wait: this task also reads every other stream and every reply, so
    // blocking here on one slow reader would stall the whole socket. A reader that has fallen a whole
    // queue behind has its stream torn down instead, which is the same answer the server's own
    // backpressure gives a slow client.
    let full = chunks.try_send(stream.clone()).is_err();
    if terminal || full {
        streams.remove(&stream.stream_id);
    }
}
