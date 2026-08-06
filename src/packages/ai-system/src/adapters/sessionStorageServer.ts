// Serving the user's conversations to a pi session that runs somewhere this machine's filesystem cannot be mounted.
//
// The bind mount is the answer whenever the engine can see this filesystem. Over SSH it cannot: `resolveGuestPath` is
// the identity there by design, so a directory this app created here simply does not exist on the machine that would
// mount it. pi's `SessionStorage` port is the seam that replaces the mount — the container asks, this answers, and the
// JSONL never leaves the user's disk.
//
// The direction is app → container, the same as the bridge: the container publishes a socket and this dials it. It is
// the container that has to be reachable anyway, and reusing that direction means a remote engine needs the forward
// this app already ships (`bridgeTunnel`) rather than a second, opposite mechanism.

import type { WebSocketLike } from "@/ai-system/adapters/piBridgeClient";
import { resolveSessionStoragePath } from "@/ai-system/core/sessionStorageOps";
import type { FileSystemDirEntry, IFileDiscoverySystem, IPath } from "@/host-contract/fs";
import { createLogger } from "@/logger";
import {
  PI_SESSION_STORAGE_PROTOCOL_VERSION,
  type SessionStorageAnswer,
  type SessionStorageCall,
  type SessionStorageErrorCode,
  type SessionStorageRequest,
  type SessionStorageValue,
} from "@/pi-bridge/sessionStorage";

const logger = createLogger("ai.sessionStorageServer");

export interface SessionStorageServerDeps {
  fs: IFileDiscoverySystem;
  path: IPath;
  // The directory on THIS machine the container's own sessions root stands for. Every accepted call is that directory
  // or one file in it, so this is the only host path the RPC can ever reach.
  sessionsRoot: string;
}

type CallOutcome =
  | { ok: true; value: SessionStorageValue }
  | { ok: false; code: SessionStorageErrorCode; error: string };

function failed(code: SessionStorageErrorCode, error: string): CallOutcome {
  return { ok: false, code, error };
}

// A trailing newline terminates the last line rather than starting an empty one, which is what pi's own reader does.
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// One encoder for the process. Per call it would be an allocation on a path that runs once per line of every
// conversation in the directory whenever pi lists them.
const encoder = new TextEncoder();

// The caps pi's port passes for its bounded header scan, applied to whole lines only: a line a cap cut in half is not
// returned, so the caller cannot mistake a fragment for an entry.
function capLines(lines: string[], call: Extract<SessionStorageCall, { op: "readTextLines" }>): SessionStorageValue {
  // The common case is no cap at all — pi reads a whole conversation — and measuring each line's byte cost then buys
  // nothing. Only the bounded header scan passes one.
  if (call.maxLines === undefined && call.maxBytes === undefined) {
    return { kind: "lines", value: { lines, truncated: false } };
  }
  const maxLines = call.maxLines ?? Number.POSITIVE_INFINITY;
  const maxBytes = call.maxBytes ?? Number.POSITIVE_INFINITY;
  const kept: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    if (kept.length >= maxLines) return { kind: "lines", value: { lines: kept, truncated: true } };
    // +1 for the newline the file spends on it, so a byte cap means the same thing here as it does to a reader
    // walking the file.
    const cost = encoder.encode(line).length + 1;
    if (bytes + cost > maxBytes) return { kind: "lines", value: { lines: kept, truncated: true } };
    bytes += cost;
    kept.push(line);
  }
  return { kind: "lines", value: { lines: kept, truncated: false } };
}

function dirEntries(entries: FileSystemDirEntry[]): SessionStorageValue {
  return {
    kind: "entries",
    value: entries.map((entry) => ({ name: entry.name, isDirectory: entry.kind === "directory" })),
  };
}

