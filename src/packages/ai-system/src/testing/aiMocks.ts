// AI subsystem mock data — activated when CONTAINER_DESKTOP_MOCK=1. The language-model mock speaks the same
// AI-SDK stream protocol as real providers, so session steering, typed tools, and native approvals exercise the
// production AgentSession path instead of a parallel broker-only event script.

import type { LanguageModel } from "ai";
import {
  AI_PERMISSIONS_VERSION,
  type AIPermissionsCache,
  commandKey,
  type PermissionRule,
  type PermissionsList,
  type PermissionsSnapshot,
  type PermissionsStoreLike,
} from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeEntry, SandboxCommand, SandboxExecResult } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunView } from "@/ai-system/core/runEvents";
import type { EngineOps, GoalRunPort, ListedModel } from "@/ai-system/core/types";
import type { WorkerDefinition, WorkerStore, WorkerStoreSnapshot } from "@/ai-system/core/workers";
import mockEngine from "@/resources/ai/mock-engine.json";
import mockGoalRuns from "@/resources/ai/mock-goal-runs.json";
import mockKnowledge from "@/resources/ai/mock-knowledge.json";
import mockModels from "@/resources/ai/mock-models.json";
import mockPermissions from "@/resources/ai/mock-permissions.json";
import mockWorkers from "@/resources/ai/mock-workers.json";
import mockAssistantResponse from "@/resources/prompts/mock-assistant-response.md?raw";
import mockToolResultResponse from "@/resources/prompts/mock-tool-result-response.md?raw";

let mockCallId = 0;
// Mock-only §18 acceptance triggers (production providers never see aiMocks): "hold the tool" makes the next
// listContainers hang long enough to reliably Stop mid-tool (scenario 6); the error phrase fails the stream so the
// task settles to the recoverable error state (scenario 10). Gated mutations for the approval flow: "restart the
// web container" → one gated call; "restart web and cache" (and/both/all) → TWO gated calls in one step so the
// multi-approval batch is drivable live; "remove/delete … container" → a destructive gated call.
let holdToolLong = false;
const HOLD_TOOL_RE = /hold the tool|hang the tool|slow tool/;
const FORCE_ERROR_RE = /simulate (?:a )?(?:model )?error|force error|fail now/;

type MockLanguageModel = Extract<LanguageModel, { specificationVersion: "v3" }>;
type MockStreamOptions = Parameters<MockLanguageModel["doStream"]>[0];
type MockStreamPart =
  Awaited<ReturnType<MockLanguageModel["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;
const MOCK_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
} satisfies Extract<MockStreamPart, { type: "finish" }>["usage"];

// A model stream that errors after a beat (aborts cleanly if the segment is torn down first) — the segment's
// stream loop rejects, so the session settles to `error`. Mirrors a real provider stream failure. Teardown is
// idempotent: the segmentActor aborts the signal AFTER the stream has settled, so close()/error() must run at
// most once (a second call on a settled controller throws ERR_INVALID_STATE — an uncaught crash otherwise).
function errorStream(message: string, signal?: AbortSignal): ReadableStream<MockStreamPart> {
  let settled = false;
  return new ReadableStream({
    start(controller) {
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        controller.error(new Error(message));
      }, 120);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          if (settled) {
            return;
          }
          settled = true;
          controller.close();
        },
        { once: true },
      );
    },
  });
}

function timedStream(chunks: MockStreamPart[], signal?: AbortSignal): ReadableStream<MockStreamPart> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  const settle = (controller: ReadableStreamDefaultController<MockStreamPart>) => {
    if (settled) {
      return;
    }
    settled = true;
    controller.close();
  };
  return new ReadableStream({
    start(controller) {
      let index = 0;
      const next = () => {
        if (signal?.aborted || index >= chunks.length) {
          settle(controller);
          return;
        }
        controller.enqueue(chunks[index]);
        index += 1;
        timer = setTimeout(next, 90);
      };
      signal?.addEventListener(
        "abort",
        () => {
          if (timer) {
            clearTimeout(timer);
          }
          settle(controller);
        },
        { once: true },
      );
      next();
    },
    cancel() {
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  });
}

