// AI subsystem mock data — activated when CONTAINER_DESKTOP_MOCK=1.
// Scenarios live in tests/fixtures/ai/*.json. Each is an ordered array of steps
// that the script runner plays with realistic streaming delays.
//
// Wire via createMockAIDeps() in main.ts when isMockMode().

import diagnoseCrashSrc from "../../../tests/fixtures/ai/diagnose-podman-crash.json";

const diagnoseCrash: Scenario = diagnoseCrashSrc as Scenario;

import type {
  AgentRunner,
  AgentToolEvent,
  AIKeyStore,
  EngineOps,
  KnowledgeEntry,
  ListedModel,
  SandboxCommand,
  SandboxExecResult,
} from "@/ai-system/core";

// Scenario types

export type ScenarioStep =
  | { type: "delta"; text: string }
  | { type: "tool"; event: AgentToolEvent }
  | { type: "done"; reason: string }
  | { type: "error"; message: string };

export type Scenario = ScenarioStep[];

// Script player — turns a scenario into a timed stream

function playScenario(
  scenario: Scenario,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  onDone: (reason: string) => void,
  onError: (message: string) => void,
  onToolEvent?: (event: AgentToolEvent) => void,
) {
  let i = 0;
  function next() {
    if (signal.aborted) {
      return;
    }
    if (i >= scenario.length) {
      onDone("stop");
      return;
    }
    const step = scenario[i];
    i += 1;
    switch (step.type) {
      case "delta":
        onDelta(step.text);
        setTimeout(next, 40 + Math.floor(Math.random() * 60));
        break;
      case "tool":
        onToolEvent?.(step.event);
        setTimeout(next, 250);
        break;
      case "done":
        onDone(step.reason);
        break;
      case "error":
        onError(step.message);
        break;
    }
  }
  next();
}

// Agent mock — the ONE always-agentic runner (the crash diagnose scenario for rich output)

// After the user resolves an approval, the broker resumes the turn with the outcome as the latest
// message. A real model reads that and wraps up; the mock detects it and streams a short closing instead
// of replaying the investigation — otherwise mock mode would re-surface the same approval card forever.
const RESUME_MARKER = /^(I approved and ran|I declined to run|Results of )/;
const WRAP_UP: Scenario = [
  { type: "delta", text: "Thanks — that should get the container healthy again. " },
  { type: "delta", text: "Let me know if it doesn't come back up and we'll dig further." },
  { type: "done", reason: "stop" },
];

// Fixture resources so CONTAINER_DESKTOP_MOCK=1 yarn dev exercises the typed-tool generative-UI cards (and
// lets approved mutations resolve) without a real engine. Shapes mirror @/env/Types loosely (cast as any).
const MOCK_CONTAINERS: any[] = [
  {
    Id: "a1b2c3d4e5f6",
    Image: "docker.io/library/nginx:latest",
    Names: ["web"],
    Computed: { Name: "web", DecodedState: "running" },
    State: "running",
    Status: "Up 2 hours",
    Ports: {},
  },
  {
    Id: "f6e5d4c3b2a1",
    Image: "docker.io/library/redis:7",
    Names: ["cache"],
    Computed: { Name: "cache", DecodedState: "exited" },
    State: "exited",
    Status: "Exited (0) 5 minutes ago",
    Ports: {},
  },
];
const MOCK_IMAGES: any[] = [
  { Id: "sha256:1111", FullName: "docker.io/library/nginx:latest", Name: "nginx", Tag: "latest", Size: 142000000 },
  { Id: "sha256:2222", FullName: "docker.io/library/redis:7", Name: "redis", Tag: "7", Size: 117000000 },
];
const MOCK_NETWORKS: any[] = [
  { id: "net0001", name: "podman", driver: "bridge", dns_enabled: true, internal: false, subnets: [] },
  { id: "net0002", name: "frontend", driver: "bridge", dns_enabled: true, internal: false, subnets: [] },
];
const MOCK_VOLUMES: any[] = [
  { Name: "pgdata", Driver: "local", Mountpoint: "/var/lib/containers/storage/volumes/pgdata/_data" },
  { Name: "cache", Driver: "local", Mountpoint: "/var/lib/containers/storage/volumes/cache/_data" },
];

function typedToolScenario(tool: string, title: string, result: unknown, prose: string): Scenario {
  return [
    { type: "delta", text: "Let me check that for you. " },
    { type: "tool", event: { type: "tool-call", tool, title, args: {} } },
    { type: "tool", event: { type: "tool-result", tool, title, ok: true, result } },
    { type: "delta", text: prose },
    { type: "done", reason: "stop" },
  ];
}

