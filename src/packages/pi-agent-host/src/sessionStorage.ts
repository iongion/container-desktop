// pi's session store, answered by the app instead of by this container's filesystem.
//
// WHY A WORKER THREAD. pi's `SessionStorage` port is synchronous — `appendMessage` returns an entry id, `create` and
// `open` touch the store in their constructors — so this thread BLOCKS for every call while the answer travels over a
// socket. A blocked thread runs no callbacks, so the answer cannot arrive on a socket THIS thread owns; that is an
// immediate deadlock, not a slow path. It therefore arrives through a worker that owns its own socket, and the two
// threads hand values across a `SharedArrayBuffer` with `Atomics.wait`, which is the one way a synchronous caller can
// wait for an asynchronous answer in Node.
//
// The paths are the container's own (`CD_SESSION_DIR`, i.e. `SESSIONS_DIR_IN_IMAGE`) and nothing here resolves or
// checks them: the app confines what it will act on, because a check made inside the untrusted container is a check
// plugin code could edit out.

import { Worker } from "node:worker_threads";

import { createLogger } from "@/logger";
import {
  CONTROL_ANSWER,
  CONTROL_BYTES,
  CONTROL_DRAINED,
  CONTROL_LENGTH,
  CONTROL_MORE,
  CONTROL_SLOTS,
  STORAGE_WINDOW_BYTES,
} from "@/pi-agent-host/sessionStorageChannel";
import type {
  SessionStorageAnswer,
  SessionStorageCall,
  SessionStorageDirEntry,
  SessionStorageFileInfo,
  SessionStorageValue,
} from "@/pi-bridge/sessionStorage";

const logger = createLogger("pi-agent-host.sessionStorage");

// pi's port, declared here because the PUBLISHED package does not export it yet: the seam is our own upstream patch
// (`support/agent-image/pi-patch`, from `.scratch/pi-gui-coding-agent/upstream/0001-session-storage-port.patch`) and
// the image copies it over pi's compiled files, while `node_modules` here stays the released version. Structural, so
// it satisfies the real one the moment a pi release carries it — and the image build already fails loudly when the
// seam is unreachable, so this cannot silently drift.
export interface PiSessionStorage {
  exists(path: string): boolean;
  fileInfo(path: string): SessionStorageFileInfo;
  readTextFile(path: string): string;
  readTextLines(path: string, options?: { maxLines?: number; maxBytes?: number }): Iterable<string>;
  listDir(path: string): SessionStorageDirEntry[];
  createDir(path: string): void;
  writeTextFile(path: string, contents: string, options?: { exclusive?: boolean }): void;
  appendTextFile(path: string, contents: string): void;
}

// What actually carries one call. Injected so the port's own behaviour — the shapes it demands, the errors it raises,
// the early stop its line generator allows — is settled by a fake, leaving only the shared-window mechanics to the
// live proof.
export interface SessionStorageTransport {
  invoke(call: SessionStorageCall): SessionStorageAnswer;
}

// Generous, and a bound rather than none: the app dials this store before it says `hello`, so in practice the first
// call is answered at once. Without a bound a store that never connects would wedge the session with no diagnosis;
// with one, pi surfaces a storage error the user can read.
const CALL_TIMEOUT_MS = 30_000;

export class SessionStorageError extends Error {}

// Named ENOENT so `SessionManager`'s own branch on a missing file still works: it expects `fileInfo` to throw the way
// `statSync` does, and a generic error there would read as a broken store rather than an absent conversation.
export class SessionStorageMissingError extends Error {
  constructor(message: string) {
    super(`ENOENT: ${message}`);
  }
}

// Each accessor names the shape it expects, so a store answering the wrong kind is a loud error here rather than an
// `undefined` that surfaces three frames into pi.
function expect<K extends SessionStorageValue["kind"]>(
  answer: SessionStorageAnswer,
  kind: K,
): Extract<SessionStorageValue, { kind: K }> {
  if (!answer.ok) {
    if (answer.code === "not-found") throw new SessionStorageMissingError(answer.error);
    throw new SessionStorageError(answer.error);
  }
  if (answer.value.kind !== kind) {
    throw new SessionStorageError(`the conversation store answered ${answer.value.kind} where ${kind} was expected`);
  }
  return answer.value as Extract<SessionStorageValue, { kind: K }>;
}

