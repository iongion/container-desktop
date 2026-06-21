import { describe, expect, it, vi } from "vitest";
import type { AgentToolDeps, KnowledgeBankLike, KnowledgeEntry, PermissionsSnapshot } from "@/ai-system/core";
import { AI_CHANNELS, commandKey, normalizeAISettings } from "@/ai-system/core";
import { AIBroker } from "@/ai-system/host/broker";
import { executeSandboxed } from "@/ai-system/runtimes/node/agent/sandbox";
import { createAgentTools } from "@/ai-system/runtimes/node/agent/tools";
import type { AIKeyStore } from "@/ai-system/runtimes/node/keyStore";
import type { AISettings } from "@/env/Types";

const kbEntry = (over: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  id: "k1",
  domain: "podman",
  title: "T",
  symptom: "s",
  solution: "fix",
  ...over,
});

function fakeKeyStore(): AIKeyStore & { setDegraded: (d: boolean) => void } {
  const keys = new Map<string, string>();
  let degraded = false;
  return {
    getEncryptionStatus: () => ({ available: !degraded, backend: degraded ? "basic_text" : "kwallet", degraded }),
    hasKey: async (p: string) => keys.has(p),
    getKey: async (p: string) => keys.get(p),
    setKey: async (p: string, v: string, opts?: { allowDegraded?: boolean }) => {
      if (degraded && !opts?.allowDegraded) {
        throw new Error("AI key storage is degraded");
      }
      keys.set(p, v);
    },
    clearKey: async (p: string) => {
      keys.delete(p);
    },
    setDegraded: (d: boolean) => {
      degraded = d;
    },
  };
}

const LOCAL_AGENT_SETTINGS = {
  defaultProvider: "llamacpp",
  providers: { llamacpp: { model: "m", baseURL: "http://127.0.0.1:8080/v1" } },
};

// A pending command surfaced for approval on the first turn; later turns just stream text. The mock runner
// emits the timeline event the way the real tools would (via onToolEvent), so the broker's emit/resolve
// path is exercised without a real model. `calls` is the runner-call log (length 1 ⇒ first turn).
function approvalThenResumeRunner(params: any, calls: any[]) {
  if (calls.length === 1) {
    params.onToolEvent?.({
      type: "approval-request",
      actionId: "act-1",
      kind: "command",
      program: "podman",
      args: ["stop", "web"],
      reason: "changes state",
    });
    params.onDelta("please approve");
    params.onDone("stop");
  } else {
    params.onDelta("resumed");
    params.onDone("stop");
  }
}

