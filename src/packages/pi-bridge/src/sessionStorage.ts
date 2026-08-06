// The wire contract for a conversation store that lives on the USER's machine while pi runs somewhere else.
//
// Its own protocol and its own socket, deliberately not `BridgeCommand`/`BridgeEvent`. pi's `SessionStorage` port is
// SYNCHRONOUS — `appendMessage` returns an entry id, `create`/`open` touch the store in their constructors — so the
// container's main thread BLOCKS on every call. If these answers arrived on the bridge socket, the blocked main
// thread would never read them: an immediate deadlock. They arrive on a second socket owned by a worker thread, and
// the bridge's own lifetime (a session, its events, its host requests) has nothing to do with this one's.
//
// Pure types plus two constants: no Node, no DOM, so both ends import the same file.
export const PI_SESSION_STORAGE_PROTOCOL_VERSION = 1;

// The port the worker's storage server listens on INSIDE the container. Published to the app's loopback under a
// port the app picks, exactly as the bridge is.
export const PI_SESSION_STORAGE_CONTAINER_PORT = 8789;

// What pi asks its storage for. One member per `SessionStorage` method, with the two write flags the port
// distinguishes — `exclusive` is node's `wx`, which a fork and a first flush both depend on to refuse landing on a
// file that already exists.
export type SessionStorageCall =
  | { op: "exists"; path: string }
  | { op: "fileInfo"; path: string }
  | { op: "readTextFile"; path: string }
  // Byte-capped rather than lazy. pi's port iterates lines so a session bigger than Node's maximum string length can
  // still be read; across an RPC a call per line would cost a blocking round trip per line, so the cap travels
  // instead and the server sends only the whole lines that fit. `truncated` is how the caller tells "the file ends
  // here" from "the cap stopped me", which is the distinction the bounded header scan is built on.
  | { op: "readTextLines"; path: string; maxLines?: number; maxBytes?: number }
  | { op: "listDir"; path: string }
  | { op: "createDir"; path: string }
  | { op: "writeTextFile"; path: string; contents: string; exclusive?: boolean }
  | { op: "appendTextFile"; path: string; contents: string };

export type SessionStorageOp = SessionStorageCall["op"];

export const SESSION_STORAGE_OPS: ReadonlySet<string> = new Set<SessionStorageOp>([
  "exists",
  "fileInfo",
  "readTextFile",
  "readTextLines",
  "listDir",
  "createDir",
  "writeTextFile",
  "appendTextFile",
]);

export interface SessionStorageFileInfo {
  size: number;
  modifiedMs: number;
}

export interface SessionStorageDirEntry {
  name: string;
  isDirectory: boolean;
}

export interface SessionStorageLines {
  lines: string[];
  // True when a cap stopped the read before the end of the file. A line the cap cut in half is NOT included, so a
  // caller can never mistake a fragment for a whole line.
  truncated: boolean;
}

// One member per call, so a wrong-shaped answer is a type error rather than a cast at the call site.
export type SessionStorageValue =
  | { kind: "boolean"; value: boolean }
  | { kind: "fileInfo"; value: SessionStorageFileInfo }
  | { kind: "text"; value: string }
  | { kind: "lines"; value: SessionStorageLines }
  | { kind: "entries"; value: SessionStorageDirEntry[] }
  | { kind: "void" };

export interface SessionStorageRequest {
  id: number;
  call: SessionStorageCall;
}

// A refusal is a VALUE, not a dropped frame: pi's storage calls throw on failure and the container has to raise
// something a caller can read. `code` exists because `SessionManager` branches on one of them — a missing file is
// ordinary control flow (`exists` is checked separately, but `fileInfo` on a vanished session must throw ENOENT the
// way `statSync` does), while a refusal is a bug or an attack and must not read as "no such file".
export type SessionStorageAnswer =
  | { id: number; ok: true; value: SessionStorageValue }
  | { id: number; ok: false; code: SessionStorageErrorCode; error: string };

export type SessionStorageErrorCode = "not-found" | "exists" | "refused" | "failed";

// The app authenticates to the worker with the session's own bridge token — the same secret, because this socket is
// the same trust boundary: anything that can reach it can read and write the user's conversations.
export interface SessionStorageHello {
  type: "hello";
  token: string;
  version: number;
}

export type SessionStorageFrame = SessionStorageHello | SessionStorageAnswer;

export class SessionStorageProtocolError extends Error {}
