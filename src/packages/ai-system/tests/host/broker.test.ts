import { describe, expect, it, type Mock, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { AI_PERMISSIONS_VERSION, type PermissionsSnapshot } from "@/ai-system/core/permissions";
import type { AIKeyStore } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import type { AISettings, ListedModel } from "@/ai-system/core/types";
import { createAIBroker } from "@/ai-system/host/broker";
import type { ProjectContextHost } from "@/ai-system/host/projectContextHost";
import type { SkillHost } from "@/ai-system/host/skillHost";

const LOCAL_AGENT_SETTINGS = {
  defaultProvider: "llamacpp",
  providers: { llamacpp: { model: "m", baseURL: "http://127.0.0.1:8080/v1" } },
};

function fakeKeyStore(): AIKeyStore & {
  getKey: Mock;
  setDegraded: (degraded: boolean) => void;
  files: () => Array<{ fileName: string; contents: string }>;
} {
  const keys = new Map<string, string>();
  const written: Array<{ fileName: string; contents: string }> = [];
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
    // Stands in for the vault-owning realm: it substitutes the placeholder itself, so a test can assert the
    // file the container receives WITHOUT the secret ever passing through the broker.
    writeSecretFile: vi.fn(async (provider: string, fileName: string, contents: string) => {
      written.push({ fileName, contents: contents.replace("__CD_KEYCHAIN_SECRET__", keys.get(provider) ?? "") });
      return `/data/agent/${fileName}`;
    }),
    // The agent's own env file, into the same directory — no secret to substitute, which is the whole difference.
    writeAgentEnvFile: vi.fn(async (fileName: string, contents: string) => {
      written.push({ fileName, contents });
      return `/data/agent/${fileName}`;
    }),
    setDegraded: (value) => {
      degraded = value;
    },
    files: () => written,
  };
}

function makeBroker(options?: {
  init?: Partial<AISettings>;
  permissions?: Partial<PermissionsSnapshot>;
  listModels?: (
    provider: ResolvedProvider,
    opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
  ) => Promise<ListedModel[]>;
  skillHost?: SkillHost;
  projectContextHost?: ProjectContextHost;
}) {
  const handlers = new Map<string, (event: any, payload: any) => any>();
  const sent: Array<{ event: any; channel: string; payload: any }> = [];
  const keyStore = fakeKeyStore();
  let settings = normalizeAISettings(options?.init ?? LOCAL_AGENT_SETTINGS);
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
  const logger = { error: vi.fn() };
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
    webSearcher: vi.fn(async () => ({ text: "web result" })),
    skillHost: options?.skillHost,
    buildSkillInvocationPrompt: ({ body }) => `PROMPT:${body}`,
    projectContextHost: options?.projectContextHost,
    logger,
  });
  broker.register();
  return {
    broker,
    handlers,
    sent,
    keyStore,
    permissionsStore,
    removeCommand,
    logger,
    setSettings: (next: Partial<AISettings>) => {
      settings = normalizeAISettings(next);
    },
    invoke: (channel: string, payload?: unknown, event: any = { allowed: true, senderId: 1 }) =>
      handlers.get(channel)!(event, payload),
  };
}

