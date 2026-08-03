import { describe, expect, it, vi } from "vitest";

import type {
  ProjectContextStore,
  ProjectContextStoreSnapshot,
  ProjectContextWorkspaceRecord,
} from "@/ai-system/core/projectContext";
import { createProjectContextHost } from "@/ai-system/host/projectContextHost";
import type { IWorkspaceAccess, WorkspaceDirEntry, WorkspaceStat } from "@/host-contract/workspaceAccess";

function memoryStore(
  snapshot: Omit<ProjectContextStoreSnapshot, "path"> = { status: "missing", workspaces: [] },
): ProjectContextStore & { records: () => ProjectContextWorkspaceRecord[] } {
  let records = structuredClone(snapshot.workspaces);
  return {
    records: () => structuredClone(records),
    load: vi.fn(async () => ({ ...snapshot, workspaces: structuredClone(records), path: "/private/context.json" })),
    save: vi.fn(async (next) => {
      records = structuredClone(next);
    }),
  };
}

function workspace(
  getRoot: () => string,
  initial: Record<string, { content: string; modifiedAt?: number }> = {},
): IWorkspaceAccess & { writes: Array<{ path: string; contents: string }> } {
  const files = new Map(Object.entries(initial));
  const writes: Array<{ path: string; contents: string }> = [];
  const entries = (path = "."): WorkspaceDirEntry[] => {
    const prefix = path === "." ? "" : `${path}/`;
    const found = new Map<string, WorkspaceDirEntry["kind"]>();
    for (const name of files.keys()) {
      if (!name.startsWith(prefix)) continue;
      const rest = name.slice(prefix.length);
      const [first, ...tail] = rest.split("/");
      if (first) found.set(first, tail.length ? "directory" : "file");
    }
    return [...found].map(([name, kind]) => ({ name, kind }));
  };
  return {
    writes,
    root: vi.fn(async () => getRoot()),
    read: vi.fn(async (path: string) => {
      const file = files.get(path);
      if (!file) throw new Error(`Path not found in the workspace: ${path}`);
      return file.content;
    }),
    write: vi.fn(async (path: string, contents: string) => {
      writes.push({ path, contents });
      files.set(path, { content: contents, modifiedAt: 50 });
    }),
    writeNew: vi.fn(async (path: string, contents: string) => {
      if (files.has(path)) return "exists" as const;
      writes.push({ path, contents });
      files.set(path, { content: contents, modifiedAt: 50 });
      return "created" as const;
    }),
    list: vi.fn(async (path?: string) => entries(path)),
    stat: vi.fn(async (path: string): Promise<WorkspaceStat> => {
      const file = files.get(path);
      if (!file) throw new Error(`Path not found in the workspace: ${path}`);
      return {
        path,
        kind: "file",
        size: new TextEncoder().encode(file.content).byteLength,
        modifiedMs: file.modifiedAt ?? 10,
      };
    }),
  } as unknown as IWorkspaceAccess & { writes: Array<{ path: string; contents: string }> };
}

function host(
  options: {
    store?: ProjectContextStore;
    workspace?: IWorkspaceAccess;
    getRoot?: () => string;
    rulesTemplate?: string;
  } = {},
) {
  const getRoot = options.getRoot ?? (() => "/workspace");
  return createProjectContextHost({
    store: options.store ?? memoryStore(),
    workspace: options.workspace ?? workspace(getRoot, { "AGENTS.md": { content: "Project rule.", modifiedAt: 9 } }),
    fingerprint: async (value) => `${value.length.toString(16).padStart(64, "0")}`.slice(-64),
    nextId: () => "memory-new",
    now: () => 100,
    rulesTemplate: options.rulesTemplate ?? "# Project rules\n",
  });
}

describe("project context host", () => {
  it("keeps rule inclusion explicit, memory workspace-keyed, and capture exact", async () => {
    let root = "/workspace";
    const store = memoryStore();
    const context = host({
      store,
      getRoot: () => root,
      workspace: workspace(() => root, { "AGENTS.md": { content: "Rule" } }),
    });
    await context.ready();

    const disabled = await context.snapshot();
    expect(disabled.state).toBe("ready");
    if (disabled.state !== "ready") throw new Error("expected ready context");
    expect(disabled.rules).toEqual([expect.objectContaining({ path: "AGENTS.md", status: "ready", included: false })]);
    expect(disabled.pack.sections).toEqual([]);

    const enabled = await context.setRulesEnabled(true);
    expect(enabled.state).toBe("ready");
    if (enabled.state !== "ready") throw new Error("expected ready context");
    expect(enabled.pack.sections).toEqual([expect.objectContaining({ kind: "rules", content: "Rule" })]);

    const remembered = await context.addMemory("Prefer focused tests.");
    expect(remembered.state).toBe("ready");
    if (remembered.state !== "ready") throw new Error("expected ready context");
    expect(remembered.pack.sections.map(({ kind }) => kind)).toEqual(["rules", "memory"]);
    expect(remembered.pack.initialTaint).toBe(true);

    root = "/other";
    const other = await context.snapshot();
    expect(other.state).toBe("ready");
    if (other.state !== "ready") throw new Error("expected ready context");
    expect(other.memory).toEqual([]);
    expect(other.rulesEnabled).toBe(false);

    root = "/workspace";
    const restored = await context.capture();
    expect(restored?.fingerprint).toBe(remembered.pack.fingerprint);
    expect(store.records()).toHaveLength(1);
  });

  it("initializes only the app-native rule file and never overwrites an existing file", async () => {
    const existingWorkspace = workspace(() => "/workspace", {
      ".container-desktop/rules.md": { content: "Keep me" },
    });
    const existing = host({ workspace: existingWorkspace });
    await existing.ready();

    expect((await existing.initializeRules()).result).toBe("exists");
    expect(existingWorkspace.writes).toEqual([]);

    const emptyWorkspace = workspace(() => "/workspace");
    const empty = host({ workspace: emptyWorkspace, rulesTemplate: "# New rules\n" });
    await empty.ready();

    expect((await empty.initializeRules()).result).toBe("created");
    expect(emptyWorkspace.writes).toEqual([{ path: ".container-desktop/rules.md", contents: "# New rules\n" }]);
  });

  it("fails closed when the private store is unreadable or persistence fails", async () => {
    const unreadable = host({ store: memoryStore({ status: "error", workspaces: [] }) });
    await unreadable.ready();

    expect(await unreadable.snapshot()).toMatchObject({ state: "unavailable" });
    await expect(unreadable.addMemory("Do not persist")).rejects.toThrow(/unreadable/);

    const store = memoryStore();
    store.save = vi.fn(async () => {
      throw new Error("disk full");
    });
    const context = host({ store });
    await context.ready();

    await expect(context.addMemory("Do not retain after failure")).rejects.toThrow("disk full");
    const snapshot = await context.snapshot();
    expect(snapshot.state).toBe("ready");
    if (snapshot.state !== "ready") throw new Error("expected ready context");
    expect(snapshot.memory).toEqual([]);
  });

  it("preserves imported memory freshness while assigning local opaque IDs", async () => {
    const context = host();
    await context.ready();

    const snapshot = await context.importMemory(
      JSON.stringify({
        version: 1,
        entries: [{ content: "Imported preference.", createdAt: 20, updatedAt: 30 }],
      }),
    );

    expect(snapshot.state).toBe("ready");
    if (snapshot.state !== "ready") throw new Error("expected ready context");
    expect(snapshot.memory).toEqual([
      {
        id: "memory-new",
        content: "Imported preference.",
        source: "import",
        createdAt: 20,
        updatedAt: 30,
      },
    ]);
  });
});
