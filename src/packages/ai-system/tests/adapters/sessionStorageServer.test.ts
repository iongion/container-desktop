import { describe, expect, it, vi } from "vitest";

import { answerSessionStorageCall, serveSessionConversations } from "@/ai-system/adapters/sessionStorageServer";
import type { FileSystemDirEntry, FileSystemStat, IFileDiscoverySystem, IPath } from "@/host-contract/fs";
import { SESSIONS_DIR_IN_IMAGE } from "@/pi-bridge/image";
import type { SessionStorageCall } from "@/pi-bridge/sessionStorage";

// The app's half of the conversation store: what it does with a call it accepts, and what it refuses to do at all.
// The container is the untrusted side, so the refusals matter as much as the reads.

const ROOT = "/home/me/.local/share/container-desktop/assistant-sessions";

const path: IPath = {
  join: async (...parts) => parts.join("/"),
  basename: async (location) => location.slice(location.lastIndexOf("/") + 1),
  dirname: async (location) => location.slice(0, location.lastIndexOf("/")),
  resolve: async (...parts) => parts.join("/"),
};

function fakeFiles(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const dirs = new Set<string>([ROOT]);
  const fs = {
    readTextFile: async (location: string) => {
      const text = files.get(location);
      if (text === undefined) throw new Error(`ENOENT: ${location}`);
      return text;
    },
    writeTextFile: async (location: string, contents: string) => {
      files.set(location, contents);
    },
    appendTextFile: async (location: string, contents: string) => {
      files.set(location, (files.get(location) ?? "") + contents);
    },
    writePrivateTextFile: async () => {},
    isFilePresent: async (location: string) => files.has(location),
    mkdir: async (location: string) => {
      dirs.add(location);
      return location;
    },
    rename: async () => {},
    listDirectory: async (location: string): Promise<FileSystemDirEntry[]> => {
      if (!dirs.has(location)) throw new Error(`ENOENT: ${location}`);
      return [...files.keys()]
        .filter((file) => file.startsWith(`${location}/`))
        .map((file) => ({ name: file.slice(location.length + 1), kind: "file" as const }));
    },
    lstat: async (location: string): Promise<FileSystemStat> => {
      const text = files.get(location);
      if (text === undefined) throw new Error(`ENOENT: ${location}`);
      return { kind: "file", size: text.length, modifiedMs: 1700 };
    },
    realPath: async (location: string) => location,
    isPathWithin: async () => true,
  } satisfies IFileDiscoverySystem;
  return { files, dirs, deps: { fs, path, sessionsRoot: ROOT } };
}

const inImage = (name: string) => `${SESSIONS_DIR_IN_IMAGE}/${name}`;

