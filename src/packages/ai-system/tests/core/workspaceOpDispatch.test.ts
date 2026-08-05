import { describe, expect, it, vi } from "vitest";

import { dispatchWorkspaceOp, parseWorkspaceOpRequest } from "@/ai-system/core/workspaceOpDispatch";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

function workspace(overrides: Partial<IWorkspaceAccess> = {}) {
  const port = {
    root: vi.fn(async () => "/work"),
    read: vi.fn(async () => "contents"),
    write: vi.fn(async () => undefined),
    writeNew: vi.fn(async () => "created" as const),
    edit: vi.fn(async () => ({ path: "a.ts", before: "a", after: "b", replacements: 1 })),
    list: vi.fn(async () => [{ name: "src", kind: "directory" as const }]),
    stat: vi.fn(async () => ({ path: "a.ts", kind: "file" as const, size: 3, modifiedMs: 1 })),
    remove: vi.fn(async () => undefined),
    glob: vi.fn(async () => ["src/a.ts"]),
    grep: vi.fn(async () => [{ path: "src/a.ts", line: 2, text: "hit" }]),
    exec: vi.fn(async () => ({ program: "ls", args: [], code: 0, stdout: "a", stderr: "", truncated: false })),
    ...overrides,
  };
  return port as unknown as IWorkspaceAccess & typeof port;
}

describe("parseWorkspaceOpRequest", () => {
  it("accepts a workspace tool name and defaults its args", () => {
    expect(parseWorkspaceOpRequest({ op: "listDirectory" })).toEqual({ op: "listDirectory", args: {} });
    expect(parseWorkspaceOpRequest({ op: "readFile", args: { path: "a.ts" } })).toEqual({
      op: "readFile",
      args: { path: "a.ts" },
    });
  });

  // Not an error to report to the model — a request this app does not serve at all. A container operation travels on
  // its own method, and anything reachable through the prototype is not an operation.
  it("refuses anything that is not a workspace tool", () => {
    for (const op of ["listContainers", "constructor", "toString", "", "root", "writeNew"]) {
      expect(parseWorkspaceOpRequest({ op }), op).toBeUndefined();
    }
    expect(parseWorkspaceOpRequest({})).toBeUndefined();
  });

  it("ignores args that are not an object, rather than passing them on", () => {
    expect(parseWorkspaceOpRequest({ op: "readFile", args: ["a.ts"] })).toEqual({ op: "readFile", args: {} });
    expect(parseWorkspaceOpRequest({ op: "readFile", args: "a.ts" })).toEqual({ op: "readFile", args: {} });
  });
});