// Map a prompt to a typed-tool demo scenario so "list my containers" renders a ContainersCard, etc.
function pickTypedScenario(prompt: string): Scenario | null {
  if (/\bimage/.test(prompt)) {
    return typedToolScenario("listImages", "List images", MOCK_IMAGES, "These are the images on this engine.");
  }
  if (/\bnetwork/.test(prompt)) {
    return typedToolScenario("listNetworks", "List networks", MOCK_NETWORKS, "Here are the configured networks.");
  }
  if (/\bvolume/.test(prompt)) {
    return typedToolScenario("listVolumes", "List volumes", MOCK_VOLUMES, "Here are the volumes on this engine.");
  }
  if (/\bcontainer|\brunning|\bstopped|\blog/.test(prompt)) {
    return typedToolScenario(
      "listContainers",
      "List containers",
      MOCK_CONTAINERS,
      "You have one running container (web) and one stopped (cache).",
    );
  }
  return null;
}

export function createMockAgentRunner(): AgentRunner {
  return (params) => {
    const last = params.messages?.at(-1)?.content ?? "";
    const scenario = RESUME_MARKER.test(last)
      ? WRAP_UP
      : (pickTypedScenario(last.toLowerCase()) ?? (diagnoseCrash as Scenario));
    playScenario(scenario, params.signal, params.onDelta, params.onDone, params.onError, params.onToolEvent);
  };
}

// EngineOps — fixture-backed so the typed tools resolve in mock mode (the scripted runner emits the card
// events directly; this is used when an approved mutation re-runs through the broker, and for completeness).
export function createMockEngineOps(): EngineOps {
  const ok = async () => true;
  return {
    listConnections: () => [{ id: "podman", name: "Podman", engine: "podman", running: true }],
    listContainers: async () => MOCK_CONTAINERS,
    inspectContainer: async ({ id }) => MOCK_CONTAINERS.find((c) => c.Id.startsWith(id)) ?? MOCK_CONTAINERS[0],
    getContainerLogs: async () => "2026-06-30T16:12:15 nginx: ready to handle connections\n... (mock logs) ...",
    getContainerStats: async () => ({ name: "web", memory_stats: { usage: 104857600, limit: 536870912 } }) as any,
    startContainer: ok,
    stopContainer: ok,
    restartContainer: ok,
    pauseContainer: ok,
    unpauseContainer: ok,
    removeContainer: ok,
    listImages: async () => MOCK_IMAGES,
    inspectImage: async () => MOCK_IMAGES[0],
    pullImage: ok,
    removeImage: ok,
    listNetworks: async () => MOCK_NETWORKS,
    inspectNetwork: async () => MOCK_NETWORKS[0],
    removeNetwork: ok,
    listVolumes: async () => MOCK_VOLUMES,
    inspectVolume: async () => MOCK_VOLUMES[0],
    removeVolume: ok,
  } as EngineOps;
}

