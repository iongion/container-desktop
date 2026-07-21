import { describe, expect, it, type Mock, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { MAX_CHAT_MESSAGE_CHARS, MAX_INITIAL_HISTORY_MESSAGES } from "@/ai-system/core/chatEvents";
import { emptyChatSessionView, reduceChatEvent } from "@/ai-system/core/chatReducer";
import { type ConversationRecordV1, createEmptyConversationRecord } from "@/ai-system/core/conversations";
import {
  MAX_ACTIVE_CHAT_SESSIONS,
  MAX_CONVERSATION_MODEL_MESSAGES,
  MAX_CONVERSATION_TIMELINE_ITEMS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
} from "@/ai-system/core/limits";
import { AI_PERMISSIONS_VERSION, commandKey, type PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { AIKeyStore, KnowledgeBankLike } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import type {
  AgentSessionCreationOptions,
  AgentSessionPort,
  AgentSessionTaskSettings,
  AISettings,
  ListedModel,
} from "@/ai-system/core/types";
import { createAIBroker } from "@/ai-system/host/broker";
import { createConversationRepository } from "@/ai-system/host/conversationRepository";

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
  resolveApproval: Mock<AgentSessionPort["resolveApproval"]>;
  cancel: Mock<AgentSessionPort["cancel"]>;
  dispose: Mock<AgentSessionPort["dispose"]>;
}

function createFakeSession(options: AgentSessionCreationOptions): FakeSession {
  let view = emptyChatSessionView(options.sessionId);
  let seq = 0;
  let taskCounter = 0;
  const submitCalls: FakeSession["submitCalls"] = [];
  return {
    submitCalls,
    submit: vi.fn(async (message, task) => {
      submitCalls.push({ message, task });
      taskCounter += 1;
      const taskId = `task-${taskCounter}`;
      seq += 1;
      const envelope = {
        version: 1 as const,
        sessionId: options.sessionId,
        taskId,
        seq,
        event: {
          type: "user-message" as const,
          id: message.id,
          content: message.content,
          delivery: "applied" as const,
        },
      };
      view = reduceChatEvent(view, envelope).view;
      view = { ...view, phase: "model" };
      options.emit(envelope);
      return {
        accepted: true as const,
        sessionId: options.sessionId,
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
  conversations?: ConversationRecordV1[];
  listModels?: (
    provider: ResolvedProvider,
    opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
}) {
  const handlers = new Map<string, (event: any, payload: any) => any>();
  const sent: Array<{ event: any; channel: string; payload: any }> = [];
  const keyStore = fakeKeyStore();
  let settings = normalizeAISettings(options?.init ?? LOCAL_AGENT_SETTINGS);
  const sessionOptions: AgentSessionCreationOptions[] = [];
  const sessions: FakeSession[] = [];
  const createAgentSession = vi.fn((creation: AgentSessionCreationOptions) => {
    sessionOptions.push(creation);
    const session = createFakeSession(creation);
    sessions.push(session);
    return session;
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
  const setWebSearch = vi.fn(async () => permissionSnapshot);
  const permissionsStore = {
    load: vi.fn(async () => permissionSnapshot),
    addCommand,
    removeCommand,
    setWebSearch,
  };
  const knowledgeBank: KnowledgeBankLike = { search: vi.fn(async () => []) };
  const logger = { error: vi.fn() };
  let persistedConversations = structuredClone(options?.conversations ?? []);
  const conversationStore = {
    load: vi.fn(async () => ({
      status: "ok" as const,
      records: structuredClone(persistedConversations),
      path: "/tmp/ai-conversations.json",
    })),
    save: vi.fn(async (records: ConversationRecordV1[]) => {
      persistedConversations = structuredClone(records);
    }),
  };
  const conversationRepository = createConversationRepository({ store: conversationStore, logger });
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
    conversationRepository,
    logger,
  });
  broker.register();
  return {
    broker,
    handlers,
    sent,
    keyStore,
    sessions,
    sessionOptions,
    createAgentSession,
    permissionsStore,
    removeCommand,
    setWebSearch,
    conversationRepository,
    conversationStore,
    persistedConversations: () => structuredClone(persistedConversations),
    logger,
    setSettings: (next: Partial<AISettings>) => {
      settings = normalizeAISettings(next);
    },
    invoke: (channel: string, payload?: unknown, event: any = { allowed: true, senderId: 1 }) =>
      handlers.get(channel)!(event, payload),
  };
}

const userMessage = (content: string, id = "user-1") => ({ id, role: "user" as const, content, createdAt: 1 });
const submitRequest = (content = "hello", sessionId = "session-1", id = "user-1") => ({
  sessionId,
  message: { id, content, createdAt: 1 },
  history: [],
});

describe("AIBroker security and settings", () => {
  it("guards every invoke from unauthorized senders", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.status, undefined, { allowed: false })).rejects.toThrow(/unauthorized/i);
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, submitRequest(), { allowed: false, senderId: 1 }),
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

    await expect(broker.invoke(AI_CHANNELS.chatSubmit, submitRequest())).resolves.toMatchObject({ accepted: true });
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

describe("AIBroker app-global conversations", () => {
  it("creates and lists durable conversations through the host repository", async () => {
    const broker = makeBroker();
    const created = await broker.invoke(AI_CHANNELS.chatCreate, {
      id: "chat-created",
      title: "New chat",
      providerId: "llamacpp",
      model: "m",
    });

    expect(created).toMatchObject({ id: "chat-created", title: "New chat", phase: "idle" });
    expect(await broker.invoke(AI_CHANNELS.chatList)).toEqual([expect.objectContaining({ id: "chat-created" })]);
    expect(broker.persistedConversations()).toEqual([expect.objectContaining({ id: "chat-created" })]);
  });

  it("creates one actor, forwards its event before returning, and reuses it for later submits", async () => {
    const broker = makeBroker();
    const first = await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("first"));
    expect(first).toMatchObject({ accepted: true, sessionId: "session-1", mode: "started" });
    expect(broker.createAgentSession).toHaveBeenCalledOnce();
    expect(broker.sent[0]).toMatchObject({
      channel: AI_CHANNELS.chatEvent,
      payload: { sessionId: "session-1", seq: 1, event: { type: "user-message", content: "first" } },
    });

    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("second", "session-1", "user-2"));
    expect(broker.createAgentSession).toHaveBeenCalledOnce();
    expect(broker.sessions[0].submitCalls).toHaveLength(2);
  });

  it("persists the rich projection and canonical model history after durable actor events", async () => {
    const broker = makeBroker();

    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("A durable first question"));

    await vi.waitFor(() => expect(broker.conversationStore.save).toHaveBeenCalled());
    expect(broker.persistedConversations()).toEqual([
      expect.objectContaining({
        id: "session-1",
        title: "A durable first question",
        view: expect.objectContaining({ lastSeq: 1 }),
        modelHistory: [],
      }),
    ]);
  });

  it("contains a rejecting conversation get() during background persistence (no leaked rejection)", async () => {
    const broker = makeBroker();
    // Succeed for the submit-path restore lookup, then reject on the later background-persist lookup.
    broker.conversationRepository.get = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("repository read failed"));

    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("hi"));

    await vi.waitFor(() =>
      expect(broker.logger.error).toHaveBeenCalledWith(
        "AI: conversation persistence failed",
        expect.objectContaining({ sessionId: "session-1", error: expect.stringContaining("repository read failed") }),
      ),
    );
  });

  it("restores the canonical model history and rich public projection into a lazily spawned actor", async () => {
    const restored = createEmptyConversationRecord({ id: "session-1", title: "Restored", now: 1 });
    restored.view = reduceChatEvent(restored.view, {
      version: 1,
      sessionId: "session-1",
      seq: 1,
      event: { type: "user-message", id: "old-user", content: "Earlier", delivery: "applied" },
    }).view;
    restored.modelHistory = [
      { role: "user", content: "Earlier" },
      { role: "assistant", content: "Canonical answer with tool context" },
    ];
    const broker = makeBroker({ conversations: [restored] });

    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("Continue", "session-1", "new-user"));

    expect(broker.sessionOptions[0].history).toEqual([expect.objectContaining({ id: "old-user", content: "Earlier" })]);
    expect(broker.sessionOptions[0].modelHistory).toEqual(restored.modelHistory);
  });

  it("reuses one conversation actor across senders and broadcasts to every attached observer", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest(), { allowed: true, senderId: 1 });
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("second", "session-1", "user-2"), {
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
    await broker.invoke(AI_CHANNELS.chatSubmit, {
      ...submitRequest("token sk-ant-message-secret"),
      history: [userMessage("token sk-ant-history-secret", "old-user")],
      bundle: { errors: "token sk-ant-bundle-secret" },
    });
    expect(JSON.stringify(broker.sessionOptions[0].history)).not.toContain("sk-ant-history-secret");
    expect(JSON.stringify(broker.sessions[0].submitCalls[0].message)).not.toContain("sk-ant-message-secret");
    expect(broker.sessionOptions[0].taskSettings.system).not.toContain("sk-ant-bundle-secret");
  });

  it("uses the requested model for a new idle task and forces ask on an unreadable permission cache", async () => {
    const broker = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      permissions: { status: "error" },
    });
    await broker.invoke(AI_CHANNELS.chatSubmit, { ...submitRequest(), model: "request-model" });
    const task = broker.sessions[0].submitCalls[0].task as AgentSessionTaskSettings;
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

    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest());

    const task = broker.sessions[0].submitCalls[0].task as AgentSessionTaskSettings;
    expect(task.providerFetch).toBeTypeOf("function");
    expect(task).not.toHaveProperty("secret");
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
    expect(JSON.stringify(task)).not.toContain("broker-must-not-read-this");
  });

  it("rejects malformed and unbounded submit payloads before creating an actor", async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, { ...submitRequest(), message: { id: "x", content: "" } }),
    ).rejects.toThrow(/empty/i);
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("x".repeat(MAX_CHAT_MESSAGE_CHARS + 1))),
    ).rejects.toThrow(/too long/i);
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, {
        ...submitRequest(),
        history: Array.from({ length: MAX_INITIAL_HISTORY_MESSAGES + 1 }, (_, index) =>
          userMessage("x", `history-${index}`),
        ),
      }),
    ).rejects.toThrow(/history/i);
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, {
        ...submitRequest(),
        bundle: { errors: "x".repeat(MAX_DIAGNOSTICS_BUNDLE_CHARS + 1) },
      }),
    ).rejects.toThrow(/diagnostics/i);
    expect(broker.createAgentSession).not.toHaveBeenCalled();
  });

  it("caps simultaneously active conversation actors without deleting durable conversations", async () => {
    const broker = makeBroker();
    for (let index = 0; index < MAX_ACTIVE_CHAT_SESSIONS; index += 1) {
      await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("hello", `session-${index}`, `user-${index}`));
    }

    await expect(
      broker.invoke(
        AI_CHANNELS.chatSubmit,
        submitRequest("one too many", `session-${MAX_ACTIVE_CHAT_SESSIONS}`, "overflow-user"),
      ),
    ).rejects.toThrow(/too many active conversations/i);
    expect(await broker.invoke(AI_CHANNELS.chatList)).toHaveLength(MAX_ACTIVE_CHAT_SESSIONS);
  });

  it("requires a new conversation after the retained timeline or model history reaches its bound", async () => {
    const timelineBound = createEmptyConversationRecord({ id: "timeline-bound", title: "Full", now: 1 });
    timelineBound.view.timeline = Array.from({ length: MAX_CONVERSATION_TIMELINE_ITEMS }, (_, index) => ({
      kind: "message" as const,
      id: `message-${index}`,
      role: "user" as const,
      content: "x",
      delivery: "applied" as const,
      status: "complete" as const,
    }));
    const modelBound = createEmptyConversationRecord({ id: "model-bound", title: "Full", now: 1 });
    modelBound.modelHistory = Array.from({ length: MAX_CONVERSATION_MODEL_MESSAGES }, () => ({
      role: "user",
      content: "x",
    }));
    const broker = makeBroker({ conversations: [timelineBound, modelBound] });

    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("continue", "timeline-bound", "next-1")),
    ).rejects.toThrow(/history limit/i);
    await expect(
      broker.invoke(AI_CHANNELS.chatSubmit, submitRequest("continue", "model-bound", "next-2")),
    ).rejects.toThrow(/history limit/i);
    expect(broker.createAgentSession).not.toHaveBeenCalled();
  });

  it("routes awaited snapshot, approval, stop, and delete commands to the global conversation", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest());
    expect(await broker.invoke(AI_CHANNELS.chatSnapshot, { sessionId: "session-1" })).toMatchObject({
      sessionId: "session-1",
      lastSeq: 1,
    });
    expect(
      await broker.invoke(AI_CHANNELS.chatResolve, {
        sessionId: "session-1",
        approvalId: "approval-1",
        decision: "allow",
      }),
    ).toEqual({ accepted: true, phase: "model" });
    expect(broker.sessions[0].resolveApproval).toHaveBeenCalledWith("approval-1", "allow");
    await expect(broker.invoke(AI_CHANNELS.chatCancel, { sessionId: "session-1" })).resolves.toEqual({ ok: true });
    expect(broker.sessions[0].cancel).toHaveBeenCalledOnce();
    await expect(broker.invoke(AI_CHANNELS.chatDispose, { sessionId: "session-1" })).resolves.toEqual({ ok: true });
    expect(broker.sessions[0].dispose).toHaveBeenCalledOnce();
    expect(await broker.invoke(AI_CHANNELS.chatSnapshot, { sessionId: "session-1" })).toBeNull();
  });

  it("allows another authorized observer to control the same app-global conversation", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest(), { allowed: true, senderId: 1 });
    await expect(
      broker.invoke(
        AI_CHANNELS.chatResolve,
        { sessionId: "session-1", approvalId: "approval-1", decision: "allow" },
        { allowed: true, senderId: 2 },
      ),
    ).resolves.toEqual({ accepted: true, phase: "model" });
    expect(broker.sessions[0].resolveApproval).toHaveBeenCalledOnce();
  });

  it("detaches a closing sender without disposing its continuing conversation", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest(), { allowed: true, senderId: 7 });
    broker.broker.disposeForSender(7);
    expect(broker.sessions[0].dispose).not.toHaveBeenCalled();
    expect(
      await broker.invoke(AI_CHANNELS.chatSnapshot, { sessionId: "session-1" }, { allowed: true, senderId: 8 }),
    ).toMatchObject({ sessionId: "session-1", lastSeq: 1 });
  });

  it("contains a session-disposal rejection during broker teardown", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.chatSubmit, submitRequest(), { allowed: true, senderId: 7 });
    broker.sessions[0].dispose.mockRejectedValueOnce(new Error("actor disposal failed"));

    broker.broker.dispose();

    await vi.waitFor(() =>
      expect(broker.logger.error).toHaveBeenCalledWith(
        "AI: chat session disposal failed",
        expect.objectContaining({ sessionId: "session-1", error: "actor disposal failed" }),
      ),
    );
  });
});

describe("AIBroker permission management", () => {
  it("lists, removes, and updates remembered permissions", async () => {
    const broker = makeBroker();
    expect((await broker.invoke(AI_CHANNELS.permissionsList)).status).toBe("ok");
    const key = commandKey("docker", ["system", "prune"]);
    await broker.invoke(AI_CHANNELS.permissionsRemove, { list: "blocked", key });
    expect(broker.removeCommand).toHaveBeenCalledWith("blocked", key);
    await broker.invoke(AI_CHANNELS.permissionsSetWeb, { verdict: "allow" });
    expect(broker.setWebSearch).toHaveBeenCalledWith("allow");
  });
});