describe("dispatchWorkspaceOp", () => {
  it("says there is nowhere to run when the session chose no target", async () => {
    const result = await dispatchWorkspaceOp(undefined, { op: "readFile", args: { path: "a.ts" } });
    expect(result).toEqual({
      ok: false,
      error: "This session has no workspace target, so workspace tools cannot run. Choose one when starting a session.",
    });
  });

  it("routes each read to the port method that answers it", async () => {
    const port = workspace();
    await expect(dispatchWorkspaceOp(port, { op: "readFile", args: { path: "a.ts" } })).resolves.toEqual({
      ok: true,
      value: "contents",
    });
    expect(port.read).toHaveBeenCalledWith("a.ts");

    await dispatchWorkspaceOp(port, { op: "listDirectory", args: {} });
    expect(port.list).toHaveBeenCalledWith(undefined);
    await dispatchWorkspaceOp(port, { op: "listDirectory", args: { path: "src" } });
    expect(port.list).toHaveBeenCalledWith("src");

    await dispatchWorkspaceOp(port, { op: "statPath", args: { path: "a.ts" } });
    expect(port.stat).toHaveBeenCalledWith("a.ts");
    await dispatchWorkspaceOp(port, { op: "findFiles", args: { pattern: "src/**/*.ts" } });
    expect(port.glob).toHaveBeenCalledWith("src/**/*.ts");
  });

  it("passes only the search options the model actually gave", async () => {
    const port = workspace();
    await dispatchWorkspaceOp(port, { op: "searchText", args: { pattern: "TODO" } });
    expect(port.grep).toHaveBeenLastCalledWith("TODO", {});
    await dispatchWorkspaceOp(port, { op: "searchText", args: { pattern: "TODO", glob: "*.ts", maxResults: 5 } });
    expect(port.grep).toHaveBeenLastCalledWith("TODO", { glob: "*.ts", maxResults: 5 });
    // A string where a number belongs is not a cap — passing it on would hand the host junk to interpret.
    await dispatchWorkspaceOp(port, { op: "searchText", args: { pattern: "TODO", maxResults: "many" } });
    expect(port.grep).toHaveBeenLastCalledWith("TODO", {});
  });

  it("routes each mutation, and reports what it did", async () => {
    const port = workspace();
    await expect(
      dispatchWorkspaceOp(port, { op: "writeFile", args: { path: "a.ts", contents: "x" } }),
    ).resolves.toEqual({ ok: true, value: { path: "a.ts", written: true } });
    expect(port.write).toHaveBeenCalledWith("a.ts", "x");

    await expect(dispatchWorkspaceOp(port, { op: "removePath", args: { path: "a.ts" } })).resolves.toEqual({
      ok: true,
      value: { path: "a.ts", removed: true },
    });
    expect(port.remove).toHaveBeenCalledWith("a.ts");

    // The before/after the diff card renders comes straight back from the port.
    await expect(
      dispatchWorkspaceOp(port, { op: "editFile", args: { path: "a.ts", oldString: "a", newString: "b" } }),
    ).resolves.toEqual({ ok: true, value: { path: "a.ts", before: "a", after: "b", replacements: 1 } });
    expect(port.edit).toHaveBeenCalledWith("a.ts", "a", "b", false);
    await dispatchWorkspaceOp(port, {
      op: "editFile",
      args: { path: "a.ts", oldString: "a", newString: "b", replaceAll: true },
    });
    expect(port.edit).toHaveBeenLastCalledWith("a.ts", "a", "b", true);
  });

  // An empty replacement IS the edit — deleting a line. Only a wrong type is a missing argument.
  it("treats an empty newString as an answer, not as a missing argument", async () => {
    const port = workspace();
    await expect(
      dispatchWorkspaceOp(port, { op: "editFile", args: { path: "a.ts", oldString: "a", newString: "" } }),
    ).resolves.toMatchObject({ ok: true });
    expect(port.edit).toHaveBeenCalledWith("a.ts", "a", "", false);
  });

  it("runs a command with no arguments as a command with no arguments", async () => {
    const port = workspace();
    await dispatchWorkspaceOp(port, { op: "execCommand", args: { program: "ls" } });
    expect(port.exec).toHaveBeenCalledWith("ls", []);
    await dispatchWorkspaceOp(port, { op: "execCommand", args: { program: "ls", args: ["-la", "src"] } });
    expect(port.exec).toHaveBeenLastCalledWith("ls", ["-la", "src"]);
  });

  it("refuses argv that is not a list of strings rather than handing it to the host", async () => {
    const port = workspace();
    const result = await dispatchWorkspaceOp(port, { op: "execCommand", args: { program: "ls", args: [1, 2] } });
    expect(result).toEqual({ ok: false, error: "args must be an array of strings" });
    expect(port.exec).not.toHaveBeenCalled();
  });

  it("says which argument was missing instead of calling the port with undefined", async () => {
    const port = workspace();
    expect(await dispatchWorkspaceOp(port, { op: "readFile", args: {} })).toEqual({
      ok: false,
      error: "path is required and must be a string",
    });
    expect(port.read).not.toHaveBeenCalled();
  });

  // The target's own message is what tells the model what to do next; a generic failure makes it retry the same call.
  it("carries the target's own failure back as a value", async () => {
    const port = workspace({
      read: vi.fn(async () => {
        throw new Error("ENOENT: no such file or directory, open '/work/nope.ts'");
      }),
    });
    expect(await dispatchWorkspaceOp(port, { op: "readFile", args: { path: "nope.ts" } })).toEqual({
      ok: false,
      error: "ENOENT: no such file or directory, open '/work/nope.ts'",
    });
  });

  it("refuses an operation name that is not a workspace tool, even past the parser", async () => {
    expect(await dispatchWorkspaceOp(workspace(), { op: "listContainers" })).toEqual({
      ok: false,
      error: "Unknown workspace operation: listContainers",
    });
  });
});