// Model listing
// Per-source fixtures so CONTAINER_DESKTOP_MOCK=1 yarn dev exercises every shape the ModelPicker renders:
//   • LM Studio (:1234) — a flat list; the "/" in "unsloth/qwen3.5-9b" is an HF org, NOT a vendor prefix.
//   • OpenRouter (openrouter.ai) — vendor-prefixed ids, driving the 3-level gateway→provider→model path.
//   • llama.cpp (:8080) — exactly one served model (its server binds one at launch via -m).
//   • other clouds — a small generic list so anthropic/openai/… aren't empty in mock mode.
const LMSTUDIO_MODELS: ListedModel[] = [
  // A long flat list (the "/" in an HF org id like "unsloth/…" is NOT a vendor prefix → never split).
  { id: "unsloth/qwen3.5-9b" },
  { id: "unsloth/llama-3.3-70b-instruct-gguf" },
  { id: "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF" },
  { id: "llama-3.2-3b-instruct" },
  { id: "qwen2.5-coder-7b" },
  { id: "phi-4-mini" },
  { id: "gemma-2-9b-it" },
  { id: "mistral-7b-instruct-v0.3" },
  { id: "deepseek-coder-6.7b-instruct" },
  { id: "codellama-13b-instruct" },
  { id: "llama-3.1-8b-instruct" },
  { id: "qwen2.5-14b-instruct" },
  { id: "granite-3.1-8b-instruct" },
  { id: "smollm2-1.7b-instruct" },
];
// ~50 vendor-prefixed ids across 16 upstreams → exercises the gateway → vendor → model 3-level drill (and
// the per-source scroll) in mock mode without a real OpenRouter key.
const OPENROUTER_MODELS: ListedModel[] = [
  { id: "anthropic/claude-3.5-sonnet" },
  { id: "anthropic/claude-3.5-haiku" },
  { id: "anthropic/claude-3-opus" },
  { id: "anthropic/claude-3-sonnet" },
  { id: "anthropic/claude-3-haiku" },
  { id: "anthropic/claude-2.1" },
  { id: "openai/gpt-4o" },
  { id: "openai/gpt-4o-mini" },
  { id: "openai/gpt-4-turbo" },
  { id: "openai/o1" },
  { id: "openai/o1-preview" },
  { id: "openai/o1-mini" },
  { id: "openai/o3-mini" },
  { id: "openai/gpt-3.5-turbo" },
  { id: "google/gemini-2.0-flash" },
  { id: "google/gemini-2.0-flash-thinking-exp" },
  { id: "google/gemini-1.5-pro" },
  { id: "google/gemini-1.5-flash" },
  { id: "google/gemma-2-27b-it" },
  { id: "meta-llama/llama-3.3-70b-instruct" },
  { id: "meta-llama/llama-3.1-405b-instruct" },
  { id: "meta-llama/llama-3.1-70b-instruct" },
  { id: "meta-llama/llama-3.1-8b-instruct" },
  { id: "meta-llama/llama-3.2-3b-instruct" },
  { id: "mistralai/mistral-large" },
  { id: "mistralai/mistral-small" },
  { id: "mistralai/mixtral-8x7b-instruct" },
  { id: "mistralai/mixtral-8x22b-instruct" },
  { id: "mistralai/codestral" },
  { id: "mistralai/ministral-8b" },
  { id: "deepseek/deepseek-chat" },
  { id: "deepseek/deepseek-r1" },
  { id: "deepseek/deepseek-coder" },
  { id: "qwen/qwen-2.5-72b-instruct" },
  { id: "qwen/qwen-2.5-coder-32b-instruct" },
  { id: "qwen/qwq-32b-preview" },
  { id: "x-ai/grok-2" },
  { id: "x-ai/grok-2-mini" },
  { id: "x-ai/grok-beta" },
  { id: "cohere/command-r-plus" },
  { id: "cohere/command-r" },
  { id: "nvidia/llama-3.1-nemotron-70b-instruct" },
  { id: "microsoft/phi-4" },
  { id: "microsoft/wizardlm-2-8x22b" },
  { id: "perplexity/llama-3.1-sonar-large-128k-online" },
  { id: "amazon/nova-pro-v1" },
  { id: "amazon/nova-lite-v1" },
  { id: "ai21/jamba-1-5-large" },
  { id: "databricks/dbrx-instruct" },
  { id: "01-ai/yi-large" },
];
const LLAMACPP_MODELS: ListedModel[] = [{ id: "qwen2.5-7b-instruct-q4_k_m" }];
const GENERIC_CLOUD_MODELS: ListedModel[] = [{ id: "default-large" }, { id: "default-small" }];

export function createMockModelLister() {
  return async (baseURL: string, _opts?: unknown): Promise<ListedModel[]> => {
    const url = baseURL ?? "";
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

const MOCK_KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: "1",
    domain: "podman",
    title: "Rootless socket unavailable",
    symptom: "Cannot connect to Podman socket",
    solution: "systemctl --user enable --now podman.socket",
    tags: ["socket", "rootless"],
  },
  {
    id: "2",
    domain: "docker",
    title: "Permission denied on socket",
    symptom: "permission denied while trying to connect",
    solution: "sudo usermod -aG docker $USER",
    tags: ["permission"],
  },
];

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

// Full deps factory

export interface MockAIDeps {
  agentRunner: AgentRunner;
  listModels: (baseURL: string, opts?: unknown) => Promise<ListedModel[]>;
  runSandboxed: (cmd: SandboxCommand, opts?: { enforceFloor?: boolean }) => Promise<SandboxExecResult>;
  knowledgeBank: { search: (query: string) => Promise<KnowledgeEntry[]> };
  webSearcher: (query: string) => Promise<{ text: string }>;
  keyStore: AIKeyStore;
  engineOps: EngineOps;
}

export function createMockAIDeps(): MockAIDeps {
  return {
    agentRunner: createMockAgentRunner(),
    listModels: createMockModelLister(),
    runSandboxed: createMockSandboxRunner(),
    knowledgeBank: createMockKnowledgeBank(),
    webSearcher: createMockWebSearcher(),
    keyStore: createMockKeyStore(),
    engineOps: createMockEngineOps(),
  };
}
