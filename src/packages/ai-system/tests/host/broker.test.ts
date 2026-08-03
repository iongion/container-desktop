import { describe, expect, it, type Mock, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { AI_PERMISSIONS_VERSION, type PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeBankLike } from "@/ai-system/core/ports";
import type { ProjectContextPack } from "@/ai-system/core/projectContext";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import type { ThreadEvent } from "@/ai-system/core/threadEvents";
import { emptyThreadView, reduceThreadEvent } from "@/ai-system/core/threadReducer";
import type { ThreadRecord } from "@/ai-system/core/threads";
import type { ToolArtifactRecord } from "@/ai-system/core/toolArtifacts";
import type {
  AgentSessionCreationOptions,
  AgentSessionPort,
  AgentSessionTaskSettings,
  AISettings,
  CompactThreadContext,
  ListedModel,
} from "@/ai-system/core/types";
import { createAIBroker } from "@/ai-system/host/broker";
import type { ProjectContextHost } from "@/ai-system/host/projectContextHost";
import type { SkillHost } from "@/ai-system/host/skillHost";
import { createThreadRepository } from "@/ai-system/host/threadRepository";
import { createToolArtifactRepository } from "@/ai-system/host/toolArtifactRepository";

const LOCAL_AGENT_SETTINGS = {
  defaultProvider: "llamacpp",
  providers: { llamacpp: { model: "m", baseURL: "http://127.0.0.1:8080/v1" } },
};

function fakeKeyStore(): AIKeyStore & { getKey: Mock; setDegraded: (degraded: boolean) => void } {
  const keys = new Map<string, string>();
  let degraded = false;
  return {
    getEncryptionStatus: () => ({ available: !degraded, backend: degraded ? "basic_text" : "kwallet", degraded }),
    hasKey: async (provider) => keys.has(provider),
    getKey: vi.fn(async (provider) => keys.get(provider)),
    setKey: async (provider, value, options) => {
      if (degraded && !options?.allowDegraded) {
        throw new Error("AI key storage is degraded");
      }
      keys.set(provider, value);
    },
    clearKey: async (provider) => {
      keys.delete(provider);
    },
    setDegraded: (value) => {
      degraded = value;
    },
  };
}

interface FakeSession extends AgentSessionPort {
  submitCalls: Array<{ message: any; task?: AgentSessionTaskSettings }>;
  emitEvent: (event: ThreadEvent) => void;
  resolveApproval: Mock<AgentSessionPort["resolveApproval"]>;
  cancel: Mock<AgentSessionPort["cancel"]>;
  dispose: Mock<AgentSessionPort["dispose"]>;
}

function createFakeSession(options: AgentSessionCreationOptions): FakeSession {
  let view = emptyThreadView(options.threadId);
  let seq = 0;
  let taskCounter = 0;
  const submitCalls: FakeSession["submitCalls"] = [];
  const emitEvent = (event: ThreadEvent): void => {
    seq += 1;
    const envelope = {
      version: 1 as const,
      threadId: options.threadId,
      taskId: `task-${taskCounter || 1}`,
      seq,
      event,
    };
    view = reduceThreadEvent(view, envelope).view;
    options.emit(envelope);
  };
  return {
    submitCalls,
    emitEvent,
    submit: vi.fn(async (message, task) => {
      submitCalls.push({ message, task });
      taskCounter += 1;
      const taskId = `task-${taskCounter}`;
      seq += 1;
      const envelope = {
        version: 1 as const,
        threadId: options.threadId,
        taskId,
        seq,
        event: {
          type: "user-message" as const,
          id: message.id,
          content: message.displayContent ?? message.content,
          delivery: "applied" as const,
        },
      };
      view = reduceThreadEvent(view, envelope).view;
      view = { ...view, phase: "model" };
      options.emit(envelope);
      return {
        accepted: true as const,
        threadId: options.threadId,
        taskId,
        mode: "started" as const,
        phase: "model" as const,
      };
    }),
    resolveApproval: vi.fn(async () => ({ accepted: true, phase: "model" as const })),
    cancel: vi.fn(async () => undefined),
    snapshot: () => structuredClone(view),
    durableSnapshot: () => ({
      view: structuredClone(view),
      modelHistory: options.modelHistory ?? [],
    }),
    dispose: vi.fn(async () => undefined),
  };
}

function makeBroker(options?: {
  init?: Partial<AISettings>;
  permissions?: Partial<PermissionsSnapshot>;
  threads?: ThreadRecord[];
  listModels?: (
    provider: ResolvedProvider,
    opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
  avatarHost?: {
    ready: () => Promise<void>;
    list: () => unknown[];
    save: (avatar: unknown) => Promise<unknown[]>;
    remove: (id: string) => Promise<unknown[]>;
  };
  skillHost?: SkillHost;
  projectContextHost?: ProjectContextHost;
  buildProjectContextPrompt?: (pack: ProjectContextPack) => string;
  compactThreadContext?: CompactThreadContext;
}) {
  const handlers = new Map<string, (event: any, payload: any) => any>();
  const sent: Array<{ event: any; channel: string; payload: any }> = [];
  const keyStore = fakeKeyStore();
  let settings = normalizeAISettings(options?.init ?? LOCAL_AGENT_SETTINGS);
  const sessionOptions: AgentSessionCreationOptions[] = [];
  const agentSessions: FakeSession[] = [];
  const createAgentSession = vi.fn((creation: AgentSessionCreationOptions) => {
    sessionOptions.push(creation);
    const agentSession = createFakeSession(creation);
    agentSessions.push(agentSession);
    return agentSession;
  });
  const permissionSnapshot: PermissionsSnapshot = {
    status: "ok",
    path: "/tmp/ai-permissions.json",
    version: AI_PERMISSIONS_VERSION,
    allowed: [],
    blocked: [],
    ...options?.permissions,
  };
  const addCommand = vi.fn(async () => permissionSnapshot);
  const removeCommand = vi.fn(async () => permissionSnapshot);
  const permissionsStore = {
    load: vi.fn(async () => permissionSnapshot),
    addCommand,
    removeCommand,
  };
  const knowledgeBank: KnowledgeBankLike = { search: vi.fn(async () => []) };
  const logger = { error: vi.fn() };
  let persistedThreads = structuredClone(options?.threads ?? []);
  const threadStore = {
    load: vi.fn(async () => ({
      status: "ok" as const,
      records: structuredClone(persistedThreads),
      path: "/tmp/ai-threads.json",
    })),
    save: vi.fn(async (records: ThreadRecord[]) => {
      persistedThreads = structuredClone(records);
    }),
  };
  const threadRepository = createThreadRepository({ store: threadStore, logger });
  let persistedArtifacts: ToolArtifactRecord[] = [];
  const toolArtifactRepository = createToolArtifactRepository({
    store: {
      load: vi.fn(async () => ({ status: "ok" as const, records: [], path: "/tmp/ai-tool-artifacts.json" })),
      save: vi.fn(async (records) => {
        persistedArtifacts = structuredClone(records);
      }),
    },
    logger,
  });
  const broker = createAIBroker<{ allowed?: boolean; senderId?: number | string }>({
    keyStore,
    getAISettings: async () => settings,
    onInvoke: (channel, handler) => handlers.set(channel, handler),
    send: (event, channel, payload) => sent.push({ event, channel, payload }),
    senderId: (event) => event?.senderId ?? 1,
    isAllowedSender: (event) => event?.allowed === true,
    providerTransport: {
      request: vi.fn(async () => {
        throw new Error("unexpected provider request");
      }),
      dispose: vi.fn(),
    },
    listModels: options?.listModels ?? (async () => [{ id: "m1" }, { id: "m2" }]),
    buildAgentPrompt: (bundle) => `Assistant. Context: ${JSON.stringify(bundle ?? {})}`,
    createAgentSession,
    compactThreadContext: options?.compactThreadContext,
    runSandboxed: vi.fn(async () => ({
      ok: true,
      tier: "ran",
      reason: "",
      stdout: "",
      stderr: "",
      code: 0,
      truncated: false,
    })),
    permissionsStore,
    knowledgeBank,
    webSearcher: vi.fn(async () => ({ text: "web result" })),
    threadRepository,
    toolArtifactRepository,
    skillHost: options?.skillHost,
    buildSkillInvocationPrompt: ({ body }) => `PROMPT:${body}`,
    projectContextHost: options?.projectContextHost,
    buildProjectContextPrompt: options?.buildProjectContextPrompt,
    logger,
  });
  broker.register();
  return {
    broker,
    handlers,
    sent,
    keyStore,
    agentSessions,
    sessionOptions,
    createAgentSession,
    compactThreadContext: options?.compactThreadContext,
    permissionsStore,
    removeCommand,
    threadRepository,
    toolArtifactRepository,
    threadStore,
    persistedThreads: () => structuredClone(persistedThreads),
    persistedArtifacts: () => structuredClone(persistedArtifacts),
    logger,
    setSettings: (next: Partial<AISettings>) => {
      settings = normalizeAISettings(next);
    },
    invoke: (channel: string, payload?: unknown, event: any = { allowed: true, senderId: 1 }) =>
      handlers.get(channel)!(event, payload),
  };
}

const _userMessage = (content: string, id = "user-1") => ({ id, role: "user" as const, content, createdAt: 1 });
const submitRequest = (content = "hello", threadId = "thread-1", id = "user-1") => ({
  threadId,
  message: { id, content, createdAt: 1 },
  history: [],
});

describe("AIBroker security and settings", () => {
  it("guards every invoke from unauthorized senders", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.status, undefined, { allowed: false })).rejects.toThrow(/unauthorized/i);
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, submitRequest(), { allowed: false, senderId: 1 }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("stores, reports, and clears provider keys with degraded-storage consent", async () => {
    const broker = makeBroker();
    expect(await broker.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(false);
    broker.keyStore.setDegraded(true);
    await expect(broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-secret" })).rejects.toThrow(
      /degraded/i,
    );
    await broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-secret", allowDegraded: true });
    expect(await broker.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(true);
    await broker.invoke(AI_CHANNELS.keyClear, { provider: "openai" });
    expect(await broker.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(false);
  });

  it("rejects malformed provider ids and empty keys", async () => {
    const broker = makeBroker();
    for (const provider of [undefined, "", "../../etc/passwd", "a b", "x".repeat(100)]) {
      await expect(broker.invoke(AI_CHANNELS.keyHas, { provider })).rejects.toThrow(/invalid provider/i);
    }
    await expect(broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "  " })).rejects.toThrow(/non-empty/i);
  });

  it("lists models through the same provider gate", async () => {
    const broker = makeBroker();
    expect(
      (await broker.invoke(AI_CHANNELS.modelsList, { providerId: "llamacpp", requestId: "models-1" })).models,
    ).toEqual([{ id: "m1" }, { id: "m2" }]);
  });

  it("reports bounded host diagnostics and probes the selected provider without exposing its endpoint", async () => {
    const broker = makeBroker();
    const diagnostics = await broker.invoke(AI_CHANNELS.diagnostics, { providerId: "llamacpp" });

    expect(diagnostics.provider.message).toBeUndefined();
    expect(diagnostics).toMatchObject({
      provider: {
        id: "llamacpp",
        kind: "local",
        model: "m",
        destination: "local",
        credential: "not-required",
        reachability: "reachable",
        modelCount: 2,
      },
      security: { permissions: "ok", webSearch: "disabled" },
      capabilities: { agentSessions: true, sandbox: true },
      extensions: { skills: { state: "unavailable", count: 0, diagnostics: 0 }, mcp: { state: "unavailable" } },
      recentErrors: [],
    });
    expect(JSON.stringify(diagnostics)).not.toContain("127.0.0.1");
  });

  it("does not probe a provider whose required credential is missing", async () => {
    const listModels = vi.fn(async () => [{ id: "must-not-run" }]);
    const broker = makeBroker({
      init: { defaultProvider: "openai", providers: { openai: { model: "gpt-test" } } },
      listModels,
    });

    await expect(broker.invoke(AI_CHANNELS.diagnostics, { providerId: "openai" })).resolves.toMatchObject({
      provider: { credential: "missing", reachability: "not-checked" },
    });
    expect(listModels).not.toHaveBeenCalled();
  });

  it("passes the resolved discovery strategy and cancels an owned in-flight model request", async () => {
    let receivedProvider: ResolvedProvider | undefined;
    let receivedSignal: AbortSignal | undefined;
    const listModels = vi.fn(
      (provider: ResolvedProvider, opts: { fetchImpl: typeof fetch; signal?: AbortSignal }) =>
        new Promise<ListedModel[]>((_resolve, reject) => {
          receivedProvider = provider;
          receivedSignal = opts.signal;
          opts.signal?.addEventListener("abort", () => reject(opts.signal?.reason), { once: true });
        }),
    );
    const broker = makeBroker({ listModels });
    const pending = broker.invoke(AI_CHANNELS.modelsList, { providerId: "llamacpp", requestId: "models-cancel" });
    await vi.waitFor(() => expect(listModels).toHaveBeenCalledOnce());

    await expect(
      broker.invoke(AI_CHANNELS.modelsCancel, { requestId: "models-cancel" }, { allowed: true, senderId: 2 }),
    ).rejects.toThrow(/not found/i);
    await expect(broker.invoke(AI_CHANNELS.modelsCancel, { requestId: "models-cancel" })).resolves.toEqual({
      ok: true,
    });
    expect(receivedProvider).toMatchObject({ id: "llamacpp", discovery: "single" });
    expect(receivedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/cancelled/i);
  });

  it("uses an explicitly configured auth-none remote endpoint without a second permission", async () => {
    const broker = makeBroker({
      init: {
        defaultProvider: "llamacpp",
        providers: { llamacpp: { model: "m", baseURL: "http://192.168.1.5:8080/v1", auth: { scheme: "none" } } },
      },
    });

    await expect(broker.invoke(AI_CHANNELS.threadSubmit, submitRequest())).resolves.toMatchObject({ accepted: true });
  });

  it("uses the currently configured provider origin without stale permission state", async () => {
    const broker = makeBroker({
      init: {
        defaultProvider: "llamacpp",
        providers: { llamacpp: { model: "m", baseURL: "https://one.example/v1", auth: { scheme: "none" } } },
      },
    });
    broker.setSettings({
      defaultProvider: "llamacpp",
      providers: { llamacpp: { model: "m", baseURL: "https://two.example/v1", auth: { scheme: "none" } } },
    });

    await expect(
      broker.invoke(AI_CHANNELS.modelsList, { providerId: "llamacpp", requestId: "models-consent" }),
    ).resolves.toEqual({ models: [{ id: "m1" }, { id: "m2" }] });
  });
});
