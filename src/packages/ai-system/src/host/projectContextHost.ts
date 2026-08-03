import {
  buildProjectContextPack,
  PROJECT_CONTEXT_LIMITS,
  PROJECT_RULE_INITIALIZATION_PATH,
  PROJECT_RULE_PATHS,
  type ProjectContextPack,
  type ProjectContextSnapshot,
  type ProjectContextStore,
  type ProjectContextWorkspaceRecord,
  type ProjectMemoryEntry,
  type ProjectRuleDescriptor,
  type ProjectRuleSource,
  parseProjectMemoryImport,
  prepareProjectContextStore,
} from "@/ai-system/core/projectContext";
import { redactText } from "@/ai-system/core/redact";
import type { IWorkspaceAccess, WorkspaceStat } from "@/host-contract/workspaceAccess";

export interface ProjectContextHostDeps {
  store: ProjectContextStore;
  workspace: IWorkspaceAccess;
  fingerprint: (value: string) => Promise<string>;
  nextId: () => string;
  now: () => number;
  rulesTemplate: string;
}

export interface ProjectContextHost {
  ready(): Promise<void>;
  snapshot(): Promise<ProjectContextSnapshot>;
  capture(): Promise<ProjectContextPack | undefined>;
  setRulesEnabled(enabled: boolean): Promise<ProjectContextSnapshot>;
  initializeRules(): Promise<{ result: "created" | "exists"; snapshot: ProjectContextSnapshot }>;
  addMemory(content: string): Promise<ProjectContextSnapshot>;
  removeMemory(id: string): Promise<ProjectContextSnapshot>;
  clearMemory(): Promise<ProjectContextSnapshot>;
  importMemory(text: string): Promise<ProjectContextSnapshot>;
}

interface WorkspaceIdentity {
  workspaceId: string;
  workspaceRoot: string;
}

interface RuleDiscovery {
  descriptors: ProjectRuleDescriptor[];
  sources: ProjectRuleSource[];
}

const STORE_UNREADABLE = "AI: project context record is unreadable";

