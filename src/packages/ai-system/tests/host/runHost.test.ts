import { describe, expect, it } from "vitest";

import type { ExecutionSelectorFactory, ResolvedExecution } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunView, StartRunRequest } from "@/ai-system/core/runEvents";
import type { AISettings, ResolvedWorker, TeamRunCreationOptions, TeamRunPort } from "@/ai-system/core/types";
import {
  executionTargetKey,
  floorScopeFor,
  type WorkerDefinition,
  type WorkerExecutionTarget,
} from "@/ai-system/core/workers";
import { createRunHost } from "@/ai-system/host/runHost";

function workerDef(id: string, execution: WorkerExecutionTarget): WorkerDefinition {
  return {
    id,
    name: id,
    specialty: "",
    systemPrompt: "",
    model: "",
    toolPolicy: { mode: "granular", allowed: [] },
    execution,
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeSelector(opts: { offline?: string } = {}) {
  const disposed: string[] = [];
  const selected: string[] = [];
  const factory: ExecutionSelectorFactory = () => {
    const cache = new Map<string, Promise<ResolvedExecution>>();
    return {
      select(target) {
        const key = executionTargetKey(target);
        let existing = cache.get(key);
        if (!existing) {
          existing = (async () => {
            selected.push(key);
            if (target.kind !== "host" && target.connectionId === opts.offline) {
              throw new Error(`Connection "${target.connectionId}" is not running.`);
            }
            return {
              engineOps: undefined,
              workspaceAccess: { root: async () => key } as unknown as ResolvedExecution["workspaceAccess"],
              floorScope: floorScopeFor(target),
              dispose: async () => {
                disposed.push(key);
              },
            } satisfies ResolvedExecution;
          })();
          cache.set(key, existing);
        }
        return existing;
      },
    };
  };
  return { factory, disposed, selected };
}

function makeHost(workers: WorkerDefinition[], selectorFactory?: ExecutionSelectorFactory) {
  let captured: TeamRunCreationOptions | undefined;
  const runDisposed: string[] = [];
  const createTeamRun = (options: TeamRunCreationOptions): TeamRunPort => {
    captured = options;
    return {
      start: async () => ({}) as Awaited<ReturnType<TeamRunPort["start"]>>,
      resolvePlan: async () => ({}) as Awaited<ReturnType<TeamRunPort["resolvePlan"]>>,
      resolveToolApproval: async () => ({}) as Awaited<ReturnType<TeamRunPort["resolveToolApproval"]>>,
      cancel: async () => undefined,
      snapshot: () => ({ runId: options.runId, phase: "done" }) as unknown as RunView,
      dispose: async () => {
        runDisposed.push(options.runId);
      },
    };
  };

  const host = createRunHost<number>({
    senderId: (e) => e,
    send: () => undefined,
    getAISettings: async () => ({ webSearch: false, permissionMode: "ask" }) as AISettings,
    resolveProviderAccess: async () => ({ id: "p", model: "m" }) as unknown as ResolvedProvider,
    providerTransport: {} as never,
    buildAgentPrompt: () => "PROMPT",
    createTeamRun,
    runSandboxed: async () => ({
      ok: true,
      tier: "ran",
      reason: "",
      stdout: "",
      stderr: "",
      code: 0,
      truncated: false,
    }),
    knowledgeBank: { search: async () => [] },
    workerHost: {
      ready: () => true,
      list: () => workers,
      save: async () => undefined,
      remove: async () => undefined,
      resolveIds: () => workers,
    } as never,
    createExecutionSelector: selectorFactory,
    reportError: () => undefined,
  });

  const request: StartRunRequest = {
    runId: "run1",
    goal: "do it",
    workerIds: workers.map((w) => w.id),
  } as StartRunRequest;

  return { host, request, capturedWorkers: () => captured?.taskSettings.workers as ResolvedWorker[], runDisposed };
}

describe("runHost — per-worker execution targets", () => {
  it("without a selector, workers carry no per-worker execution (host fallback)", async () => {
    const { host, request, capturedWorkers } = makeHost([workerDef("w1", { kind: "host" })]);
    await host.start(1, request);
    const worker = capturedWorkers().find((w) => w.id === "w1");
    expect(worker?.execution).toBeUndefined();
    expect(worker?.floorScope).toBeUndefined();
  });

  it("resolves each worker's target and shares one backend per distinct target", async () => {
    const selector = fakeSelector();
    const target: WorkerExecutionTarget = { kind: "sandbox", connectionId: "c1", image: "alpine:3" };
    const { host, request, capturedWorkers } = makeHost(
      [workerDef("w1", target), workerDef("w2", target), workerDef("w3", { kind: "host" })],
      selector.factory,
    );
    await host.start(1, request);

    const workers = capturedWorkers();
    expect(workers.find((w) => w.id === "w1")?.floorScope).toBe("sandbox");
    expect(workers.find((w) => w.id === "w3")?.floorScope).toBe("strict");
    expect(workers.find((w) => w.id === "w1")?.execution?.workspaceAccess).toBeDefined();
    // Two workers on the same sandbox target share ONE resolved backend (selected once for that key).
    expect(selector.selected.filter((k) => k === executionTargetKey(target))).toHaveLength(1);
  });

  it("disposes every distinct backend once when the run is disposed", async () => {
    const selector = fakeSelector();
    const { host, request } = makeHost(
      [
        workerDef("w1", { kind: "sandbox", connectionId: "c1", image: "alpine:3" }),
        workerDef("w2", { kind: "container", connectionId: "c1", containerId: "cid" }),
      ],
      selector.factory,
    );
    await host.start(1, request);
    host.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(selector.disposed.sort()).toEqual(["container:c1:cid", "sandbox:c1:alpine:3"]);
  });

  it("fails the run start when a target's connection is offline (no host fallback)", async () => {
    const selector = fakeSelector({ offline: "c1" });
    const { host, request } = makeHost(
      [workerDef("w1", { kind: "container", connectionId: "c1", containerId: "cid" })],
      selector.factory,
    );
    await expect(host.start(1, request)).rejects.toThrow(/not running/);
  });
});
