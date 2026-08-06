import { describe, expect, it, vi } from "vitest";

import {
  piSessionStorageOver,
  SessionStorageError,
  SessionStorageMissingError,
  type SessionStorageTransport,
} from "@/pi-agent-host/sessionStorage";
import type { SessionStorageAnswer, SessionStorageCall, SessionStorageValue } from "@/pi-bridge/sessionStorage";

// The port pi is handed, over a transport that answers without a socket. What matters here is the CONTRACT the
// synchronous port owes pi: the shapes it demands back, the errors it raises for each refusal, and that a bounded read
// stays one round trip. The shared-window mechanics under the real transport are proven live.

function answering(value: SessionStorageValue) {
  const calls: SessionStorageCall[] = [];
  const transport: SessionStorageTransport = {
    invoke(call) {
      calls.push(call);
      return { id: 1, ok: true, value };
    },
  };
  return { calls, storage: piSessionStorageOver(transport) };
}

function refusing(answer: Omit<Extract<SessionStorageAnswer, { ok: false }>, "id">) {
  return piSessionStorageOver({ invoke: () => ({ id: 1, ...answer }) });
}

describe("piSessionStorageOver", () => {
  it("asks for exactly the call pi's method means", () => {
    const { calls, storage } = answering({ kind: "void" });
    storage.appendTextFile("/home/agent/.cd/sessions/a.jsonl", "line\n");
    expect(calls).toEqual([{ op: "appendTextFile", path: "/home/agent/.cd/sessions/a.jsonl", contents: "line\n" }]);
  });

  it("carries pi's exclusive flag, which is what stops a fork landing on an existing conversation", () => {
    const { calls, storage } = answering({ kind: "void" });
    storage.writeTextFile("/x/a.jsonl", "{}", { exclusive: true });
    expect(calls[0]).toMatchObject({ op: "writeTextFile", exclusive: true });
  });

  it("omits the flags pi did not set, so a store cannot read absent as false", () => {
    const { calls, storage } = answering({ kind: "void" });
    storage.writeTextFile("/x/a.jsonl", "{}");
    expect(calls[0]).not.toHaveProperty("exclusive");
  });

  it("reads lines back", () => {
    const { storage } = answering({ kind: "lines", value: { lines: ["a", "b"], truncated: false } });
    expect([...storage.readTextLines("/x/a.jsonl")]).toEqual(["a", "b"]);
  });

  it("costs ONE round trip for a bounded read, however early pi stops", () => {
    // pi's header scan breaks out after the first entry. A transport call per line would be a blocking round trip per
    // entry in the file, which is the whole reason the cap travels instead of the laziness.
    const invoke = vi.fn(
      (_call: SessionStorageCall): SessionStorageAnswer => ({
        id: 1,
        ok: true,
        value: { kind: "lines", value: { lines: ["header", "one", "two"], truncated: true } },
      }),
    );
    const storage = piSessionStorageOver({ invoke });
    for (const line of storage.readTextLines("/x/a.jsonl", { maxBytes: 1024 })) {
      expect(line).toBe("header");
      break;
    }
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ op: "readTextLines", maxBytes: 1024 });
  });

  it("raises ENOENT for a missing conversation, because SessionManager branches on it", () => {
    // pi expects `fileInfo` to throw the way `statSync` does. A generic error here would read as a broken store and
    // fail a session, where an absent file is ordinary control flow.
    const storage = refusing({ ok: false, code: "not-found", error: "no such conversation" });
    expect(() => storage.fileInfo("/x/gone.jsonl")).toThrow(SessionStorageMissingError);
    expect(() => storage.fileInfo("/x/gone.jsonl")).toThrow(/ENOENT/);
  });

  it("raises a plain error for a refusal, which must never read as a missing file", () => {
    const storage = refusing({ ok: false, code: "refused", error: "outside the conversations directory" });
    expect(() => storage.readTextFile("/etc/passwd")).toThrow(SessionStorageError);
    expect(() => storage.readTextFile("/etc/passwd")).not.toThrow(SessionStorageMissingError);
  });

  it("raises rather than returning a value of the wrong shape", () => {
    // An `undefined` handed back to pi surfaces three frames later as something unrelated; this fails where it is
    // wrong.
    const storage = answering({ kind: "text", value: "not a file info" }).storage;
    expect(() => storage.fileInfo("/x/a.jsonl")).toThrow(/answered text where fileInfo was expected/);
  });

  it("does not offer readTextLineStream, so pi falls back to the bounded read", () => {
    // The streaming variant spares the LOCAL filesystem from holding every session whole while listing a directory. It
    // saves nothing across an RPC, where each file is one round trip either way.
    expect(answering({ kind: "void" }).storage).not.toHaveProperty("readTextLineStream");
  });
});