// One storage call, resolved and performed. Separated from the socket so the policy and the filesystem behaviour are
// settled by a fake rather than by a live container.
export async function answerSessionStorageCall(
  call: SessionStorageCall,
  deps: SessionStorageServerDeps,
): Promise<CallOutcome> {
  const verdict = resolveSessionStoragePath(call);
  if (!verdict.ok) {
    // Logged loudly: nothing pi does produces one of these, so a refusal means something in the container asked for
    // a path it was never given — a defect, or plugin code trying its luck.
    logger.warn(`refused a conversation-storage call: ${verdict.reason}`);
    return failed("refused", verdict.reason);
  }
  const target = verdict.target === "root" ? deps.sessionsRoot : await deps.path.join(deps.sessionsRoot, verdict.name);

  try {
    switch (call.op) {
      case "exists":
        // A directory is not a "file present", so the root is answered by listing it: it either lists or it does not
        // exist, and pi only asks in order to decide whether to create it.
        if (verdict.target === "root") {
          const present = await deps.fs
            .listDirectory(target)
            .then(() => true)
            .catch(() => false);
          return { ok: true, value: { kind: "boolean", value: present } };
        }
        return { ok: true, value: { kind: "boolean", value: await deps.fs.isFilePresent(target) } };
      case "fileInfo": {
        const stat = await deps.fs.lstat(target);
        return { ok: true, value: { kind: "fileInfo", value: { size: stat.size, modifiedMs: stat.modifiedMs } } };
      }
      case "readTextFile":
        return { ok: true, value: { kind: "text", value: await deps.fs.readTextFile(target) } };
      case "readTextLines":
        return { ok: true, value: capLines(splitLines(await deps.fs.readTextFile(target)), call) };
      case "listDir":
        return { ok: true, value: dirEntries(await deps.fs.listDirectory(target)) };
      case "createDir":
        await deps.fs.mkdir(target, { recursive: true });
        return { ok: true, value: { kind: "void" } };
      case "writeTextFile":
        // pi's `exclusive` is node's `wx`, and the fs port has no atomic equivalent. Checked instead, which is sound
        // HERE for a reason worth writing down rather than a race worth hiding: the caller's storage calls block its
        // own main thread, so one session has exactly one call in flight, and the only other writer of this directory
        // would be a second session — whose file names are uuidv7, never this one. It is not a general-purpose `wx`
        // and must not be reused as one.
        if (call.exclusive && (await deps.fs.isFilePresent(target))) {
          return failed("exists", `the conversation ${verdict.target === "root" ? "" : verdict.name} already exists`);
        }
        await deps.fs.writeTextFile(target, call.contents);
        return { ok: true, value: { kind: "void" } };
      case "appendTextFile":
        await deps.fs.appendTextFile(target, call.contents);
        return { ok: true, value: { kind: "void" } };
    }
  } catch (error) {
    // A read or a stat of something absent is ordinary control flow to pi — `statSync` throws and `SessionManager`
    // branches on it — so it must not read as a refusal.
    const missing = !(await deps.fs.isFilePresent(target).catch(() => true));
    const message = error instanceof Error ? error.message : String(error);
    return failed(missing ? "not-found" : "failed", message);
  }
}

export interface SessionStorageService {
  // Resolves once the container has accepted this connection, so a session is never started against a store that is
  // not answering yet: the container BLOCKS on its first storage call, and a late dial would look like a hang.
  ready: Promise<void>;
  stop: () => void;
}

export interface SessionStorageSocketDeps extends SessionStorageServerDeps {
  // The port on THIS machine the container's store answers on — published loopback for a local engine, the local end
  // of the session's ssh forward for a remote one.
  localPort: number;
  bridgeToken: string;
  connect: (url: string) => WebSocketLike;
  // Called when the socket dies while a session is live. Every storage call after that blocks the container's main
  // thread until its own timeout, so the caller reports the session lost rather than leaving it wedged.
  onLost?: (reason: string) => void;
}

export function serveSessionConversations(deps: SessionStorageSocketDeps): SessionStorageService {
  const socket = deps.connect(`ws://127.0.0.1:${deps.localPort}`);
  let stopped = false;
  let settle: (() => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const lost = (reason: string) => {
    if (stopped) return;
    stopped = true;
    fail?.(new Error(reason));
    logger.warn(reason);
    deps.onLost?.(reason);
  };

  socket.onopen = () => {
    socket.send(
      JSON.stringify({ type: "hello", token: deps.bridgeToken, version: PI_SESSION_STORAGE_PROTOCOL_VERSION }),
    );
    settle?.();
  };
  socket.onmessage = (event) => {
    void (async () => {
      let request: SessionStorageRequest;
      try {
        request = JSON.parse(String(event.data)) as SessionStorageRequest;
      } catch (error) {
        logger.warn("a conversation-storage frame did not parse", error);
        return;
      }
      const outcome = await answerSessionStorageCall(request.call, deps);
      const answer: SessionStorageAnswer = { id: request.id, ...outcome };
      // The container is blocked on this answer, so a send that throws must not be swallowed silently.
      try {
        socket.send(JSON.stringify(answer));
      } catch (error) {
        lost(`answering the conversation store failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  };
  socket.onclose = () => lost("the conversation store's socket closed");
  socket.onerror = (error) => lost(`the conversation store's socket failed: ${String(error)}`);

  return {
    ready,
    stop: () => {
      if (stopped) return;
      stopped = true;
      // Resolved rather than left pending: a caller awaiting readiness when the session is torn down should not hang.
      settle?.();
      try {
        socket.close();
      } catch (error) {
        logger.debug("closing the conversation store's socket failed", error);
      }
    },
  };
}