function textChunks(text: string, id: string): MockStreamPart[] {
  const words = text.split(/(?<=\s)/);
  return [
    { type: "text-start", id },
    ...words.map<MockStreamPart>((delta) => ({ type: "text-delta", id, delta })),
    { type: "text-end", id },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: "stop" },
      usage: MOCK_USAGE,
    },
  ];
}

const TOOL_FINISH: MockStreamPart = {
  type: "finish",
  finishReason: { unified: "tool-calls", raw: "tool-calls" },
  usage: MOCK_USAGE,
};

function toolChunks(toolName: string, input: Record<string, unknown>, id: string): MockStreamPart[] {
  return [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }, TOOL_FINISH];
}

// Emit several gated tool-calls in ONE model step, so the multi-approval batch (allow/reject, cancel mid-batch)
// is exercisable live — the single mock tool-call otherwise left dual-approval unit-only.
function toolChunksMulti(
  calls: Array<{ toolName: string; input: Record<string, unknown> }>,
  id: string,
): MockStreamPart[] {
  return [
    ...calls.map<MockStreamPart>((c, i) => ({
      type: "tool-call",
      toolCallId: `${id}-${i}`,
      toolName: c.toolName,
      input: JSON.stringify(c.input),
    })),
    TOOL_FINISH,
  ];
}

export function createMockLanguageModel(): LanguageModel {
  return {
    specificationVersion: "v3",
    provider: "container-desktop-mock",
    modelId: "mock-assistant",
    supportedUrls: {},
    doGenerate: async () => Promise.reject(new Error("Mock model supports streaming only")),
    doStream: async (options: MockStreamOptions) => {
      mockCallId += 1;
      const id = `mock-${mockCallId}`;
      const serializedPrompt = JSON.stringify(options.prompt).toLowerCase();
      const latestUser = [...(options.prompt ?? [])].reverse().find((message) => message.role === "user");
      const prompt = JSON.stringify(latestUser ?? {}).toLowerCase();
      if (FORCE_ERROR_RE.test(prompt)) {
        return { stream: errorStream("Mock model failure (simulated)", options.abortSignal) };
      }
      const hasToolResult = serializedPrompt.includes('"type":"tool-result"');
      let chunks: MockStreamPart[];
      if (hasToolResult) {
        chunks = textChunks(mockToolResultResponse.trim(), id);
      } else if (HOLD_TOOL_RE.test(prompt)) {
        holdToolLong = true;
        chunks = toolChunks("listContainers", {}, id);
      } else if (/restart\b.*\b(?:and|both|all)\b/.test(prompt)) {
        chunks = toolChunksMulti(
          [
            { toolName: "restartContainer", input: { id: "web" } },
            { toolName: "restartContainer", input: { id: "cache" } },
          ],
          id,
        );
      } else if (/(?:remove|delete)\b.*container/.test(prompt)) {
        chunks = toolChunks("removeContainer", { id: "web" }, id);
      } else if (/restart|stop .*container/.test(prompt)) {
        chunks = toolChunks("restartContainer", { id: "web" }, id);
      } else if (/\bimage/.test(prompt)) {
        chunks = toolChunks("listImages", {}, id);
      } else if (/\bnetwork/.test(prompt)) {
        chunks = toolChunks("listNetworks", {}, id);
      } else if (/\bvolume/.test(prompt)) {
        chunks = toolChunks("listVolumes", {}, id);
      } else if (/\bcontainer|\brunning|\bstopped|\blog/.test(prompt)) {
        chunks = toolChunks("listContainers", {}, id);
      } else {
        chunks = textChunks(mockAssistantResponse.trim(), id);
      }
      return { stream: timedStream(chunks, options.abortSignal) };
    },
  } as LanguageModel;
}

