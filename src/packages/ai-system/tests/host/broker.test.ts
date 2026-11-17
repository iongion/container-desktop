import { describe, expect, it, type Mock, vi } from "vitest";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import type { AIKeyStore } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { normalizeAISettings } from "@/ai-system/core/settings";
import type {
  AISettings,
  ListedModel,
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "@/ai-system/core/types";
import { createAIBroker } from "@/ai-system/host/broker";
import type { ProjectContextHost } from "@/ai-system/host/projectContextHost";
import type { SkillHost } from "@/ai-system/host/skillHost";
import { AI_PERMISSIONS_VERSION, type PermissionsSnapshot } from "@/mcp-server/core/permissions";

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
  agentSessionsDir?: () => Promise<string>;
  serveAgentSessions?: (request: { localPort: number; bridgeToken: string }) => Promise<void>;
  stopServingAgentSessions?: () => void;
  providerTransport?: ProviderTransport;
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
    providerTransport: options?.providerTransport ?? {
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
    agentSessionsDir: options?.agentSessionsDir,
    serveAgentSessions: options?.serveAgentSessions,
    stopServingAgentSessions: options?.stopServingAgentSessions,
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

// The agent container's env file. It carries the bridge token, which authorises the whole socket, so it goes into the
// same protected directory the app's own secrets do rather than one the web view can read back. No session file carries
// a provider credential at all any more — the app signs inference itself, per request, from the vault.
describe("AIBroker agent environment", () => {
  it("writes the agent's env file into the protected directory, with no secret to substitute", async () => {
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
    // The broker NEVER reads a secret: on Tauri the vault refuses this realm outright, by design.
    expect(broker.keyStore.getKey).not.toHaveBeenCalled();
  });

  it("refuses an unauthorized sender", async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke(
        AI_CHANNELS.agentEnvFile,
        { fileName: "8f21ac.env", contents: "CD_BRIDGE_TOKEN=tok" },
        { allowed: false },
      ),
    ).rejects.toThrow(/unauthorized/i);
    expect(broker.keyStore.files()).toEqual([]);
  });
});

