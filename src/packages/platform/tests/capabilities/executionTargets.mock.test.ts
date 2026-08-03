// Hermetic MOCK arm of the worker-execution-target matrix. Runs the SAME scenarios as the live arm
// (webdriver/specs/off-host-exec.e2e.js) against an in-memory VirtualEngineHost, so the real run host,
// execution selector and exec-routed workspace are exercised with no engines — it stays in the default suite and
// catches LOGIC regressions (a write that does not read back, a floor/root/scoping mistake, a sandbox left alive).

import { runExecutionTargetMatrix } from "@/__tests__/support/executionTargetMatrixSuite";
import { createVirtualEngineHost } from "@/ai-system/testing/virtualEngineHost";

runExecutionTargetMatrix("mock", async () => {
  const host = createVirtualEngineHost();
  const connectionId = "mock-connection";
  // A plain (unlabeled) container the existing-container target attaches to.
  const existingContainerId = host.createContainer();
  // A minimal in-memory host workspace, so the host target roundtrips too.
  const files = new Map<string, string>();
  const localWorkspace = {
    root: async () => "/mock-workspace",
    read: async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`not found: ${path}`);
      return value;
    },
    write: async (path: string, contents: string) => {
      files.set(path, contents);
    },
    writeNew: async (path: string, contents: string) => {
      if (files.has(path)) return "exists" as const;
      files.set(path, contents);
      return "created" as const;
    },
    edit: async (path: string, oldString: string, newString: string) => {
      const before = files.get(path) ?? "";
      const after = before.replace(oldString, newString);
      files.set(path, after);
      return { path, before, after, replacements: before === after ? 0 : 1 };
    },
    list: async () => [...files.keys()].map((name) => ({ name, kind: "file" as const })),
    stat: async (path: string) => ({
      path,
      kind: "file" as const,
      size: (files.get(path) ?? "").length,
      modifiedMs: 0,
    }),
    remove: async (path: string) => {
      files.delete(path);
    },
    glob: async () => [...files.keys()],
    grep: async (pattern: string) => {
      const matches: { path: string; line: number; text: string }[] = [];
      const re = new RegExp(pattern);
      for (const [path, contents] of files) {
        contents.split("\n").forEach((text, i) => {
          if (re.test(text)) matches.push({ path, line: i + 1, text });
        });
      }
      return matches;
    },
    exec: async (program: string, args: string[]) => ({
      program,
      args,
      code: 0,
      stdout: `${[program, ...args].slice(1).join(" ")}\n`,
      stderr: "",
      truncated: false,
    }),
  };

  return {
    connectionId,
    connectionExec: host,
    localWorkspace,
    image: "alpine:3",
    supportsRemote: true,
    existingContainerId,
    pendingSandboxes: () => host.liveSandboxes().length,
  };
});