// EngineOps — fixture-backed so the typed tools resolve in mock mode (the scripted runner emits the card
// events directly; this is used when an approved mutation re-runs through the broker, and for completeness).
export function createMockEngineOps(): EngineOps {
  const ok = async () => true;
  const ops: EngineOps = {
    listConnections: () => mockEngine.connections,
    listContainers: async () => {
      // "hold the tool" makes this hang long enough to reliably Stop mid-tool (§18 scenario 6); else a short beat.
      const ms = holdToolLong ? 4000 : 600;
      holdToolLong = false;
      await new Promise((resolve) => setTimeout(resolve, ms));
      return mockEngine.containers;
    },
    inspectContainer: async ({ id }) =>
      mockEngine.containers.find((c) => c.Id.startsWith(id)) ?? mockEngine.containers[0],
    getContainerLogs: async () => "2026-06-30T16:12:15 nginx: ready to handle connections\n... (mock logs) ...",
    getContainerStats: async () => ({ name: "web", memory_stats: { usage: 104857600, limit: 536870912 } }),
    startContainer: ok,
    stopContainer: ok,
    restartContainer: ok,
    pauseContainer: ok,
    unpauseContainer: ok,
    removeContainer: ok,
    listImages: async () => mockEngine.images,
    inspectImage: async () => mockEngine.images[0],
    pullImage: ok,
    removeImage: ok,
    listNetworks: async () => mockEngine.networks,
    inspectNetwork: async () => mockEngine.networks[0],
    removeNetwork: ok,
    listVolumes: async () => mockEngine.volumes,
    inspectVolume: async () => mockEngine.volumes[0],
    removeVolume: ok,
  };
  return ops;
}

// Model listing
// Per-source fixtures so CONTAINER_DESKTOP_MOCK=1 yarn dev exercises every shape the ModelPicker renders:
//   • LM Studio (:1234) — a flat list; the "/" in "unsloth/qwen3.5-9b" is an HF org, NOT a vendor prefix.
//   • OpenRouter (openrouter.ai) — vendor-prefixed ids, driving the 3-level gateway→provider→model path.
//   • llama.cpp (:8080) — exactly one served model (its server binds one at launch via -m).
//   • other clouds — a small generic list so anthropic/openai/… aren't empty in mock mode.
const listedModels = (ids: string[]): ListedModel[] => ids.map((id) => ({ id }));
const LMSTUDIO_MODELS = listedModels(mockModels.lmstudio);
const OPENROUTER_MODELS = listedModels(mockModels.openrouter);
const LLAMACPP_MODELS = listedModels(mockModels.llamacpp);
const GENERIC_CLOUD_MODELS = listedModels(mockModels.cloud);

export function createMockModelLister() {
  return async (provider: ResolvedProvider, _opts?: unknown): Promise<ListedModel[]> => {
    const url = provider.baseURL ?? "";
    if (url.includes("openrouter.ai")) {
      return OPENROUTER_MODELS;
    }
    if (url.includes(":1234")) {
      return LMSTUDIO_MODELS;
    }
    if (url.includes(":8080")) {
      return LLAMACPP_MODELS;
    }
    return GENERIC_CLOUD_MODELS;
  };
}

// Provider key store
// Mock mode: every provider reports a stored secret (so cloud catalogs like OpenRouter's vendor-prefixed
// list are browsable + connection-testable WITHOUT a real key) and writes are no-ops (nothing persisted).
export function createMockKeyStore(): AIKeyStore {
  return {
    getEncryptionStatus: () => ({ available: true, backend: "mock", degraded: false }),
    hasKey: async () => true,
    getKey: async () => "mock-key",
    setKey: async () => {},
    clearKey: async () => {},
  };
}

// Sandbox