describe("answerSessionStorageCall", () => {
  it("maps a container path onto the app's own conversations directory", async () => {
    const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: '{"type":"session"}\n' });
    const answer = await answerSessionStorageCall({ op: "readTextFile", path: inImage("abc.jsonl") }, deps);
    expect(answer).toEqual({ ok: true, value: { kind: "text", value: '{"type":"session"}\n' } });
  });

  it("appends rather than rewriting, which is what keeps a long conversation linear", async () => {
    const { files, deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "one\n" });
    await answerSessionStorageCall({ op: "appendTextFile", path: inImage("abc.jsonl"), contents: "two\n" }, deps);
    expect(files.get(`${ROOT}/abc.jsonl`)).toBe("one\ntwo\n");
  });

  it("refuses a path the container was never given, and says so as a refusal", async () => {
    const { deps } = fakeFiles();
    const answer = await answerSessionStorageCall({ op: "readTextFile", path: "/etc/passwd" }, deps);
    expect(answer).toMatchObject({ ok: false, code: "refused" });
  });

  it("never touches the filesystem for a refused call", async () => {
    // The point of the confinement: a refusal must not be a failed attempt. Anything that reached the fs first would
    // already have created, truncated or read something.
    const { files, deps } = fakeFiles();
    await answerSessionStorageCall(
      { op: "writeTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/../../evil.txt`, contents: "x" },
      deps,
    );
    expect([...files.keys()]).toEqual([]);
  });

  it("reports a missing conversation as not-found, which pi reads as ordinary control flow", async () => {
    const { deps } = fakeFiles();
    const answer = await answerSessionStorageCall({ op: "fileInfo", path: inImage("gone.jsonl") }, deps);
    expect(answer).toMatchObject({ ok: false, code: "not-found" });
  });

  it("answers fileInfo with the size and mtime pi sorts and bounds on", async () => {
    const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "12345" });
    const answer = await answerSessionStorageCall({ op: "fileInfo", path: inImage("abc.jsonl") }, deps);
    expect(answer).toEqual({ ok: true, value: { kind: "fileInfo", value: { size: 5, modifiedMs: 1700 } } });
  });

  it("refuses an exclusive write onto a conversation that already exists", async () => {
    const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "already" });
    const answer = await answerSessionStorageCall(
      { op: "writeTextFile", path: inImage("abc.jsonl"), contents: "new", exclusive: true },
      deps,
    );
    expect(answer).toMatchObject({ ok: false, code: "exists" });
  });

  it("allows a non-exclusive write over one, because that is pi rewriting its own file", async () => {
    const { files, deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "old" });
    const answer = await answerSessionStorageCall(
      { op: "writeTextFile", path: inImage("abc.jsonl"), contents: "new" },
      deps,
    );
    expect(answer).toMatchObject({ ok: true });
    expect(files.get(`${ROOT}/abc.jsonl`)).toBe("new");
  });

  describe("readTextLines", () => {
    const call = (extra: Partial<Extract<SessionStorageCall, { op: "readTextLines" }>> = {}) =>
      ({ op: "readTextLines", path: inImage("abc.jsonl"), ...extra }) as SessionStorageCall;

    it("treats a trailing newline as a terminator, not an empty last line", async () => {
      const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "a\nb\n" });
      const answer = await answerSessionStorageCall(call(), deps);
      expect(answer).toMatchObject({ ok: true, value: { value: { lines: ["a", "b"], truncated: false } } });
    });

    it("keeps a final line that has no newline", async () => {
      const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "a\nb" });
      const answer = await answerSessionStorageCall(call(), deps);
      expect(answer).toMatchObject({ ok: true, value: { value: { lines: ["a", "b"] } } });
    });

    it("stops at a byte cap on a whole-line boundary and says it was cut", async () => {
      // pi's bounded header scan reads the first entry of a file it may not want to open. A half line handed back
      // would parse as a corrupt entry rather than as "not read yet".
      const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "aaaa\nbbbb\ncccc\n" });
      const answer = await answerSessionStorageCall(call({ maxBytes: 7 }), deps);
      expect(answer).toMatchObject({ ok: true, value: { value: { lines: ["aaaa"], truncated: true } } });
    });

    it("honours a line cap", async () => {
      const { deps } = fakeFiles({ [`${ROOT}/abc.jsonl`]: "a\nb\nc\n" });
      const answer = await answerSessionStorageCall(call({ maxLines: 2 }), deps);
      expect(answer).toMatchObject({ ok: true, value: { value: { lines: ["a", "b"], truncated: true } } });
    });
  });

  it("lists the directory as the entries pi filters by suffix", async () => {
    const { deps } = fakeFiles({ [`${ROOT}/a.jsonl`]: "", [`${ROOT}/b.jsonl`]: "" });
    const answer = await answerSessionStorageCall({ op: "listDir", path: SESSIONS_DIR_IN_IMAGE }, deps);
    expect(answer).toEqual({
      ok: true,
      value: {
        kind: "entries",
        value: [
          { name: "a.jsonl", isDirectory: false },
          { name: "b.jsonl", isDirectory: false },
        ],
      },
    });
  });

  it("answers exists for the directory by whether it lists, since a directory is not a file", async () => {
    const present = fakeFiles();
    expect(await answerSessionStorageCall({ op: "exists", path: SESSIONS_DIR_IN_IMAGE }, present.deps)).toEqual({
      ok: true,
      value: { kind: "boolean", value: true },
    });
    const absent = fakeFiles();
    absent.dirs.delete(ROOT);
    expect(await answerSessionStorageCall({ op: "exists", path: SESSIONS_DIR_IN_IMAGE }, absent.deps)).toEqual({
      ok: true,
      value: { kind: "boolean", value: false },
    });
  });

  it("creates the directory when pi asks, and asks for its parents", async () => {
    const { dirs, deps } = fakeFiles();
    dirs.delete(ROOT);
    const answer = await answerSessionStorageCall({ op: "createDir", path: SESSIONS_DIR_IN_IMAGE }, deps);
    expect(answer).toMatchObject({ ok: true });
    expect(dirs.has(ROOT)).toBe(true);
  });
});

