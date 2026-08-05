// AI subsystem mock data — activated when CONTAINER_DESKTOP_MOCK=1. Inference itself is mocked one level up, at
// the pi bridge (testing/mockPiBridge.ts); what lives here are the ports around it — engine operations, model
// listings, the key store, the sandbox, knowledge and the permission cache.

import {
  AI_PERMISSIONS_VERSION,
  type AIPermissionsCache,
  type PermissionRule,
  type PermissionsList,
  type PermissionsSnapshot,
  type PermissionsStoreLike,
  permissionKey,
} from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeEntry, SandboxCommand, SandboxExecResult } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { permissionRule } from "@/ai-system/core/schemas";
import type { EngineOps, ListedModel } from "@/ai-system/core/types";
import mockEngine from "@/resources/ai/mock-engine.json";
import mockKnowledge from "@/resources/ai/mock-knowledge.json";
import mockModels from "@/resources/ai/mock-models.json";
import mockPermissions from "@/resources/ai/mock-permissions.json";

// EngineOps — fixture-backed so the typed tools resolve in mock mode (the scripted runner emits the card
// events directly; this is used when an approved mutation re-runs through the broker, and for completeness).
export function createMockEngineOps(): EngineOps {
  const ok = async () => true;
  const ops: EngineOps = {
    listConnections: () => mockEngine.connections,
    listContainers: async () => {
      // A short beat, so a list read is visibly asynchronous rather than resolving inside the same frame.
      await new Promise((resolve) => setTimeout(resolve, 600));
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
//   • LM Studio (:1234) — a flat list; the "/" in "lmstudio-community/qwen3.5-9b" is an HF org, NOT a vendor prefix.
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
// What was WRITTEN, in memory. `hasKey` still answers true for everyone — that is what keeps a cloud catalogue
// browsable without a real key — so it can never say whether a write happened. A recorded write can, which is the
// only way a spec can prove the secret the app stored is the one a sign-in flow returned.
const MOCK_KEY_WRITES = new Map<string, string>();

export function mockKeyWrites(): Record<string, string> {
  return Object.fromEntries(MOCK_KEY_WRITES);
}

export function createMockKeyStore(): AIKeyStore {
  return {
    getEncryptionStatus: () => ({ available: true, backend: "mock", degraded: false }),
    hasKey: async () => true,
    getKey: async () => "mock-key",
    setKey: async (provider, plaintext) => {
      MOCK_KEY_WRITES.set(provider, plaintext);
    },
    clearKey: async (provider) => {
      MOCK_KEY_WRITES.delete(provider);
    },
    writeSecretFile: async (_provider, fileName) => `/mock/agent/${fileName}`,
    // The same directory as the secret file's, which is the point of the merge.
    writeAgentEnvFile: async (fileName) => `/mock/agent/${fileName}`,
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
const MOCK_ALLOWED_COMMANDS: PermissionRule[] = mockPermissions.allowed.map((rule) => permissionRule.parse(rule));
const MOCK_BLOCKED_COMMANDS: PermissionRule[] = mockPermissions.blocked.map((rule) => permissionRule.parse(rule));

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
      const key = permissionKey(rule);
      const other: PermissionsList = list === "allowed" ? "blocked" : "allowed";
      cache[other] = cache[other].filter((candidate) => permissionKey(candidate) !== key);
      cache[list] = cache[list].filter((candidate) => permissionKey(candidate) !== key);
      cache[list].push({ ...rule, addedAt: "2026-01-01T00:00:00.000Z" });
      return snap();
    },
    async removeCommand(list: PermissionsList, key: string) {
      cache[list] = cache[list].filter((rule) => permissionKey(rule) !== key);
      return snap();
    },
  };
}

// The mock dependency bundle CONTAINER_DESKTOP_MOCK wires in. Inferred rather than declared: the run-era
// MockAIDeps interface named ports that no longer exist.
export function createMockAIDeps() {
  return {
    listModels: createMockModelLister(),
    runSandboxed: createMockSandboxRunner(),
    webSearcher: createMockWebSearcher(),
    keyStore: createMockKeyStore(),
    engineOps: createMockEngineOps(),
  };
}