// The conversations are the user's, so they are mounted from a directory on THIS machine instead of pi's default
// inside the agent volume. The renderer cannot name that directory: the host owns its own data location, and it is
// also the only realm that can CREATE it in time — a bind-mount whose source does not exist is created by the ENGINE,
// owned by root, and the session then fails with EACCES on its first turn rather than at startup.
describe("AIBroker conversations directory", () => {
  it("answers with the directory the host resolved and created", async () => {
    const agentSessionsDir = vi.fn(async () => "/data/assistant-sessions");
    const broker = makeBroker({ agentSessionsDir });

    expect(await broker.invoke(AI_CHANNELS.agentSessionsDir)).toEqual({ path: "/data/assistant-sessions" });
    expect(agentSessionsDir).toHaveBeenCalledTimes(1);
  });

  it("refuses an unauthorized sender", async () => {
    const agentSessionsDir = vi.fn(async () => "/data/assistant-sessions");
    const broker = makeBroker({ agentSessionsDir });

    await expect(broker.invoke(AI_CHANNELS.agentSessionsDir, undefined, { allowed: false })).rejects.toThrow(
      /unauthorized/i,
    );
    // Nothing is created for a sender the transport did not authorise.
    expect(agentSessionsDir).not.toHaveBeenCalled();
  });

  // A runtime with no data directory to offer must say so. Answering with a path nobody created would put the
  // creation back on the engine, which is the failure this channel exists to avoid.
  it("fails loudly on a runtime that can resolve no directory", async () => {
    const broker = makeBroker();
    await expect(broker.invoke(AI_CHANNELS.agentSessionsDir)).rejects.toThrow(/unavailable/i);
  });

  // The OTHER route to the same directory, for a pair whose engine cannot see this filesystem: it publishes a socket
  // and this host answers pi's session reads and writes over it, so the conversations still never leave the machine.
  it("serves the conversations on the port the caller reached the pair through", async () => {
    const serveAgentSessions = vi.fn(async () => {});
    const broker = makeBroker({ serveAgentSessions });

    expect(await broker.invoke(AI_CHANNELS.agentSessionsServe, { localPort: 43900, bridgeToken: "tok" })).toEqual({
      ok: true,
    });
    expect(serveAgentSessions).toHaveBeenCalledWith({ localPort: 43900, bridgeToken: "tok" });
  });

  it("refuses an unauthorized sender, which would otherwise be handed the whole history", async () => {
    const serveAgentSessions = vi.fn(async () => {});
    const broker = makeBroker({ serveAgentSessions });

    await expect(
      broker.invoke(AI_CHANNELS.agentSessionsServe, { localPort: 43900, bridgeToken: "tok" }, { allowed: false }),
    ).rejects.toThrow(/unauthorized/i);
    expect(serveAgentSessions).not.toHaveBeenCalled();
  });

  // The caller is about to start a session whose every storage call BLOCKS. "Nobody is answering" has to fail here,
  // where it is legible, rather than as a model that never replied.
  it("fails loudly on a runtime that cannot serve them", async () => {
    const broker = makeBroker();
    await expect(
      broker.invoke(AI_CHANNELS.agentSessionsServe, { localPort: 43900, bridgeToken: "tok" }),
    ).rejects.toThrow(/unavailable/i);
  });

  // Runs on every stop, including one tearing down a start that failed before anything was served.
  it("stops serving without complaint when nothing was being served", async () => {
    const broker = makeBroker();
    expect(await broker.invoke(AI_CHANNELS.agentSessionsUnserve)).toEqual({ ok: true });
  });

  it("stops the store the session was served by", async () => {
    const stopServingAgentSessions = vi.fn();
    const broker = makeBroker({ stopServingAgentSessions });

    await broker.invoke(AI_CHANNELS.agentSessionsUnserve);

    expect(stopServingAgentSessions).toHaveBeenCalledTimes(1);
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

// Inference. The session asks over the bridge, the app performs it — because the provider key lives in the OS keychain
// and is attached in the realm that owns it. Nothing here holds a credential; what it decides is where the container's
// path may land, and how the answer gets back.
describe("AIBroker inference for the session", () => {
  const KEYLESS_LOCAL = {
    defaultProvider: "llamacpp",
    providers: { llamacpp: { model: "m", baseURL: "http://127.0.0.1:8080/v1", auth: { scheme: "none" as const } } },
  };

  function respondingTransport(chunks: string[], status = 200) {
    const requests: ProviderTransportRequest[] = [];
    const transport: ProviderTransport = {
      request: vi.fn(async (request) => {
        requests.push(request);
        return {
          status,
          statusText: "OK",
          headers: { "content-type": "text/event-stream" },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
              controller.close();
            },
          }),
        };
      }),
      dispose: vi.fn(),
    };
    return { transport, requests };
  }

  const frames = (sent: Array<{ channel: string; payload: any }>) =>
    sent.filter(({ channel }) => channel === AI_CHANNELS.providerStream).map(({ payload }) => payload);

  const decoded = (sent: Array<{ channel: string; payload: any }>) =>
    frames(sent)
      .filter(({ event }) => event.kind === "chunk")
      .map(({ event }) => new TextDecoder().decode(Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0))))
      .join("");

  it("streams the answer back as head, chunks and end", async () => {
    const { transport, requests } = respondingTransport(["data: one\n\n", "data: two\n\n"]);
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await expect(
      broker.invoke(AI_CHANNELS.providerRequest, {
        requestId: "pv-1",
        method: "POST",
        path: "/v1/chat/completions",
        headers: { "content-type": "application/json" },
        body: btoa('{"model":"m"}'),
      }),
    ).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(frames(broker.sent).at(-1)?.event.kind).toBe("end"));

    expect(frames(broker.sent).map(({ event }) => event.kind)).toEqual(["head", "chunk", "chunk", "end"]);
    expect(frames(broker.sent)[0].event).toMatchObject({ status: 200, statusText: "OK" });
    expect(decoded(broker.sent)).toBe("data: one\n\ndata: two\n\n");
    // The path the container named, joined onto the provider the USER configured — the container never names a host.
    expect(requests[0].url).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(new TextDecoder().decode(requests[0].body)).toBe('{"model":"m"}');
  });

  // The invoke says only "accepted". Waiting for the whole answer would block the container's own request for the
  // length of a turn, and the first chunk already proves it started.
  it("settles the invoke without waiting for the answer", async () => {
    let release: (() => void) | undefined;
    const transport: ProviderTransport = {
      request: vi.fn(
        () =>
          new Promise<ProviderTransportResponse>((resolve) => {
            release = () => resolve({ status: 200, statusText: "OK", headers: {}, body: null });
          }),
      ),
      dispose: vi.fn(),
    };
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await expect(
      broker.invoke(AI_CHANNELS.providerRequest, {
        requestId: "pv-1",
        method: "GET",
        path: "/v1/models",
        headers: {},
      }),
    ).resolves.toEqual({ ok: true });
    expect(frames(broker.sent)).toEqual([]);
    release?.();
  });

  // An upstream that answered 401 is still an ANSWER: pi's own client reads the status and reports the refusal, which
  // is more use to the user than "inference failed".
  it("carries a refusing status through rather than turning it into a failure", async () => {
    const { transport } = respondingTransport(['{"error":"no"}'], 401);
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
    });
    await vi.waitFor(() => expect(frames(broker.sent).at(-1)?.event.kind).toBe("end"));

    expect(frames(broker.sent)[0].event).toMatchObject({ kind: "head", status: 401 });
  });

  // The container is the untrusted world, and the path is the one thing it chooses. A refusal has to reach it as the
  // answer — pi is blocked on the stream — and be loud here, because nothing pi does produces one.
  it("refuses a path that would leave the configured endpoint, and says so on the wire", async () => {
    const { transport, requests } = respondingTransport([]);
    const broker = makeBroker({
      init: {
        defaultProvider: "llamacpp",
        providers: { llamacpp: { model: "m", baseURL: "https://openrouter.ai/api/v1", auth: { scheme: "none" } } },
      },
      providerTransport: transport,
    });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "POST",
      path: "/v1/../../admin",
      headers: {},
    });
    await vi.waitFor(() => expect(frames(broker.sent)).toHaveLength(1));

    expect(frames(broker.sent)[0].event).toMatchObject({ kind: "error" });
    expect(requests).toEqual([]);
    expect(broker.logger.error).toHaveBeenCalled();
  });

  it("refuses a method inference never uses", async () => {
    const { transport, requests } = respondingTransport([]);
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "DELETE",
      path: "/v1/models",
      headers: {},
    });
    await vi.waitFor(() => expect(frames(broker.sent)).toHaveLength(1));

    expect(frames(broker.sent)[0].event).toMatchObject({ kind: "error" });
    expect(requests).toEqual([]);
  });

  // A failure has to arrive as the answer. pi is blocked inside its provider client, and a turn that simply never
  // received another byte reads as a model that stopped talking.
  it("reports a transport failure as the answer", async () => {
    const transport: ProviderTransport = {
      request: vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.example");
      }),
      dispose: vi.fn(),
    };
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
    });
    await vi.waitFor(() => expect(frames(broker.sent)).toHaveLength(1));

    expect(frames(broker.sent)[0].event).toMatchObject({
      kind: "error",
      message: expect.stringContaining("ENOTFOUND"),
    });
  });

  // A cancelled turn must stop the app pulling bytes the user pays for. The abort is not a failure either — the
  // container dropped its client on purpose and is no longer listening.
  it("aborts a request the session cancelled, and reports nothing back", async () => {
    let signal: AbortSignal | undefined;
    const transport: ProviderTransport = {
      request: vi.fn(
        (_request, requestSignal) =>
          new Promise<ProviderTransportResponse>((_resolve, reject) => {
            signal = requestSignal;
            requestSignal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
      dispose: vi.fn(),
    };
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    await expect(broker.invoke(AI_CHANNELS.providerCancel, { requestId: "pv-1" })).resolves.toEqual({ ok: true });

    expect(signal?.aborted).toBe(true);
    await vi.waitFor(() => expect(transport.request).toHaveBeenCalled());
    expect(frames(broker.sent)).toEqual([]);
  });

  it("cancelling something it never had is not an error", async () => {
    const broker = makeBroker({ init: KEYLESS_LOCAL });
    await expect(broker.invoke(AI_CHANNELS.providerCancel, { requestId: "pv-nobody" })).resolves.toEqual({ ok: true });
  });

  it("refuses an unauthorized sender, like every other channel", async () => {
    const broker = makeBroker({ init: KEYLESS_LOCAL });
    await expect(
      broker.invoke(
        AI_CHANNELS.providerRequest,
        { requestId: "pv-1", method: "POST", path: "/v1/chat/completions", headers: {} },
        { allowed: false, senderId: 1 },
      ),
    ).rejects.toThrow(/unauthorized/i);
  });

  // Anything still streaming when the app closes is billed for as long as it runs, and there is nothing left to
  // deliver it to.
  it("aborts what is still in flight when it is disposed", async () => {
    let signal: AbortSignal | undefined;
    const transport: ProviderTransport = {
      request: vi.fn(
        (_request, requestSignal) =>
          new Promise<ProviderTransportResponse>((_resolve, reject) => {
            signal = requestSignal;
            requestSignal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
      dispose: vi.fn(),
    };
    const broker = makeBroker({ init: KEYLESS_LOCAL, providerTransport: transport });

    await broker.invoke(AI_CHANNELS.providerRequest, {
      requestId: "pv-1",
      method: "POST",
      path: "/v1/chat/completions",
      headers: {},
    });
    await vi.waitFor(() => expect(signal).toBeDefined());
    broker.broker.dispose();

    expect(signal?.aborted).toBe(true);
  });
});