export function createProjectContextHost(deps: ProjectContextHostDeps): ProjectContextHost {
  let workspaces: ProjectContextWorkspaceRecord[] = [];
  let storeStatus: "ok" | "error" = "ok";
  let mutationTail = Promise.resolve();
  const readyTask = deps.store.load().then((snapshot) => {
    workspaces = structuredClone(snapshot.workspaces);
    storeStatus = snapshot.status === "error" ? "error" : "ok";
  });

  const identity = async (): Promise<WorkspaceIdentity> => {
    const workspaceRoot = await deps.workspace.root();
    return {
      workspaceRoot,
      workspaceId: await deps.fingerprint(`workspace:${workspaceRoot}`),
    };
  };

  const recordFor = (current: WorkspaceIdentity): ProjectContextWorkspaceRecord =>
    workspaces.find(({ workspaceId }) => workspaceId === current.workspaceId) ?? {
      ...current,
      rulesEnabled: false,
      memory: [],
    };

  const discoverRules = async (enabled: boolean): Promise<RuleDiscovery> => {
    const descriptors: ProjectRuleDescriptor[] = [];
    const sources: ProjectRuleSource[] = [];
    for (const path of PROJECT_RULE_PATHS) {
      let before: WorkspaceStat;
      try {
        before = await deps.workspace.stat(path);
      } catch {
        continue;
      }
      if (before.kind !== "file") {
        descriptors.push({
          path,
          status: "unreadable",
          size: before.size,
          modifiedAt: before.modifiedMs,
          included: false,
        });
        continue;
      }
      if (before.size > PROJECT_CONTEXT_LIMITS.ruleFileBytes) {
        descriptors.push({
          path,
          status: "too-large",
          size: before.size,
          modifiedAt: before.modifiedMs,
          included: false,
        });
        continue;
      }
      try {
        const content = await deps.workspace.read(path);
        const after = await deps.workspace.stat(path);
        if (after.kind !== "file" || before.size !== after.size || before.modifiedMs !== after.modifiedMs) {
          descriptors.push({
            path,
            status: "unreadable",
            size: after.size,
            modifiedAt: after.modifiedMs,
            included: false,
          });
          continue;
        }
        const fingerprint = await deps.fingerprint(content);
        sources.push({
          path,
          content,
          size: after.size,
          modifiedAt: after.modifiedMs,
          fingerprint,
        });
        descriptors.push({
          path,
          status: "ready",
          size: after.size,
          modifiedAt: after.modifiedMs,
          fingerprint,
          included: enabled,
        });
      } catch {
        descriptors.push({
          path,
          status: "unreadable",
          size: before.size,
          modifiedAt: before.modifiedMs,
          included: false,
        });
      }
    }
    return { descriptors, sources };
  };

  const currentSnapshot = async (): Promise<ProjectContextSnapshot> => {
    await readyTask;
    if (storeStatus === "error") {
      return { state: "unavailable", rules: [], memory: [], message: STORE_UNREADABLE };
    }
    let current: WorkspaceIdentity;
    try {
      current = await identity();
    } catch (error) {
      return {
        state: "unconfigured",
        rules: [],
        memory: [],
        message: error instanceof Error ? error.message : "AI: no workspace is configured",
      };
    }
    const record = recordFor(current);
    const discovery = await discoverRules(record.rulesEnabled);
    const unavailableRules = record.rulesEnabled
      ? discovery.descriptors.filter(({ status }) => status !== "ready").length
      : 0;
    const pack = await buildProjectContextPack({
      ...current,
      capturedAt: deps.now(),
      rulesEnabled: record.rulesEnabled,
      rules: discovery.sources,
      memory: record.memory,
      fingerprint: deps.fingerprint,
      omittedSources: unavailableRules,
    });
    const includedRules = new Set(pack.sections.filter(({ kind }) => kind === "rules").map(({ source }) => source));
    return {
      state: "ready",
      ...current,
      rulesEnabled: record.rulesEnabled,
      rules: discovery.descriptors.map((descriptor) => ({
        ...descriptor,
        included: descriptor.status === "ready" && includedRules.has(descriptor.path),
      })),
      memory: structuredClone(record.memory),
      pack,
    };
  };

  const mutate = <T>(
    mutation: (
      record: ProjectContextWorkspaceRecord,
      current: WorkspaceIdentity,
    ) => { record: ProjectContextWorkspaceRecord; result: T },
  ): Promise<T> => {
    const operation = mutationTail.then(async () => {
      await readyTask;
      if (storeStatus === "error") throw new Error(STORE_UNREADABLE);
      const current = await identity();
      const previous = recordFor(current);
      const next = mutation(structuredClone(previous), current);
      const exists = workspaces.some(({ workspaceId }) => workspaceId === current.workspaceId);
      if (!exists && workspaces.length >= PROJECT_CONTEXT_LIMITS.workspaces) {
        throw new Error("AI: project context workspace limit reached");
      }
      const records = exists
        ? workspaces.map((record) => (record.workspaceId === current.workspaceId ? next.record : record))
        : [...workspaces, next.record];
      const prepared = prepareProjectContextStore(records);
      await deps.store.save(prepared.workspaces);
      workspaces = structuredClone(prepared.workspaces);
      return next.result;
    });
    mutationTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const mutateAndSnapshot = async (
    mutation: (record: ProjectContextWorkspaceRecord, current: WorkspaceIdentity) => ProjectContextWorkspaceRecord,
  ): Promise<ProjectContextSnapshot> => {
    await mutate((record, current) => ({ record: mutation(record, current), result: undefined }));
    return currentSnapshot();
  };

  const addEntries = (
    record: ProjectContextWorkspaceRecord,
    entries: Array<{
      content: string;
      source: ProjectMemoryEntry["source"];
      createdAt?: number;
      updatedAt?: number;
    }>,
  ): ProjectContextWorkspaceRecord => {
    if (record.memory.length + entries.length > PROJECT_CONTEXT_LIMITS.memoryEntries) {
      throw new Error("AI: project memory is full");
    }
    const created = entries.map((entry, index): ProjectMemoryEntry => {
      const fallback = deps.now() + index;
      const createdAt = entry.createdAt ?? fallback;
      return {
        id: deps.nextId(),
        content: redactText(entry.content.trim()),
        source: entry.source,
        createdAt,
        updatedAt: entry.updatedAt ?? createdAt,
      };
    });
    return { ...record, memory: [...record.memory, ...created] };
  };

  return {
    ready: () => readyTask,
    snapshot: currentSnapshot,
    async capture() {
      const snapshot = await currentSnapshot();
      return snapshot.state === "ready" ? snapshot.pack : undefined;
    },
    setRulesEnabled(enabled) {
      return mutateAndSnapshot((record) => ({ ...record, rulesEnabled: enabled }));
    },
    async initializeRules() {
      await readyTask;
      if (storeStatus === "error") throw new Error(STORE_UNREADABLE);
      await identity();
      const result = await deps.workspace.writeNew(PROJECT_RULE_INITIALIZATION_PATH, deps.rulesTemplate);
      return { result, snapshot: await currentSnapshot() };
    },
    addMemory(content) {
      return mutateAndSnapshot((record) => addEntries(record, [{ content, source: "user" }]));
    },
    removeMemory(id) {
      return mutateAndSnapshot((record) => ({
        ...record,
        memory: record.memory.filter((entry) => entry.id !== id),
      }));
    },
    clearMemory() {
      return mutateAndSnapshot((record) => ({ ...record, memory: [] }));
    },
    importMemory(text) {
      const imported = parseProjectMemoryImport(text);
      return mutateAndSnapshot((record) =>
        addEntries(
          record,
          imported.map((entry) => ({ ...entry, source: "import" })),
        ),
      );
    },
  };
}
