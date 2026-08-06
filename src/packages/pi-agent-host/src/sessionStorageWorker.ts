// The conversation store's own socket, and the only thread that may own it.
//
// The agent's main thread blocks on every storage call (see `sessionStorage.ts`), so it cannot be the thread that
// reads the answer. This worker holds the socket, does the round trip, and hands the bytes back through the shared
// window — writing at most one window's worth at a time and waiting for the caller to drain it, so a conversation
// larger than the window still crosses without either side growing a buffer to fit it.
//
// It is a SERVER, not a client: the app dials in, the same direction as the bridge. That is what lets a remote engine
// reuse the ssh forward the session already opens instead of needing a tunnel pointing the other way.

import { parentPort, workerData } from "node:worker_threads";
import { WebSocketServer } from "ws";

import { createLogger } from "@/logger";
import {
  CONTROL_ANSWER,
  CONTROL_DRAINED,
  CONTROL_LENGTH,
  CONTROL_MORE,
  CONTROL_SLOTS,
  chunkPayload,
} from "@/pi-agent-host/sessionStorageChannel";
import {
  PI_SESSION_STORAGE_CONTAINER_PORT,
  PI_SESSION_STORAGE_PROTOCOL_VERSION,
  type SessionStorageAnswer,
  type SessionStorageCall,
  type SessionStorageHello,
} from "@/pi-bridge/sessionStorage";

const logger = createLogger("pi-agent-host.sessionStorageWorker");

interface StorageWorkerData {
  shared: SharedArrayBuffer;
  port: number;
  token: string;
  controlBytes: number;
}

const data = workerData as StorageWorkerData;
const control = new Int32Array(data.shared, 0, CONTROL_SLOTS);
const window = new Uint8Array(data.shared, data.controlBytes);
const encoder = new TextEncoder();

// Answers the caller is blocked on, correlated by id. Only ever one at a time — the caller is a single thread that
// waits — but the id travels anyway, so a late answer from a reconnected app cannot settle the wrong call.
let nextId = 1;
let pending: number | undefined;
let served: { send: (frame: string) => void } | undefined;
// Calls that arrived before the app dialled. Queued rather than refused: the container starts before the app connects,
// and refusing here would fail the session's very first storage call for a reason that resolves itself in milliseconds.
const waiting: SessionStorageCall[] = [];

// Hand one answer back across the window, in as many chunks as it takes. Synchronous on purpose: the whole answer is
// already in hand, so blocking this thread between chunks costs nothing and keeps the window single-occupancy.
function writeAnswer(answer: SessionStorageAnswer): void {
  for (const chunk of chunkPayload(encoder.encode(JSON.stringify(answer)), window.length)) {
    window.set(chunk.bytes, 0);
    Atomics.store(control, CONTROL_LENGTH, chunk.bytes.length);
    Atomics.store(control, CONTROL_MORE, chunk.more ? 1 : 0);
    Atomics.store(control, CONTROL_DRAINED, 0);
    Atomics.store(control, CONTROL_ANSWER, 1);
    Atomics.notify(control, CONTROL_ANSWER);
    // Wait for the caller to copy this chunk out before the next overwrites it. No timeout: the caller is blocked
    // inside its own bounded wait, so if it gave up it will not read again — and this worker's next call resets both
    // slots anyway.
    if (chunk.more) Atomics.wait(control, CONTROL_DRAINED, 0);
  }
}

function refuse(id: number, error: string): void {
  writeAnswer({ id, ok: false, code: "failed", error });
}

function dispatch(call: SessionStorageCall): void {
  const target = served;
  if (!target) {
    waiting.push(call);
    return;
  }
  const id = nextId++;
  pending = id;
  try {
    target.send(JSON.stringify({ id, call }));
  } catch (error) {
    pending = undefined;
    refuse(id, `sending ${call.op} to the app failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const server = new WebSocketServer({ host: "0.0.0.0", port: data.port || PI_SESSION_STORAGE_CONTAINER_PORT });
logger.info(`conversation store listening on ${data.port || PI_SESSION_STORAGE_CONTAINER_PORT}`);

server.on("connection", (socket) => {
  let authorised = false;
  socket.on("message", (frame) => {
    const text = frame.toString();
    if (!authorised) {
      // The same bridge token, because this socket is the same trust boundary: whatever reaches it can read and write
      // every conversation. A frame that is not a valid hello closes the socket rather than being ignored — an
      // unauthenticated peer must not be left holding it.
      let hello: SessionStorageHello;
      try {
        hello = JSON.parse(text) as SessionStorageHello;
      } catch {
        socket.close(4400, "malformed hello");
        return;
      }
      if (hello.type !== "hello" || hello.token !== data.token) {
        socket.close(4401, "unauthorised");
        return;
      }
      if (hello.version !== PI_SESSION_STORAGE_PROTOCOL_VERSION) {
        socket.close(4426, `protocol version ${String(hello.version)} is not ${PI_SESSION_STORAGE_PROTOCOL_VERSION}`);
        return;
      }
      authorised = true;
      served = { send: (outgoing) => socket.send(outgoing) };
      // Whatever the session asked for while nothing was connected. The caller is still blocked on the first of them.
      for (const call of waiting.splice(0)) dispatch(call);
      return;
    }
    let answer: SessionStorageAnswer;
    try {
      answer = JSON.parse(text) as SessionStorageAnswer;
    } catch (error) {
      logger.warn("an answer from the app did not parse", error);
      return;
    }
    // Dropped rather than delivered when it does not match: settling a call with another call's answer would hand pi
    // one conversation's bytes for another's.
    if (pending !== answer.id) {
      logger.warn(`an answer arrived for ${answer.id}, which is not the call in flight`);
      return;
    }
    pending = undefined;
    writeAnswer(answer);
  });
  socket.on("close", () => {
    if (served) served = undefined;
    // A call in flight when the app goes away is failed at once, not left to the caller's timeout: the reason is known
    // now, and thirty seconds of a wedged session says nothing.
    if (pending !== undefined) {
      const id = pending;
      pending = undefined;
      refuse(id, "the app closed the conversation store's socket");
    }
  });
});

parentPort?.on("message", (call: SessionStorageCall) => dispatch(call));