// Dialling that store, which is the half a remote session dies on. Two things are still coming up when this runs:
// the container's own listener — pi's storage worker binds a few hundred milliseconds after `run --detach` returns —
// and, for a remote engine, the `ssh -NL` whose local end this dials, which is not bound the instant it is spawned.
// A single-shot connect is refused by one or the other, and the session then fails with a socket error that says
// nothing about the session. The bridge client has retried for exactly this reason since it was written.
describe("serveSessionConversations", () => {
  function fakeSockets() {
    const made: { url: string; socket: Record<string, any> }[] = [];
    const connect = (url: string) => {
      const socket: Record<string, any> = {
        sent: [],
        close: () => {},
        send: (frame: string) => socket.sent.push(frame),
      };
      made.push({ url, socket });
      return socket as never;
    };
    return { made, connect };
  }

  const settings = (connect: (url: string) => never) => ({
    ...fakeFiles().deps,
    localPort: 41999,
    bridgeToken: "tok",
    connect,
    connectRetry: { attempts: 5, delayMs: 1 },
  });

  it("keeps dialling while the port is still coming up, then serves on the one that opened", async () => {
    const { made, connect } = fakeSockets();
    const service = serveSessionConversations(settings(connect));

    // Two refusals, as a forward that has not bound yet and a container that has not listened yet each answer.
    made[0].socket.onerror?.(new Error("ECONNREFUSED"));
    await vi.waitUntil(() => made.length === 2, { timeout: 500 });
    made[1].socket.onclose?.();
    await vi.waitUntil(() => made.length === 3, { timeout: 500 });
    made[2].socket.onopen?.();

    await service.ready;
    // The store announces itself on the socket that opened, not on one of the dead ones.
    expect(JSON.parse(made[2].socket.sent[0])).toMatchObject({ type: "hello", token: "tok" });
    expect(made[0].socket.sent).toHaveLength(0);
  });

  // Once it HAS opened, a death is a real one: every storage call after it blocks the container's main thread, so the
  // session is reported lost rather than quietly re-dialled under a live conversation.
  it("reports a socket that dies after it opened, rather than dialling again", async () => {
    const { made, connect } = fakeSockets();
    const lost: string[] = [];
    const service = serveSessionConversations({ ...settings(connect), onLost: (reason) => lost.push(reason) });
    made[0].socket.onopen?.();
    await service.ready;

    made[0].socket.onclose?.();

    expect(lost).toHaveLength(1);
    expect(made).toHaveLength(1);
  });

  it("gives up saying so, rather than dialling for ever", async () => {
    const { made, connect } = fakeSockets();
    const lost: string[] = [];
    const service = serveSessionConversations({ ...settings(connect), onLost: (reason) => lost.push(reason) });
    // Awaited here and not at the end: `ready` rejects the moment it gives up, and a rejection nobody is holding is
    // an unhandled one — which fails the whole suite rather than this test.
    const refusal = expect(service.ready).rejects.toThrow(/after 5 attempts/);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await vi.waitUntil(() => made.length === attempt + 1, { timeout: 500 });
      made[attempt].socket.onerror?.(new Error("ECONNREFUSED"));
    }

    await refusal;
    expect(lost).toHaveLength(1);
    expect(made).toHaveLength(5);
  });
});
