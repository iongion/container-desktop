import { describe, expect, it, type Mock, vi } from "vitest";
import { accessProfileTools } from "@/ai-system/core/accessProfiles";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import {
  MAX_ACTIVE_AGENT_SESSIONS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
  MAX_THREAD_MODEL_MESSAGES,
  MAX_THREAD_TIMELINE_ITEMS,
} from "@/ai-system/core/limits";
import { AI_PERMISSIONS_VERSION, type PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeBankLike } from "@/ai-system/core/ports";
import type { ProjectContextPack } from "@/ai-system/core/projectContext";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import {
  MAX_AI_TEXT_CHARS,
  MAX_INITIAL_THREAD_HISTORY_MESSAGES,
  type ThreadEvent,
} from "@/ai-system/core/threadEvents";
import { emptyThreadView, reduceThreadEvent } from "@/ai-system/core/threadReducer";
import { appendThreadCheckpoint, createEmptyThreadRecord, type ThreadRecord } from "@/ai-system/core/threads";
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
    avatarHost: options?.avatarHost as never,
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

const userMessage = (content: string, id = "user-1") => ({ id, role: "user" as const, content, createdAt: 1 });
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

describe("AIBroker avatar library", () => {
  const avatar = { id: "a1", name: "Scout", dataUrl: "data:image/webp;base64,AAAA", createdAt: 1 };

  it("rejects the avatar channels when no avatar host is available", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.avatarsList)).rejects.toThrow(/avatar library is unavailable/i);
  });

  it("lists, saves, and removes through the avatar host", async () => {
    let store = [avatar];
    const broker = makeBroker({
      avatarHost: {
        ready: async () => undefined,
        list: () => store,
        save: async (next: any) => {
          store = [...store.filter((x) => x.id !== next.id), next];
          return store;
        },
        remove: async (id: string) => {
          store = store.filter((x) => x.id !== id);
          return store;
        },
      },
    });
    expect(await broker.invoke(AI_CHANNELS.avatarsList)).toEqual({ avatars: [avatar] });
    const saved = (await broker.invoke(AI_CHANNELS.avatarsSave, { avatar: { ...avatar, id: "a2" } })) as {
      avatars: unknown[];
    };
    expect(saved.avatars).toHaveLength(2);
    expect(await broker.invoke(AI_CHANNELS.avatarsRemove, { id: "a1" })).toEqual({
      avatars: [{ ...avatar, id: "a2" }],
    });
  });
});

describe("AIBroker skill library", () => {
  function fakeSkillHost() {
    const fingerprint = "a".repeat(64);
    let listener: ((snapshot: ReturnType<SkillHost["snapshot"]>) => void) | undefined;
    const snapshot = {
      revision: "1",
      user: { root: "/data/skills", status: "ok" as const },
      skills: [],
      diagnostics: [],
    };
    const resolveInvocation = vi.fn(async () => ({
      descriptor: {
        id: "skill:project:audit",
        command: "/skill:project:audit",
        shortCommand: "/skill:audit",
        name: "audit",
        description: "Audit containers",
        source: { kind: "project" as const, workspaceId: "b".repeat(64) },
        fingerprint,
        allowedTools: ["listContainers"],
      },
      manifest: {
        name: "audit",
        description: "Audit containers",
        body: "PRIVATE SKILL BODY",
        allowedTools: ["listContainers"],
      },
      arguments: "production",
      initialTaint: true,
    }));
    const host: SkillHost = {
      ready: async () => undefined,
      startWatching: async () => undefined,
      snapshot: () => snapshot,
      reload: async () => snapshot,
      setProjectSourceEnabled: async () => snapshot,
      setProjectSkillTrust: async () => snapshot,
      resolveInvocation,
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      dispose: vi.fn(),
    };
    return { host, fingerprint, resolveInvocation, publish: () => listener?.({ ...snapshot, revision: "2" }) };
  }

  it("keeps skill instructions host-side while submitting visible provenance and narrowed authority", async () => {
    const skill = fakeSkillHost();
    const broker = makeBroker({ skillHost: skill.host });

    await expect(
      broker.invoke(AI_CHANNELS.skillsInvoke, {
        threadId: "thread-1",
        skillId: "skill:project:audit",
        expectedFingerprint: skill.fingerprint,
        arguments: "production",
      }),
    ).resolves.toMatchObject({ accepted: true });

    expect(skill.resolveInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ skillId: "skill:project:audit", expectedFingerprint: skill.fingerprint }),
    );
    expect(broker.agentSessions[0].submitCalls[0]).toMatchObject({
      message: {
        content: "PROMPT:PRIVATE SKILL BODY",
        displayContent: "/skill:project:audit production",
        skill: {
          skillId: "skill:project:audit",
          source: "project",
          fingerprint: skill.fingerprint,
        },
      },
      task: {
        initialTaint: true,
        contextSources: [{ kind: "skill", trust: "project", characters: "PROMPT:PRIVATE SKILL BODY".length }],
      },
    });
    expect(broker.agentSessions[0].submitCalls[0].task?.allowedTools).toEqual(new Set(["listContainers"]));
    expect(JSON.stringify(broker.sent[0].payload)).not.toContain("PRIVATE SKILL BODY");
  });

  it("pushes a revision only to renderer senders that observed skills", async () => {
    const skill = fakeSkillHost();
    const broker = makeBroker({ skillHost: skill.host });
    await broker.invoke(AI_CHANNELS.skillsSnapshot, undefined, { allowed: true, senderId: 7 });

    skill.publish();

    expect(broker.sent).toContainEqual({
      event: { allowed: true, senderId: 7 },
      channel: AI_CHANNELS.skillsChanged,
      payload: expect.objectContaining({ revision: "2" }),
    });
  });
});