export function createMockSandboxRunner() {
  return async (cmd: SandboxCommand, _opts?: { enforceFloor?: boolean }): Promise<SandboxExecResult> => {
    const joined = `${cmd.program} ${cmd.args.join(" ")}`;
    if (joined.includes("version")) {
      return {
        ok: true,
        tier: "SAFE",
        reason: "read-only",
        stdout: '{ "version": "5.4.1-mock" }',
        stderr: "",
        code: 0,
        truncated: false,
      };
    }
    if (joined.includes("ps")) {
      return {
        ok: true,
        tier: "SAFE",
        reason: "read-only",
        stdout: "a1b2c3  nginx  Running  web\nf6e5d4  redis   Running  cache",
        stderr: "",
        code: 0,
        truncated: false,
      };
    }
    if (joined.includes("logs")) {
      return {
        ok: true,
        tier: "SAFE",
        reason: "read-only",
        stdout: "nginx: [emerg] bind() to 0.0.0.0:80 failed",
        stderr: "",
        code: 0,
        truncated: false,
      };
    }
    if (
      joined.includes("restart") ||
      joined.includes("stop") ||
      joined.includes("start") ||
      joined.includes("enable")
    ) {
      return {
        ok: true,
        tier: "APPROVE",
        reason: "state-changing",
        stdout: `Success: ${joined}`,
        stderr: "",
        code: 0,
        truncated: false,
      };
    }
    return {
      ok: true,
      tier: "SAFE",
      reason: "read-only",
      stdout: `mock output: ${joined}`,
      stderr: "",
      code: 0,
      truncated: false,
    };
  };
}

// Knowledge / web

const MOCK_KNOWLEDGE: KnowledgeEntry[] = mockKnowledge.map((entry) => {
  if (entry.domain !== "podman" && entry.domain !== "docker") throw new Error("Invalid mock knowledge domain");
  return { ...entry, domain: entry.domain };
});

export function createMockKnowledgeBank() {
  return {
    search: async (query: string): Promise<KnowledgeEntry[]> =>
      MOCK_KNOWLEDGE.filter(
        (e) =>
          e.symptom.toLowerCase().includes(query.toLowerCase()) || e.title.toLowerCase().includes(query.toLowerCase()),
      ),
  };
}

export function createMockWebSearcher() {
  return async (_query: string): Promise<{ text: string }> => ({ text: "Mock web search not available." });
}

// Permission cache
// Mock mode: an in-memory allow/reject record seeded with realistic commands so the Settings → AI
// permissions UI shows populated Allow + Reject lists (and is fully interactive) WITHOUT persisting
// anything to disk. Mirrors the file store's exclusive-verdict logic (a key lives in one list only).
const MOCK_ALLOWED_COMMANDS: PermissionRule[] = mockPermissions.allowed;
const MOCK_BLOCKED_COMMANDS: PermissionRule[] = mockPermissions.blocked;

export function createMockPermissionsStore(filePath: string): PermissionsStoreLike {
  const cache: AIPermissionsCache = {
    version: AI_PERMISSIONS_VERSION,
    allowed: MOCK_ALLOWED_COMMANDS.map((r) => ({ ...r, addedAt: "2026-01-01T00:00:00.000Z" })),
    blocked: MOCK_BLOCKED_COMMANDS.map((r) => ({ ...r, addedAt: "2026-01-01T00:00:00.000Z" })),
  };
  const snap = (): PermissionsSnapshot => ({
    ...cache,
    allowed: [...cache.allowed],
    blocked: [...cache.blocked],
    status: "ok",
    path: filePath,
  });
  return {
    async load() {
      return snap();
    },
    async addCommand(list: PermissionsList, rule: PermissionRule) {
      const key = commandKey(rule.program, rule.args);
      const other: PermissionsList = list === "allowed" ? "blocked" : "allowed";
      cache[other] = cache[other].filter((r) => commandKey(r.program, r.args) !== key);
      cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
      cache[list].push({ program: rule.program, args: rule.args, addedAt: "2026-01-01T00:00:00.000Z" });
      return snap();
    },
    async removeCommand(list: PermissionsList, key: string) {
      cache[list] = cache[list].filter((r) => commandKey(r.program, r.args) !== key);
      return snap();
    },
    async setWebSearch(verdict) {
      cache.webSearch = verdict || undefined;
      return snap();
    },
  };
}