function makeBroker(opts?: {
  init?: Partial<AISettings>;
  permissions?: Partial<PermissionsSnapshot>;
  runner?: (params: any, calls: any[]) => void;
}) {
  const handlers = new Map<string, (event: any, payload: any) => any>();
  const messageHandlers = new Map<string, (event: any, payload: any) => any>();
  const sent: any[] = [];
  const keyStore = fakeKeyStore();
  let settings = normalizeAISettings({ ...opts?.init });
  const listModelsCalls: any[] = [];

  // Fake agent runner: records its params; default emits two deltas + done. Custom runners get the call log.
  const agentRunnerCalls: any[] = [];
  const agentRunner = (params: any) => {
    agentRunnerCalls.push(params);
    if (opts?.runner) {
      opts.runner(params, agentRunnerCalls);
    } else {
      params.onDelta("agent ");
      params.onDelta("done");
      params.onDone("stop");
    }
  };

  // The sandbox is wired through the REAL executeSandboxed with a spy executor, so the resolve path is
  // verified end-to-end (a floor-blocked command must never reach the spy in ask/remember mode).
  const sandboxExecSpy = vi.fn(async () => ({
    pid: 1,
    code: 0,
    success: true,
    stdout: "OUT",
    stderr: "",
    command: "",
  }));
  const runSandboxed = (cmd: any, runOpts?: { enforceFloor?: boolean }) =>
    executeSandboxed(cmd, { exec: sandboxExecSpy, enforceFloor: runOpts?.enforceFloor });

  // Capture the toolDeps the broker assembles (mode/cacheLookup/webVerdict) while still building real tools.
  const toolDepsCalls: AgentToolDeps[] = [];
  const buildAgentTools = (deps: AgentToolDeps) => {
    toolDepsCalls.push(deps);
    return createAgentTools(deps);
  };

  // Fake permission store. `load` returns a snapshot the test controls; writes are spied.
  const snapshot: PermissionsSnapshot = {
    status: "ok",
    path: "/tmp/ai-permissions.json",
    version: "1.0.0",
    allowed: [],
    blocked: [],
    ...opts?.permissions,
  };
  const addCommand = vi.fn(async () => snapshot);
  const removeCommand = vi.fn(async () => snapshot);
  const setWebSearch = vi.fn(async () => snapshot);
  const permissionsStore = { load: async () => snapshot, addCommand, removeCommand, setWebSearch };

  const knowledgeBank: KnowledgeBankLike = { search: async () => [kbEntry()] };
  const webSearcher = vi.fn(async () => ({ text: "web result" }));
  const broker = new AIBroker({
    keyStore,
    getAISettings: async () => settings,
    onInvoke: (channel, handler) => handlers.set(channel, handler),
    onMessage: (channel, handler) => messageHandlers.set(channel, handler),
    send: (_event, channel, payload) => sent.push({ channel, payload }),
    senderId: (event: any) => event?.senderId ?? 1,
    isAllowedSender: (event: any) => event?.allowed === true,
    listModels: async (baseURL: string, opts2?: any) => {
      listModelsCalls.push({ baseURL, opts: opts2 });
      return [{ id: "m1" }, { id: "m2" }];
    },
    buildGeneratePrompt: () => "Generate a file.",
    buildAgentPrompt: (bundle?: unknown) => `Assistant. Context: ${JSON.stringify(bundle ?? {})}`,
    agentRunner,
    runSandboxed,
    buildAgentTools,
    permissionsStore,
    knowledgeBank,
    webSearcher,
  });
  broker.register();
  return {
    broker,
    keyStore,
    sent,
    agentRunnerCalls,
    toolDepsCalls,
    listModelsCalls,
    sandboxExecSpy,
    webSearcher,
    addCommand,
    removeCommand,
    setWebSearch,
    setSettings: (s: Partial<AISettings>) => {
      settings = normalizeAISettings({ ...s });
    },
    invoke: (channel: string, payload?: any, event: any = { allowed: true }) => handlers.get(channel)!(event, payload),
    message: (channel: string, payload?: any, event: any = { allowed: true }) =>
      messageHandlers.get(channel)!(event, payload),
  };
}

const userMsg = (content: string, id = "1") => ({ id, role: "user" as const, content, createdAt: 1 });