export function piSessionStorageOver(transport: SessionStorageTransport): PiSessionStorage {
  return {
    exists(path) {
      return expect(transport.invoke({ op: "exists", path }), "boolean").value;
    },
    fileInfo(path) {
      return expect(transport.invoke({ op: "fileInfo", path }), "fileInfo").value;
    },
    readTextFile(path) {
      return expect(transport.invoke({ op: "readTextFile", path }), "text").value;
    },
    // A generator, so pi's bounded header scan still stops after the first entry — and breaking out of THIS costs
    // nothing, because the lines it already holds were one round trip. What it cannot do is stream a line at a time: a
    // blocking round trip per line would be one per entry in the file.
    *readTextLines(path, options) {
      const answer = transport.invoke({
        op: "readTextLines",
        path,
        ...(options?.maxLines ? { maxLines: options.maxLines } : {}),
        ...(options?.maxBytes ? { maxBytes: options.maxBytes } : {}),
      });
      yield* expect(answer, "lines").value.lines;
    },
    listDir(path) {
      return expect(transport.invoke({ op: "listDir", path }), "entries").value;
    },
    createDir(path) {
      expect(transport.invoke({ op: "createDir", path }), "void");
    },
    writeTextFile(path, contents, options) {
      const exclusive = options?.exclusive ? { exclusive: true } : {};
      expect(transport.invoke({ op: "writeTextFile", path, contents, ...exclusive }), "void");
    },
    appendTextFile(path, contents) {
      expect(transport.invoke({ op: "appendTextFile", path, contents }), "void");
    },
  };
  // `readTextLineStream` is deliberately absent. pi falls back to `readTextLines` when a storage does not offer it, and
  // the streaming variant exists to spare the LOCAL filesystem from holding every session whole while listing a
  // directory — a saving that does not exist here, where each file is one round trip either way.
}

export interface WorkerTransportDeps {
  port: number;
  token: string;
  workerPath: string | URL;
  timeoutMs?: number;
}

export interface WorkerTransport extends SessionStorageTransport {
  stop: () => Promise<void>;
}

// The real transport: a worker that owns the socket, and a shared window this thread blocks on.
export function workerSessionStorageTransport(deps: WorkerTransportDeps): WorkerTransport {
  const shared = new SharedArrayBuffer(CONTROL_BYTES + STORAGE_WINDOW_BYTES);
  const control = new Int32Array(shared, 0, CONTROL_SLOTS);
  const window = new Uint8Array(shared, CONTROL_BYTES, STORAGE_WINDOW_BYTES);
  const decoder = new TextDecoder();
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS;

  const worker = new Worker(deps.workerPath, {
    workerData: { shared, port: deps.port, token: deps.token, controlBytes: CONTROL_BYTES },
  });
  // A worker that DIES is reported by the call timeout, since the answer simply never arrives — but the reason belongs
  // in the log, or the timeout is all anyone sees.
  worker.on("error", (error) => logger.error("the conversation store's worker failed", error));

  return {
    invoke(call) {
      Atomics.store(control, CONTROL_ANSWER, 0);
      Atomics.store(control, CONTROL_DRAINED, 0);
      // postMessage only enqueues, which is what makes it safe from a thread that is about to block: the worker's own
      // event loop is what picks it up.
      worker.postMessage(call);

      let text = "";
      for (;;) {
        if (Atomics.wait(control, CONTROL_ANSWER, 0, timeoutMs) === "timed-out") {
          throw new SessionStorageError(`the conversation store did not answer ${call.op} within ${timeoutMs}ms`);
        }
        const length = Atomics.load(control, CONTROL_LENGTH);
        const more = Atomics.load(control, CONTROL_MORE);
        // Decoded BEFORE the window is released, or the worker's next chunk would overwrite the bytes being read.
        text += decoder.decode(window.subarray(0, length));
        Atomics.store(control, CONTROL_ANSWER, 0);
        if (!more) break;
        Atomics.store(control, CONTROL_DRAINED, 1);
        Atomics.notify(control, CONTROL_DRAINED);
      }
      return JSON.parse(text) as SessionStorageAnswer;
    },
    stop: async () => {
      await worker.terminate();
    },
  };
}

// Install the store pi will use. LOUD when the seam is missing: falling back to the container's own filesystem would
// put the user's conversations on the remote machine, which is the exact outcome this replaces — and it would do it
// silently, one pi bump after somebody dropped the patch.
export async function installPiSessionStorage(storage: PiSessionStorage): Promise<void> {
  const pi = (await import("@earendil-works/pi-coding-agent")) as unknown as {
    setSessionStorage?: (storage: PiSessionStorage) => void;
  };
  if (typeof pi.setSessionStorage !== "function") {
    throw new Error(
      "this pi build has no session-storage seam, so the conversations cannot be kept on the user's machine — " +
        "regenerate support/agent-image/pi-patch for the installed pi version",
    );
  }
  pi.setSessionStorage(storage);
}