// The coding agent's gateway container needs the provider key; the renderer cannot read it. So the broker
// composes that env file host-side, which is the only place the keychain is readable.
describe("AIBroker agent gateway environment", () => {
  const request = {
    provider: "openai",
    fileName: "8f21ac-gateway.env",
    baseUrl: "https://api.openai.com/v1",
    bridgeToken: "tok",
    gatewayPort: 8788,
  };

  it("puts the keychain key in the file and answers only its path", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-secret", allowDegraded: true });

    const result = await broker.invoke(AI_CHANNELS.agentGatewayEnv, request);

    expect(result).toEqual({ path: "/data/agent/8f21ac-gateway.env" });
    // The broker NEVER reads the secret: it composes a placeholder and the realm that owns the vault
    // substitutes it while writing. That is what lets this run in a web view whose getKey refuses outright.
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
    const [written] = broker.keyStore.files();
    expect(written.fileName).toBe("8f21ac-gateway.env");
    expect(written.contents).toContain("CD_UPSTREAM_API_KEY=sk-secret");
    expect(written.contents).toContain("CD_UPSTREAM_BASE_URL=https://api.openai.com/v1");
    expect(written.contents).toContain("CD_BRIDGE_TOKEN=tok");
    expect(written.contents).toContain("CD_GATEWAY_PORT=8788");
    // The credential SHAPE is derived host-side too, from the settings this host reads itself — the renderer
    // never describes how a provider authenticates, only which one was picked.
    expect(written.contents).toContain("CD_UPSTREAM_KIND=openai");
    expect(written.contents).toContain("CD_UPSTREAM_AUTH_SCHEME=bearer");
    // The answer must not carry the secret back across the boundary.
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  // The AGENT's env file goes into the SAME protected directory as the gateway's. It used to be written to a second
  // directory outside the fs guard, so the bridge token that authorises the whole socket was readable from the web
  // view while the provider key beside it was not.
  it("writes the agent's own env file into the same protected directory, with no secret to substitute", async () => {
    const broker = makeBroker();
    const result = await broker.invoke(AI_CHANNELS.agentEnvFile, {
      fileName: "8f21ac.env",
      contents: "CD_BRIDGE_TOKEN=tok\nCD_BRIDGE_PORT=8787",
    });
    expect(result).toEqual({ path: "/data/agent/8f21ac.env" });
    const [written] = broker.keyStore.files();
    expect(written.contents).toContain("CD_BRIDGE_TOKEN=tok");
    // No provider credential belongs in the agent's container: plugin code runs there.
    expect(written.contents).not.toContain("CD_UPSTREAM_API_KEY");
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
  });

  // A keyless local server (LM Studio, llama.cpp) is a first-class case, not a failure.
  it("writes an empty key when the provider has none stored", async () => {
    const broker = makeBroker();
    await broker.invoke(AI_CHANNELS.agentGatewayEnv, request);
    expect(broker.keyStore.files()[0].contents).toContain("CD_UPSTREAM_API_KEY=\n");
  });

  // The webview-realm keychain REFUSES to hand a secret to this realm — on Tauri the key is only ever resolved
  // natively, so getKey throws rather than answering. A keyless provider has no secret to ask for, so reading
  // one anyway is both pointless and fatal: it threw before the empty value it would have used, and every
  // keyless session died at start with an error nowhere near the cause. Same rule as routeByAuthScheme.
  it("composes a keyless provider's env without reading the keychain", async () => {
    const broker = makeBroker();
    broker.keyStore.getKey.mockRejectedValue(
      new Error("AI: reading the provider key is not available in the web view"),
    );

    const result = await broker.invoke(AI_CHANNELS.agentGatewayEnv, {
      ...request,
      provider: "llamacpp",
      baseUrl: "http://host.containers.internal:8080/v1",
    });

    expect(result).toEqual({ path: "/data/agent/8f21ac-gateway.env" });
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
    expect(broker.keyStore.files()[0].contents).toContain("CD_UPSTREAM_API_KEY=\n");
    expect(broker.keyStore.files()[0].contents).toContain("CD_UPSTREAM_AUTH_SCHEME=none");
  });

  it("refuses an unauthorized sender", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.agentGatewayEnv, request, { allowed: false })).rejects.toThrow(
      /unauthorized/i,
    );
    expect(broker.keyStore.files()).toEqual([]);
  });
});

describe("AIBroker security and settings", () => {
  it("guards every invoke from unauthorized senders", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.status, undefined, { allowed: false })).rejects.toThrow(/unauthorized/i);
    await expect(
      broker.invoke(AI_CHANNELS.webSearch, { query: "anything" }, { allowed: false, senderId: 1 }),
    ).rejects.toThrow(/unauthorized/i);
    await expect(
      broker.invoke(AI_CHANNELS.engineOp, { op: "listContainers" }, { allowed: false, senderId: 1 }),
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
      capabilities: { sandbox: true },
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

    await expect(
      broker.invoke(AI_CHANNELS.modelsList, { providerId: "llamacpp", requestId: "models-auth-none" }),
    ).resolves.toMatchObject({ models: [{ id: "m1" }, { id: "m2" }] });
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