describe("AIBroker app-global threads", () => {
  it("creates and lists durable threads through the host repository", async () => {
    const broker = makeBroker();
    const created = await broker.invoke(AI_CHANNELS.threadCreate, {
      id: "thread-created",
      title: "New Thread",
      providerId: "llamacpp",
      model: "m",
    });

    expect(created).toMatchObject({ id: "thread-created", title: "New Thread", phase: "idle" });
    expect(await broker.invoke(AI_CHANNELS.threadList)).toEqual([expect.objectContaining({ id: "thread-created" })]);
    expect(broker.persistedThreads()).toEqual([expect.objectContaining({ id: "thread-created" })]);
  });

  it("keeps a user-renamed title when the first message is submitted", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadCreate, { id: "thread-1", title: "New Thread" });

    await expect(
      broker.invoke(AI_CHANNELS.threadRename, { threadId: "thread-1", title: "  Production incident  " }),
    ).resolves.toMatchObject({ title: "Production incident", titleOrigin: "user" });
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("first generated title"));
    await vi.waitFor(() => expect(broker.threadStore.save).toHaveBeenCalled());

    expect(await broker.invoke(AI_CHANNELS.threadList)).toEqual([
      expect.objectContaining({ id: "thread-1", title: "Production incident", titleOrigin: "user" }),
    ]);
  });

  it("creates one actor, forwards its event before returning, and reuses it for later submits", async () => {
    const broker = makeBroker();
    const first = await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("first"));
    expect(first).toMatchObject({ accepted: true, threadId: "thread-1", mode: "started" });
    expect(broker.createAgentSession).toHaveBeenCalledOnce();
    expect(broker.sent[0]).toMatchObject({
      channel: AI_CHANNELS.threadEvent,
      payload: { threadId: "thread-1", seq: 1, event: { type: "user-message", content: "first" } },
    });

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("second", "thread-1", "user-2"));
    expect(broker.createAgentSession).toHaveBeenCalledOnce();
    expect(broker.agentSessions[0].submitCalls).toHaveLength(2);
  });

  it("persists the rich projection and canonical model history after durable actor events", async () => {
    const broker = makeBroker();

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("A durable first question"));

    await vi.waitFor(() => expect(broker.threadStore.save).toHaveBeenCalled());
    expect(broker.persistedThreads()).toEqual([
      expect.objectContaining({
        id: "thread-1",
        title: "A durable first question",
        view: expect.objectContaining({ lastSeq: 1 }),
        modelHistory: [],
      }),
    ]);
  });

  it("creates one immutable checkpoint when an Agent Session reaches a settled message boundary", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("Checkpoint me"));
    const session = broker.agentSessions[0];
    session.emitEvent({ type: "assistant-start", id: "assistant-1" });
    session.emitEvent({ type: "assistant-delta", id: "assistant-1", text: "Settled answer" });
    session.emitEvent({ type: "assistant-end", id: "assistant-1", status: "complete" });
    session.emitEvent({ type: "task-complete", finishReason: "stop" });

    await vi.waitFor(() => expect(broker.persistedThreads()[0]?.checkpoints).toHaveLength(1));
    expect(broker.persistedThreads()[0]?.checkpoints[0]).toMatchObject({
      messageId: "assistant-1",
      timelineLength: 2,
    });
  });

  it("previews inherited bindings and creates a fresh durable Thread branch", async () => {
    const source = createEmptyThreadRecord({
      id: "thread-source",
      title: "Source",
      now: 1,
      providerId: "llamacpp",
      model: "m",
    });
    source.view.timeline = [
      {
        kind: "message",
        id: "message-source",
        role: "assistant",
        content: "Stable answer",
        delivery: "applied",
        status: "complete",
      },
    ];
    source.modelHistory = [{ role: "assistant", content: [{ type: "text", text: "Stable answer" }] }];
    const checkpointed = appendThreadCheckpoint(source, { id: "checkpoint-source", now: 2 });
    const broker = makeBroker({
      threads: [checkpointed],
      init: {
        ...LOCAL_AGENT_SETTINGS,
        workspaceRoot: "/workspace/project",
        permissionMode: "remember",
      },
    });

    await expect(broker.invoke(AI_CHANNELS.threadBranchPreview, { threadId: "thread-source" })).resolves.toMatchObject({
      source: { id: "thread-source", title: "Source" },
      checkpoints: [{ id: "checkpoint-source", messageId: "message-source" }],
      bindings: {
        providerId: "llamacpp",
        model: "m",
        workspaceRoot: "/workspace/project",
        permissionMode: "remember",
        contextPolicy: "application",
        target: "host",
      },
      environmentRestored: false,
    });

    const branch = await broker.invoke(AI_CHANNELS.threadBranch, {
      threadId: "thread-source",
      checkpointId: "checkpoint-source",
      title: "Source branch",
    });
    expect(branch).toMatchObject({
      thread: { title: "Source branch", phase: "idle", lastSeq: 0 },
      view: { phase: "idle", lastSeq: 0 },
    });
    expect(branch.thread.id).not.toBe("thread-source");
    const persisted = broker.persistedThreads().find((record) => record.id === branch.thread.id);
    expect(persisted).toMatchObject({
      lineage: { parentThreadId: "thread-source", parentCheckpointId: "checkpoint-source" },
    });
    expect(persisted?.view.timeline[0]).toMatchObject({ kind: "message", content: "Stable answer" });
    expect(persisted?.view.timeline[0]?.id).not.toBe("message-source");
  });

  it("previews and executes Thread compaction without deleting durable history", async () => {
    let source = createEmptyThreadRecord({ id: "thread-compact", title: "Long Thread", now: 1 });
    for (let index = 1; index <= 16; index += 1) {
      source.view = reduceThreadEvent(source.view, {
        version: 1,
        threadId: source.id,
        seq: index,
        event: {
          type: "user-message",
          id: `message-${index}`,
          content: `Message ${index}`,
          delivery: "applied",
        },
      }).view;
      source.modelHistory.push({ role: "user", content: [{ type: "text", text: `Message ${index}` }] });
      if (index === 8) source = appendThreadCheckpoint(source, { id: "checkpoint-8", now: index });
    }
    const compactThreadContext = vi.fn<CompactThreadContext>(async (input) => ({
      summary: "The first eight messages established the workspace constraints.",
      providerId: input.resolved.id,
      model: input.resolved.model,
      inputTokens: 80,
      outputTokens: 20,
    }));
    const broker = makeBroker({ threads: [source], compactThreadContext });

    const preview = await broker.invoke(AI_CHANNELS.threadCompactionPreview, { threadId: source.id });
    expect(preview).toMatchObject({
      thread: { id: source.id },
      plan: {
        source: { historyStart: 0, historyEnd: 8, messageStartId: "message-1", messageEndId: "message-8" },
        sourceHistoryMessages: 8,
        retainedHistoryMessages: 8,
      },
    });
    expect(broker.persistedThreads()[0].checkpoints).toHaveLength(1);

    const result = await broker.invoke(AI_CHANNELS.threadCompact, {
      threadId: source.id,
      revision: preview.plan.revision,
      instructions: "Preserve workspace constraints.",
    });

    expect(compactThreadContext).toHaveBeenCalledWith(
      expect.objectContaining({
        modelHistory: source.modelHistory,
        source: preview.plan.source,
        instructions: "Preserve workspace constraints.",
      }),
    );
    expect(result).toMatchObject({
      thread: { id: source.id },
      compaction: {
        summary: "The first eight messages established the workspace constraints.",
        source: preview.plan.source,
        instructions: "Preserve workspace constraints.",
      },
    });
    expect(broker.persistedThreads()[0]).toMatchObject({
      modelHistory: source.modelHistory,
      activeCompactionId: result.compaction.id,
      compactions: [expect.objectContaining({ id: result.compaction.id })],
    });
  });

  it("stores full tool artifacts privately and serves them only through their owning Thread", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("inspect"));
    const store = broker.sessionOptions[0].storeToolArtifact;
    if (!store) throw new Error("tool artifact store missing");
    const content = '{"full":"payload"}';

    const reference = await store({
      threadId: "thread-1",
      toolCallId: "tool-1",
      tool: "readFile",
      content,
      byteLength: new TextEncoder().encode(content).byteLength,
    });

    expect(reference).not.toHaveProperty("path");
    expect(broker.persistedArtifacts()).toEqual([
      expect.objectContaining({ id: reference.id, threadId: "thread-1", content }),
    ]);
    await expect(
      broker.invoke(AI_CHANNELS.toolArtifactGet, { threadId: "other-thread", artifactId: reference.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      broker.invoke(AI_CHANNELS.toolArtifactGet, { threadId: "thread-1", artifactId: reference.id }),
    ).resolves.toMatchObject({ id: reference.id, content });

    await broker.invoke(AI_CHANNELS.threadDelete, { threadId: "thread-1" });
    expect(broker.persistedArtifacts()).toEqual([]);
  });

  it("contains a rejecting thread get() during background persistence (no leaked rejection)", async () => {
    const broker = makeBroker();
    // Succeed for the submit-path restore lookup, then reject on the later background-persist lookup.
    broker.threadRepository.get = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("repository read failed"));

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("hi"));

    await vi.waitFor(() =>
      expect(broker.logger.error).toHaveBeenCalledWith(
        "AI: thread persistence failed",
        expect.objectContaining({ threadId: "thread-1", error: expect.stringContaining("repository read failed") }),
      ),
    );
  });

  it("restores the canonical model history and rich public projection into a lazily spawned actor", async () => {
    const restored = createEmptyThreadRecord({ id: "thread-1", title: "Restored", now: 1 });
    restored.view = reduceThreadEvent(restored.view, {
      version: 1,
      threadId: "thread-1",
      seq: 1,
      event: { type: "user-message", id: "old-user", content: "Earlier", delivery: "applied" },
    }).view;
    restored.modelHistory = [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Canonical answer with tool context" },
    ];
    const broker = makeBroker({ threads: [restored] });

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("Continue", "thread-1", "new-user"));

    expect(broker.sessionOptions[0].history).toEqual([expect.objectContaining({ id: "old-user", content: "Earlier" })]);
    expect(broker.sessionOptions[0].modelHistory).toEqual(restored.modelHistory);
  });

  it("reuses one thread actor across senders and broadcasts to every attached observer", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest(), { allowed: true, senderId: 1 });
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("second", "thread-1", "user-2"), {
      allowed: true,
      senderId: 2,
    });
    expect(broker.createAgentSession).toHaveBeenCalledOnce();
    const secondEventRecipients = broker.sent
      .filter((entry) => entry.payload?.event?.id === "user-2")
      .map((entry) => entry.event.senderId);
    expect(secondEventRecipients).toEqual([1, 2]);
  });

  it("redacts initial history, the inserted message, and diagnostics before actor creation", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, {
      ...submitRequest("token sk-ant-message-secret"),
      history: [userMessage("token sk-ant-history-secret", "old-user")],
      bundle: { screen: "Containers", errors: "token sk-ant-bundle-secret" },
    });
    expect(JSON.stringify(broker.sessionOptions[0].history)).not.toContain("sk-ant-history-secret");
    expect(JSON.stringify(broker.agentSessions[0].submitCalls[0].message)).not.toContain("sk-ant-message-secret");
    expect(broker.sessionOptions[0].taskSettings.system).not.toContain("sk-ant-bundle-secret");
    expect(broker.sessionOptions[0].taskSettings.contextSources).toEqual([
      { kind: "screen", trust: "external", characters: "Containers".length },
      { kind: "errors", trust: "external", characters: "token [REDACTED]".length },
    ]);
  });

  it("uses one exact project context pack for the model prompt, provenance, and initial taint", async () => {
    const pack: ProjectContextPack = {
      workspaceId: "a".repeat(64),
      workspaceRoot: "/workspace",
      capturedAt: 10,
      fingerprint: "b".repeat(64),
      sections: [
        {
          kind: "rules",
          source: "AGENTS.md",
          trust: "project",
          content: "Use focused tests.",
          fingerprint: "c".repeat(64),
          modifiedAt: 5,
          originalBytes: 18,
          includedBytes: 18,
          truncated: false,
        },
        {
          kind: "memory",
          source: "memory:one",
          trust: "user",
          content: "Prefer typed ports.",
          fingerprint: "d".repeat(64),
          modifiedAt: 6,
          originalBytes: 19,
          includedBytes: 19,
          truncated: false,
        },
      ],
      budgetBytes: 48 * 1024,
      usedBytes: 37,
      omittedSources: 0,
      truncated: false,
      initialTaint: true,
    };
    const projectContextHost = { capture: vi.fn(async () => pack) } as unknown as ProjectContextHost;
    const buildProjectContextPrompt = vi.fn((captured: ProjectContextPack) =>
      captured.sections.map(({ content }) => content).join("\n"),
    );
    const broker = makeBroker({ projectContextHost, buildProjectContextPrompt });

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest());

    expect(projectContextHost.capture).toHaveBeenCalledOnce();
    expect(buildProjectContextPrompt).toHaveBeenCalledWith(pack);
    expect(broker.sessionOptions[0].taskSettings).toMatchObject({
      system: expect.stringContaining("Use focused tests.\nPrefer typed ports."),
      initialTaint: true,
      contextSources: [
        { kind: "rules", trust: "project", characters: 18 },
        { kind: "memory", trust: "user", characters: 19 },
      ],
    });
  });

  it("applies durable Thread access, scoped permission identity, and supported reasoning before execution", async () => {
    const pack = {
      workspaceId: "a".repeat(64),
      workspaceRoot: "/workspace",
      capturedAt: 10,
      fingerprint: "b".repeat(64),
      sections: [],
      budgetBytes: 48 * 1024,
      usedBytes: 0,
      omittedSources: 0,
      truncated: false,
      initialTaint: false,
    } satisfies ProjectContextPack;
    const projectContextHost = { capture: vi.fn(async () => pack) } as unknown as ProjectContextHost;
    const broker = makeBroker({
      init: {
        defaultProvider: "openai",
        providers: { openai: { model: "gpt-5" } },
      },
      projectContextHost,
    });
    await broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "secret" });
    await broker.invoke(AI_CHANNELS.threadCreate, {
      id: "thread-1",
      title: "Configured",
      providerId: "openai",
      model: "gpt-5",
    });

    await expect(
      broker.invoke(AI_CHANNELS.threadConfigure, {
        threadId: "thread-1",
        accessProfile: "observe",
        reasoningLevel: "high",
      }),
    ).resolves.toMatchObject({ accessProfile: "observe", reasoningLevel: "high" });
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest());

    const task = broker.agentSessions[0].submitCalls[0].task as AgentSessionTaskSettings;
    expect(task.allowedTools).toEqual(accessProfileTools("observe"));
    expect(task.thinking).toEqual({ enabled: true, effort: "high" });
    expect(task.permissionContext).toEqual({
      workspaceId: pack.workspaceId,
      targetId: "host",
      subject: { kind: "access-profile", id: "observe" },
      contentTrustEpoch: pack.fingerprint,
    });
    await expect(
      broker.invoke(AI_CHANNELS.threadConfigure, { threadId: "thread-1", accessProfile: "workspace" }),
    ).rejects.toThrow(/active turn/i);
  });

  it("rejects reasoning that the Thread provider and model do not expose", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadCreate, {
      id: "thread-1",
      title: "Local model",
      providerId: "llamacpp",
      model: "m",
    });

    await expect(
      broker.invoke(AI_CHANNELS.threadConfigure, { threadId: "thread-1", reasoningLevel: "high" }),
    ).rejects.toThrow(/unavailable/i);
    expect(await broker.invoke(AI_CHANNELS.threadList)).toEqual([
      expect.objectContaining({ id: "thread-1", reasoningLevel: "default" }),
    ]);
  });

  it("uses the requested model for a new idle task and forces ask on an unreadable permission cache", async () => {
    const broker = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      permissions: { status: "error" },
    });
    await broker.invoke(AI_CHANNELS.threadSubmit, { ...submitRequest(), model: "request-model" });
    const task = broker.agentSessions[0].submitCalls[0].task as AgentSessionTaskSettings;
    expect(task.resolved.model).toBe("request-model");
    expect(task.permissionMode).toBe("ask");
    expect(broker.logger.error).toHaveBeenCalledOnce();
  });

  it("passes only the bound provider fetch into actor state and never retrieves a plaintext key in the broker", async () => {
    const broker = makeBroker({
      init: {
        defaultProvider: "openai",
        providers: { openai: { model: "gpt-test" } },
      },
    });
    await broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "broker-must-not-read-this" });

    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest());

    const task = broker.agentSessions[0].submitCalls[0].task as AgentSessionTaskSettings;
    expect(task.providerFetch).toBeTypeOf("function");
    expect(task).not.toHaveProperty("secret");
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
    expect(JSON.stringify(task)).not.toContain("broker-must-not-read-this");
  });

  it("rejects malformed and unbounded submit payloads before creating an actor", async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, { ...submitRequest(), message: { id: "x", content: "" } }),
    ).rejects.toThrow(/empty/i);
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("x".repeat(MAX_AI_TEXT_CHARS + 1))),
    ).rejects.toThrow(/too long/i);
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, {
        ...submitRequest(),
        history: Array.from({ length: MAX_INITIAL_THREAD_HISTORY_MESSAGES + 1 }, (_, index) =>
          userMessage("x", `history-${index}`),
        ),
      }),
    ).rejects.toThrow(/history/i);
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, {
        ...submitRequest(),
        bundle: { errors: "x".repeat(MAX_DIAGNOSTICS_BUNDLE_CHARS + 1) },
      }),
    ).rejects.toThrow(/diagnostics/i);
    expect(broker.createAgentSession).not.toHaveBeenCalled();
  });

  it("caps simultaneously active thread actors without deleting durable threads", async () => {
    const broker = makeBroker();
    for (let index = 0; index < MAX_ACTIVE_AGENT_SESSIONS; index += 1) {
      await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("hello", `thread-${index}`, `user-${index}`));
    }

    await expect(
      broker.invoke(
        AI_CHANNELS.threadSubmit,
        submitRequest("one too many", `thread-${MAX_ACTIVE_AGENT_SESSIONS}`, "overflow-user"),
      ),
    ).rejects.toThrow(/too many active Agent Sessions/i);
    expect(await broker.invoke(AI_CHANNELS.threadList)).toHaveLength(MAX_ACTIVE_AGENT_SESSIONS);
  });

  it("requires a new thread after the retained timeline or model history reaches its bound", async () => {
    const timelineBound = createEmptyThreadRecord({ id: "timeline-bound", title: "Full", now: 1 });
    timelineBound.view.timeline = Array.from({ length: MAX_THREAD_TIMELINE_ITEMS }, (_, index) => ({
      kind: "message" as const,
      id: `message-${index}`,
      role: "user" as const,
      content: "x",
      delivery: "applied" as const,
      status: "complete" as const,
    }));
    const modelBound = createEmptyThreadRecord({ id: "model-bound", title: "Full", now: 1 });
    modelBound.modelHistory = Array.from({ length: MAX_THREAD_MODEL_MESSAGES }, () => ({
      role: "user",
      content: "x",
    }));
    const broker = makeBroker({ threads: [timelineBound, modelBound] });

    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("continue", "timeline-bound", "next-1")),
    ).rejects.toThrow(/history limit/i);
    await expect(
      broker.invoke(AI_CHANNELS.threadSubmit, submitRequest("continue", "model-bound", "next-2")),
    ).rejects.toThrow(/history limit/i);
    expect(broker.createAgentSession).not.toHaveBeenCalled();
  });

  it("routes awaited snapshot, approval, stop, and delete commands to the global thread", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest());
    expect(await broker.invoke(AI_CHANNELS.threadSnapshot, { threadId: "thread-1" })).toMatchObject({
      threadId: "thread-1",
      lastSeq: 1,
    });
    expect(
      await broker.invoke(AI_CHANNELS.threadResolveApproval, {
        threadId: "thread-1",
        approvalId: "approval-1",
        decision: "allow",
      }),
    ).toEqual({ accepted: true, phase: "model" });
    expect(broker.agentSessions[0].resolveApproval).toHaveBeenCalledWith("approval-1", "allow");
    await expect(broker.invoke(AI_CHANNELS.threadStop, { threadId: "thread-1" })).resolves.toEqual({ ok: true });
    expect(broker.agentSessions[0].cancel).toHaveBeenCalledOnce();
    await expect(broker.invoke(AI_CHANNELS.threadDelete, { threadId: "thread-1" })).resolves.toEqual({ ok: true });
    expect(broker.agentSessions[0].dispose).toHaveBeenCalledOnce();
    expect(await broker.invoke(AI_CHANNELS.threadSnapshot, { threadId: "thread-1" })).toBeNull();
  });

  it("allows another authorized observer to control the same app-global thread", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest(), { allowed: true, senderId: 1 });
    await expect(
      broker.invoke(
        AI_CHANNELS.threadResolveApproval,
        { threadId: "thread-1", approvalId: "approval-1", decision: "allow" },
        { allowed: true, senderId: 2 },
      ),
    ).resolves.toEqual({ accepted: true, phase: "model" });
    expect(broker.agentSessions[0].resolveApproval).toHaveBeenCalledOnce();
  });

  it("detaches a closing sender without disposing its continuing thread", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest(), { allowed: true, senderId: 7 });
    broker.broker.disposeForSender(7);
    expect(broker.agentSessions[0].dispose).not.toHaveBeenCalled();
    expect(
      await broker.invoke(AI_CHANNELS.threadSnapshot, { threadId: "thread-1" }, { allowed: true, senderId: 8 }),
    ).toMatchObject({ threadId: "thread-1", lastSeq: 1 });
  });

  it("contains a thread-disposal rejection during broker teardown", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.threadSubmit, submitRequest(), { allowed: true, senderId: 7 });
    broker.agentSessions[0].dispose.mockRejectedValueOnce(new Error("actor disposal failed"));

    broker.broker.dispose();

    await vi.waitFor(() =>
      expect(broker.logger.error).toHaveBeenCalledWith(
        "AI: Agent Session disposal failed",
        expect.objectContaining({ threadId: "thread-1", error: "actor disposal failed" }),
      ),
    );
  });
});

describe("AIBroker permission management", () => {
  it("lists and removes remembered permissions", async () => {
    const broker = makeBroker();
    expect((await broker.invoke(AI_CHANNELS.permissionsList)).status).toBe("ok");
    const key = "scoped-rule-key";
    await broker.invoke(AI_CHANNELS.permissionsRemove, { list: "blocked", key });
    expect(broker.removeCommand).toHaveBeenCalledWith("blocked", key);
  });
});