// An in-memory workers library, so the Workers screen and a goal roster are populated without writing to disk —
// exactly how createMockPermissionsStore serves the permissions UI. Saves and removes behave for real within the
// session; nothing survives a restart.
export function createMockWorkerStore(filePath: string): WorkerStore {
  // Ages are stored as days-ago, not absolute stamps, so the fixtures never drift into reading "a year ago".
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  let cache: WorkerDefinition[] = (
    mockWorkers as Array<
      Omit<WorkerDefinition, "createdAt" | "updatedAt"> & {
        createdDaysAgo: number;
        updatedDaysAgo: number;
      }
    >
  ).map(({ createdDaysAgo, updatedDaysAgo, ...worker }) => ({
    ...worker,
    createdAt: now - createdDaysAgo * day,
    updatedAt: now - updatedDaysAgo * day,
  }));
  return {
    async load(): Promise<WorkerStoreSnapshot> {
      return { status: "ok", workers: cache.map((worker) => ({ ...worker })), path: filePath };
    },
    async save(workers: WorkerDefinition[]) {
      cache = workers.map((worker) => ({ ...worker }));
    },
  };
}

// Goal runs the host "already holds", one per board column, so the Goals kanban and table are populated on a cold
// start. Each is a real GoalRunPort rather than a static snapshot: stopping one genuinely moves it to `stopped`
// and approving a plan genuinely moves it to `running`, so the list actions are exercisable instead of erroring
// against a run the host cannot find.
export function createMockGoalRuns(): GoalRunPort[] {
  return (mockGoalRuns as RunView[]).map((seed) => {
    let view: RunView = structuredClone(seed);
    return {
      async start() {
        return { accepted: true as const, runId: view.runId, phase: view.phase };
      },
      async resolvePlan(decision) {
        // Mirrors the real gate: approving releases the plan and the tasks begin, rejecting settles the run.
        view =
          decision === "allow"
            ? { ...view, phase: "running", planPending: false }
            : { ...view, phase: "stopped", planPending: false };
        return { accepted: true, phase: view.phase };
      },
      async resolveToolApproval(approvalId, decision) {
        view = {
          ...view,
          approvals: view.approvals.map((approval) =>
            approval.approvalId === approvalId
              ? { ...approval, status: decision === "allow" ? ("allowed" as const) : ("rejected" as const) }
              : approval,
          ),
          tasks: view.tasks.map((task) =>
            task.status === "awaiting-approval" ? { ...task, status: "running" as const } : task,
          ),
        };
        return { accepted: true, phase: view.phase };
      },
      async cancel() {
        view = { ...view, phase: "stopped", planPending: false };
      },
      snapshot() {
        return structuredClone(view);
      },
      async dispose() {},
    } satisfies GoalRunPort;
  });
}

// Full deps factory

export interface MockAIDeps {
  languageModel: LanguageModel;
  listModels: (provider: ResolvedProvider, opts?: unknown) => Promise<ListedModel[]>;
  runSandboxed: (cmd: SandboxCommand, opts?: { enforceFloor?: boolean }) => Promise<SandboxExecResult>;
  knowledgeBank: { search: (query: string) => Promise<KnowledgeEntry[]> };
  webSearcher: (query: string) => Promise<{ text: string }>;
  keyStore: AIKeyStore;
  engineOps: EngineOps;
}

export function createMockAIDeps(): MockAIDeps {
  return {
    languageModel: createMockLanguageModel(),
    listModels: createMockModelLister(),
    runSandboxed: createMockSandboxRunner(),
    knowledgeBank: createMockKnowledgeBank(),
    webSearcher: createMockWebSearcher(),
    keyStore: createMockKeyStore(),
    engineOps: createMockEngineOps(),
  };
}
