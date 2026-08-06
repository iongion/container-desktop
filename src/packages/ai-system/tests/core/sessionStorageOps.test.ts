import { describe, expect, it } from "vitest";
import { resolveSessionStoragePath } from "@/ai-system/core/sessionStorageOps";
import { SESSIONS_DIR_IN_IMAGE } from "@/pi-bridge/image";
import type { SessionStorageCall } from "@/pi-bridge/sessionStorage";

// The agent container is the untrusted one — plugin code runs there — and this RPC writes on the user's own machine.
// So the paths it accepts are the narrowest set pi actually asks for: the conversations directory itself, and the
// `.jsonl` files directly inside it. Everything else is refused with a reason rather than attempted.

const read: SessionStorageCall = { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/abc.jsonl` };

describe("resolveSessionStoragePath", () => {
  it("resolves a conversation file to its name, never to a path this layer joined itself", () => {
    // core/ is dependency-free and the host may be Windows, so the join belongs to the async IPath port. Answering
    // with the NAME is what keeps a separator out of pure policy.
    expect(resolveSessionStoragePath(read)).toEqual({ ok: true, target: "file", name: "abc.jsonl" });
  });

  it("resolves the conversations directory itself", () => {
    expect(resolveSessionStoragePath({ op: "listDir", path: SESSIONS_DIR_IN_IMAGE })).toEqual({
      ok: true,
      target: "root",
    });
  });

  it("accepts the directory with a trailing separator, which is the same directory", () => {
    expect(resolveSessionStoragePath({ op: "exists", path: `${SESSIONS_DIR_IN_IMAGE}/` })).toEqual({
      ok: true,
      target: "root",
    });
  });

  describe("refuses", () => {
    const refusals: Array<[string, SessionStorageCall]> = [
      ["a path outside the conversations directory", { op: "readTextFile", path: "/etc/passwd" }],
      [
        "a sibling whose name merely starts the same",
        { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}-x/a.jsonl` },
      ],
      ["traversal out of the directory", { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/../../etc/passwd` }],
      [
        "traversal that lands back inside, because a normalized escape is still an escape attempt",
        { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/../sessions/a.jsonl` },
      ],
      ["a nested directory", { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/nested/a.jsonl` }],
      ["a file that is not a conversation", { op: "readTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/notes.txt` }],
      ["a dotfile dressed as one", { op: "writeTextFile", path: `${SESSIONS_DIR_IN_IMAGE}/.jsonl`, contents: "" }],
      ["a relative path", { op: "readTextFile", path: "abc.jsonl" }],
      ["an empty path", { op: "exists", path: "" }],
      [
        "a NUL byte, which truncates the name for some filesystem APIs",
        {
          op: "readTextFile",
          path: `${SESSIONS_DIR_IN_IMAGE}/a${String.fromCharCode(0)}.jsonl`,
        },
      ],
      [
        "a backslash, which is a separator on the host even though it is not in the container",
        {
          op: "readTextFile",
          path: `${SESSIONS_DIR_IN_IMAGE}/..\\secret.jsonl`,
        },
      ],
    ];

    for (const [what, call] of refusals) {
      it(what, () => {
        const verdict = resolveSessionStoragePath(call);
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.reason).toBeTruthy();
      });
    }
  });

  describe("refuses an operation the target cannot carry", () => {
    it("reading the directory as a file", () => {
      expect(resolveSessionStoragePath({ op: "readTextFile", path: SESSIONS_DIR_IN_IMAGE }).ok).toBe(false);
    });

    it("writing over the directory", () => {
      expect(resolveSessionStoragePath({ op: "writeTextFile", path: SESSIONS_DIR_IN_IMAGE, contents: "x" }).ok).toBe(
        false,
      );
    });

    it("listing a conversation as though it were a directory", () => {
      expect(resolveSessionStoragePath({ op: "listDir", path: `${SESSIONS_DIR_IN_IMAGE}/a.jsonl` }).ok).toBe(false);
    });

    it("creating a conversation as though it were a directory", () => {
      expect(resolveSessionStoragePath({ op: "createDir", path: `${SESSIONS_DIR_IN_IMAGE}/a.jsonl` }).ok).toBe(false);
    });
  });

  it("allows every op pi performs on a conversation file", () => {
    const file = `${SESSIONS_DIR_IN_IMAGE}/abc.jsonl`;
    const calls: SessionStorageCall[] = [
      { op: "exists", path: file },
      { op: "fileInfo", path: file },
      { op: "readTextFile", path: file },
      { op: "readTextLines", path: file, maxBytes: 1024 },
      { op: "writeTextFile", path: file, contents: "x", exclusive: true },
      { op: "appendTextFile", path: file, contents: "x" },
    ];
    for (const call of calls) {
      expect(resolveSessionStoragePath(call), call.op).toEqual({ ok: true, target: "file", name: "abc.jsonl" });
    }
  });

  it("allows every op pi performs on the directory", () => {
    for (const call of [
      { op: "exists", path: SESSIONS_DIR_IN_IMAGE },
      { op: "createDir", path: SESSIONS_DIR_IN_IMAGE },
      { op: "listDir", path: SESSIONS_DIR_IN_IMAGE },
      { op: "fileInfo", path: SESSIONS_DIR_IN_IMAGE },
    ] satisfies SessionStorageCall[]) {
      expect(resolveSessionStoragePath(call), call.op).toEqual({ ok: true, target: "root" });
    }
  });
});