describe("AIBroker — keys / status / egress / models", () => {
  it("rejects calls from an unauthorized (non-main-window) sender", async () => {
    const b = makeBroker();
    await expect(b.invoke(AI_CHANNELS.status, undefined, { allowed: false })).rejects.toThrow(/unauthorized/i);
  });

  it("stores and reports keys when authorized", async () => {
    const b = makeBroker();
    expect(await b.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(false);
    await b.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-secret" });
    expect(await b.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(true);
  });

  it("exposes status (encryption health)", async () => {
    const b = makeBroker();
    const status = await b.invoke(AI_CHANNELS.status);
    expect(status.encryption.degraded).toBe(false);
  });

  it("redacts secrets in the outbound preview", async () => {
    const b = makeBroker();
    const preview = await b.invoke(AI_CHANNELS.preview, { payload: { apiKey: "sk-ant-secret", model: "m" } });
    expect(preview.text).toContain("[REDACTED]");
    expect(preview.text).not.toContain("sk-ant-secret");
  });

  it("classifies a cloud provider as off-device and a loopback local one as on-device", async () => {
    const b = makeBroker();
    const cloud = await b.invoke(AI_CHANNELS.egressCheck, { providerId: "anthropic" });
    expect(cloud.offDevice).toBe(true);
    expect(cloud.allowed).toBe(true);

    const local = await b.invoke(AI_CHANNELS.egressCheck, { providerId: "llamacpp" });
    expect(local.offDevice).toBe(false);
    expect(local.allowed).toBe(true);
  });

  it("refuses to store a cloud key under degraded encryption unless explicitly allowed", async () => {
    const b = makeBroker();
    b.keyStore.setDegraded(true);
    await expect(b.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-x" })).rejects.toThrow(/degraded/i);
    await b.invoke(AI_CHANNELS.keySet, { provider: "openai", key: "sk-x", allowDegraded: true });
    expect(await b.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(true);
  });

  it("rejects malformed provider ids before touching the key store", async () => {
    const b = makeBroker();
    for (const provider of [undefined, "", 123, "../../etc/passwd", "a b", "x".repeat(100)]) {
      await expect(b.invoke(AI_CHANNELS.keySet, { provider, key: "sk-x" })).rejects.toThrow(/invalid provider/i);
      await expect(b.invoke(AI_CHANNELS.keyHas, { provider })).rejects.toThrow(/invalid provider/i);
      await expect(b.invoke(AI_CHANNELS.keyClear, { provider })).rejects.toThrow(/invalid provider/i);
    }
    expect(await b.invoke(AI_CHANNELS.keyHas, { provider: "openai" })).toBe(false);
  });

  it("requires a non-empty string key on set", async () => {
    const b = makeBroker();
    for (const key of [undefined, "", "   ", 42, null]) {
      await expect(b.invoke(AI_CHANNELS.keySet, { provider: "openai", key })).rejects.toThrow(/non-empty/i);
    }
  });

  it("lists models for a provider through the egress gate", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    const res = await b.invoke(AI_CHANNELS.modelsList, { providerId: "llamacpp" });
    expect(res.models.map((m: any) => m.id)).toEqual(["m1", "m2"]);
  });

  it("admits a cloud provider configured with auth scheme 'none' (no credential needed)", async () => {
    const b = makeBroker({
      init: { defaultProvider: "openrouter", providers: { openrouter: { model: "", auth: { scheme: "none" } } } },
    });
    const res = await b.invoke(AI_CHANNELS.modelsList, { providerId: "openrouter" });
    expect(res.models.map((m: any) => m.id)).toEqual(["m1", "m2"]);
  });

  it("blocks a local provider configured with bearer but no stored credential", async () => {
    const b = makeBroker({
      init: { defaultProvider: "lmstudio", providers: { lmstudio: { model: "", auth: { scheme: "bearer" } } } },
    });
    await expect(b.invoke(AI_CHANNELS.modelsList, { providerId: "lmstudio" })).rejects.toThrow(/credential/i);
  });

  it("forwards the resolved auth + decrypted secret to listModels", async () => {
    const b = makeBroker({ init: { defaultProvider: "openrouter" } });
    await b.invoke(AI_CHANNELS.keySet, { provider: "openrouter", key: "sk-or-test" });
    await b.invoke(AI_CHANNELS.modelsList, { providerId: "openrouter" });
    expect(b.listModelsCalls[0].opts).toEqual({ auth: { scheme: "bearer" }, secret: "sk-or-test" });
  });
});

describe("AIBroker — the unified always-agentic conversation", () => {
  it("streams a local chat: returns a streamId and pushes deltas + done", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    const res = await b.invoke(AI_CHANNELS.chat, { sessionId: "s1", messages: [userMsg("hi")] });
    expect(res.streamId).toMatch(/^ai-\d+$/);
    const deltas = b.sent.filter((e) => e.payload.type === "delta").map((e) => e.payload.payload.text);
    expect(deltas.join("")).toBe("agent done");
    expect(b.sent.at(-1)?.payload.type).toBe("done");
  });

  it("honors a per-request model override and otherwise falls back to the settings model", async () => {
    const b = makeBroker({
      init: {
        defaultProvider: "llamacpp",
        providers: { llamacpp: { model: "settings-model", baseURL: "http://127.0.0.1:8080/v1" } },
      },
    });
    await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("hi")] });
    expect(b.agentRunnerCalls[0].resolved.model).toBe("settings-model");
    await b.invoke(AI_CHANNELS.chat, { sessionId: "s", model: "request-model", messages: [userMsg("hi", "2")] });
    expect(b.agentRunnerCalls[1].resolved.model).toBe("request-model");
  });

  it("rejects chat from an unauthorized sender", async () => {
    const b = makeBroker();
    await expect(b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [] }, { allowed: false })).rejects.toThrow(
      /unauthorized/i,
    );
  });

  it("blocks an off-device (cloud) provider without an API key and redacts messages before streaming", async () => {
    const b = makeBroker({ init: { defaultProvider: "anthropic" } });
    await expect(
      b.invoke(AI_CHANNELS.chat, { sessionId: "s", providerId: "anthropic", messages: [userMsg("x")] }),
    ).rejects.toThrow(/credential/i);

    const b2 = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    await b2.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("my key is sk-ant-abc123secret")] });
    const handed = b2.agentRunnerCalls[0].messages[0].content as string;
    expect(handed).toContain("[REDACTED]");
    expect(handed).not.toContain("sk-ant-abc123secret");
  });

  it("redacts the diagnostics bundle into the agent prompt", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    await b.invoke(AI_CHANNELS.chat, {
      sessionId: "s",
      messages: [userMsg("why?")],
      bundle: { errors: "saw token sk-ant-abc123secret in logs" },
    });
    const system = b.agentRunnerCalls[0].system as string;
    expect(system).toContain("[REDACTED]");
    expect(system).not.toContain("sk-ant-abc123secret");
  });

  it("cancel aborts the stream's controller", async () => {
    const aborted: boolean[] = [];
    const b = makeBroker({
      init: LOCAL_AGENT_SETTINGS,
      runner: (params) => {
        params.signal.addEventListener("abort", () => aborted.push(true));
      },
    });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("hi")] });
    b.message(AI_CHANNELS.chatCancel, { streamId });
    expect(aborted).toEqual([true]);
  });

  it("generate streams a result and redacts the template/instruction", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    const res = await b.invoke(AI_CHANNELS.generate, {
      kind: "dockerfile",
      template: "ENV TOKEN=sk-ant-abc123secret",
      instruction: "improve it",
    });
    expect(res.streamId).toMatch(/^ai-\d+$/);
    const handed = b.agentRunnerCalls[0].messages[0].content as string;
    expect(handed).toContain("[REDACTED]");
    expect(handed).not.toContain("sk-ant-abc123secret");
    // No tools for one-shot generation.
    expect(b.agentRunnerCalls[0].tools.runCommand).toBeUndefined();
    expect(b.sent.at(-1)?.payload.type).toBe("done");
  });

  it("offers the webSearch tool ONLY when web search is enabled", async () => {
    const off = makeBroker({ init: LOCAL_AGENT_SETTINGS });
    await off.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    expect(off.agentRunnerCalls[0].tools.webSearch).toBeUndefined();

    const on = makeBroker({ init: { ...LOCAL_AGENT_SETTINGS, webSearch: true } });
    await on.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    expect(on.agentRunnerCalls[0].tools.webSearch).toBeDefined();
  });
});

describe("AIBroker — permission mode wiring (fail-closed)", () => {
  it("threads the settings permission mode into the tool deps", async () => {
    const b = makeBroker({ init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" } });
    await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    expect(b.toolDepsCalls[0].mode).toBe("remember");
  });

  it("forces 'ask' when the permissions cache is unreadable (fail-closed)", async () => {
    const b = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      permissions: { status: "error" },
    });
    await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    expect(b.toolDepsCalls[0].mode).toBe("ask");
  });

  it("wires a cacheLookup that reflects the loaded snapshot", async () => {
    const b = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      permissions: {
        allowed: [{ program: "podman", args: ["ps"] }],
        blocked: [{ program: "docker", args: ["system", "prune"] }],
      },
    });
    await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    const lookup = b.toolDepsCalls[0].cacheLookup!;
    expect(lookup(commandKey("podman", ["ps"]))).toBe("allow");
    expect(lookup(commandKey("docker", ["system", "prune"]))).toBe("block");
    expect(lookup(commandKey("podman", ["info"]))).toBeUndefined();
  });
});

describe("AIBroker — resolve (run / persist / resume)", () => {
  it("runs a surfaced command once on allow, emits its result, and resumes the turn", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS, runner: approvalThenResumeRunner });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    expect(b.agentRunnerCalls).toHaveLength(1);
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "allow" });
    expect(b.sandboxExecSpy).toHaveBeenCalledTimes(1);
    const result = b.sent.find((e) => e.payload.payload?.event?.type === "command-result");
    expect(result?.payload.payload.event.stdout).toBe("OUT");
    expect(b.agentRunnerCalls).toHaveLength(2); // resumed
  });

  it("a reject NEVER runs the command and still resumes the turn", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS, runner: approvalThenResumeRunner });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "reject" });
    expect(b.sandboxExecSpy).not.toHaveBeenCalled();
    expect(b.agentRunnerCalls).toHaveLength(2); // resumed with a declined note
  });

  it("is one-shot — a replayed actionId does nothing", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS, runner: approvalThenResumeRunner });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "allow" });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "allow" });
    expect(b.sandboxExecSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores a resolve from a different (even authorized) sender than the one that opened the stream", async () => {
    const b = makeBroker({ init: LOCAL_AGENT_SETTINGS, runner: approvalThenResumeRunner });
    const { streamId } = await b.invoke(
      AI_CHANNELS.chat,
      { sessionId: "s", messages: [userMsg("q")] },
      { allowed: true, senderId: 1 },
    );
    await b.message(
      AI_CHANNELS.agentResolve,
      { streamId, actionId: "act-1", decision: "allow" },
      { allowed: true, senderId: 2 },
    );
    expect(b.sandboxExecSpy).not.toHaveBeenCalled();
  });

  it("remember mode persists an allow on resolve", async () => {
    const b = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      runner: approvalThenResumeRunner,
    });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "allow" });
    expect(b.addCommand).toHaveBeenCalledWith("allowed", { program: "podman", args: ["stop", "web"] });
  });

  it("remember mode persists a block on resolve reject", async () => {
    const b = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "remember" },
      runner: approvalThenResumeRunner,
    });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "reject" });
    expect(b.addCommand).toHaveBeenCalledWith("blocked", { program: "podman", args: ["stop", "web"] });
  });

  it("ask mode does NOT persist a resolved decision", async () => {
    const b = makeBroker({
      init: { ...LOCAL_AGENT_SETTINGS, permissionMode: "ask" },
      runner: approvalThenResumeRunner,
    });
    const { streamId } = await b.invoke(AI_CHANNELS.chat, { sessionId: "s", messages: [userMsg("q")] });
    await b.message(AI_CHANNELS.agentResolve, { streamId, actionId: "act-1", decision: "allow" });
    expect(b.addCommand).not.toHaveBeenCalled();
  });
});

describe("AIBroker — permission cache management", () => {
  it("lists / removes / sets the web switch, all sender-guarded", async () => {
    const b = makeBroker();
    expect((await b.invoke(AI_CHANNELS.permissionsList)).status).toBe("ok");
    await b.invoke(AI_CHANNELS.permissionsRemove, { list: "blocked", key: commandKey("docker", ["system", "prune"]) });
    expect(b.removeCommand).toHaveBeenCalledWith("blocked", commandKey("docker", ["system", "prune"]));
    await b.invoke(AI_CHANNELS.permissionsSetWeb, { verdict: "allow" });
    expect(b.setWebSearch).toHaveBeenCalledWith("allow");

    await expect(b.invoke(AI_CHANNELS.permissionsList, undefined, { allowed: false })).rejects.toThrow(/unauthorized/i);
  });
});
