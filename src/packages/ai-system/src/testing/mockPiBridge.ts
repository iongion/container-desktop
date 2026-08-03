// A scripted stand-in for the in-container pi session, used when CONTAINER_DESKTOP_MOCK is on. It implements
// the same `PiBridgeClient` the real session uses and speaks the same `BridgeEvent`s, so the renderer runs its
// production path end to end — projection, cards, approvals, surfaces — with no engine, no container and no
// model. Nothing here is a parallel UI path: the only thing replaced is what is on the far end of the socket.
//
// Trigger phrases match the ones the app's mock has always used, so an existing flow keeps working:
//   "restart the web container"  → one gated container mutation
//   "restart web and cache"      → TWO gated mutations in one turn
//   "remove/delete … container"  → a destructive gated mutation
//   "simulate an error"          → a failed turn
//   anything about containers/images/networks/volumes → the matching ungated read

import type { HostResponsePayload, PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import type {
  AppThemePalette,
  BridgeEvent,
  ContributedResources,
  EngineOpResult,
  PluginListPayload,
  PluginScope,
} from "@/pi-bridge/protocol";
import mockAssistantResponse from "@/resources/prompts/mock-assistant-response.md?raw";
import mockToolResultResponse from "@/resources/prompts/mock-tool-result-response.md?raw";
import { randomUUID } from "@/utils/randomUUID";

// Slow enough that a streamed answer is visibly streamed, fast enough that a spec is not waiting on theatre.
const TOKEN_DELAY_MS = 12;

const FORCE_ERROR_RE = /simulate (?:a )?(?:model )?error|force error|fail now/;

interface ScriptedCall {
  op: string;
  args: Record<string, unknown>;
}

// What the model "decides" to do with a prompt. Container operations are named by the app's own tool names,
// exactly as the real container toolset registers them.
function scriptFor(text: string): { calls: ScriptedCall[]; reply: string } {
  const prompt = text.toLowerCase();
  if (/restart\b.*\b(?:and|both|all)\b/.test(prompt)) {
    return {
      calls: [
        { op: "restartContainer", args: { id: "web" } },
        { op: "restartContainer", args: { id: "cache" } },
      ],
      reply: mockToolResultResponse.trim(),
    };
  }
  if (/(?:remove|delete)\b.*container/.test(prompt)) {
    return { calls: [{ op: "removeContainer", args: { id: "web" } }], reply: mockToolResultResponse.trim() };
  }
  if (/restart|stop .*container/.test(prompt)) {
    return { calls: [{ op: "restartContainer", args: { id: "web" } }], reply: mockToolResultResponse.trim() };
  }
  if (/\bimage/.test(prompt)) return { calls: [{ op: "listImages", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bnetwork/.test(prompt))
    return { calls: [{ op: "listNetworks", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bvolume/.test(prompt))
    return { calls: [{ op: "listVolumes", args: {} }], reply: mockToolResultResponse.trim() };
  if (/\bcontainer|\brunning|\bstopped|\blog/.test(prompt)) {
    return { calls: [{ op: "listContainers", args: {} }], reply: mockToolResultResponse.trim() };
  }
  return { calls: [], reply: mockAssistantResponse.trim() };
}

const MOCK_PLUGINS: PluginListPayload = {
  configured: [
    {
      source: "pi-plugin-hello",
      scope: "user",
      filtered: false,
      installedPath: "/home/agent/.pi/agent/packages/hello",
    },
    { source: "github:example/pi-review", scope: "user", filtered: false, autoload: false },
  ],
};

const MOCK_RESOURCES: ContributedResources = {
  extensions: [{ path: "packages/hello/extension.ts", source: "pi-plugin-hello" }],
  commands: [{ name: "hello", description: "Say hello from a plugin", source: "pi-plugin-hello" }],
  skills: [],
  prompts: [],
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMockPiBridgeClient(): PiBridgeClient {
  const listeners = new Set<(event: BridgeEvent) => void>();
  // A host request the store has not answered yet. The real session parks the tool on it, so the mock must
  // too — otherwise an approval card would never be able to hold anything back.
  const pending = new Map<string, (result: EngineOpResult) => void>();
  let aborted = false;

  const emit = (event: BridgeEvent) => {
    for (const listener of listeners) listener(event);
  };

  // Ask the app to perform one container operation, exactly as the container toolset does. The answer is what
  // the approval card decides, so a rejection reaches the script as a failed result.
  const requestEngineOp = (call: ScriptedCall): Promise<EngineOpResult> => {
    const requestId = randomUUID();
    return new Promise<EngineOpResult>((resolve) => {
      pending.set(requestId, resolve);
      emit({ type: "host_request", requestId, method: "engine_op", payload: { op: call.op, args: call.args } });
    });
  };

  const streamText = async (text: string) => {
    for (const word of text.split(/(\s+)/)) {
      if (aborted) return;
      emit({ type: "assistant_delta", text: word });
      await sleep(TOKEN_DELAY_MS);
    }
    emit({ type: "assistant_end", text, stopReason: "end_turn" });
  };

  const runTurn = async (text: string) => {
    aborted = false;
    if (FORCE_ERROR_RE.test(text.toLowerCase())) {
      emit({ type: "error", message: "Mock agent failure (simulated)" });
      emit({ type: "turn_end" });
      emit({ type: "idle" });
      return;
    }
    const script = scriptFor(text);
    for (const call of script.calls) {
      if (aborted) break;
      const toolCallId = randomUUID();
      emit({ type: "tool_start", toolCallId, toolName: call.op, args: call.args });
      const result = await requestEngineOp(call);
      emit({
        type: "tool_end",
        toolCallId,
        toolName: call.op,
        isError: !result.ok,
        text: result.ok ? `${call.op} succeeded` : result.error,
        ...(result.ok ? { details: result.value } : {}),
      });
      // A refused operation stops the turn, the same way the real session aborts on a rejection.
      if (!result.ok) break;
    }
    if (!aborted) await streamText(script.reply);
    emit({ type: "turn_end" });
    emit({ type: "idle" });
  };

  return {
    async connect() {
      emit({
        type: "ready",
        protocolVersion: 1,
        sessionId: "mock-pi-session",
        cwd: "/workspace",
        model: "container-desktop-mock/mock-assistant",
      });
    },
    async prompt(text: string) {
      void runTurn(text);
    },
    async abort() {
      aborted = true;
      // Free anything parked on an unanswered request so the turn can finish instead of hanging.
      for (const [requestId, resolve] of pending) {
        pending.delete(requestId);
        resolve({ ok: false, error: "the agent was stopped" });
      }
      emit({ type: "turn_end" });
      emit({ type: "idle" });
    },
    async respond(requestId: string, response: HostResponsePayload) {
      const settle = pending.get(requestId);
      if (!settle) return;
      pending.delete(requestId);
      const value = (response as { value?: unknown }).value;
      const answered =
        typeof value === "object" && value !== null && "ok" in (value as EngineOpResult)
          ? (value as EngineOpResult)
          : { ok: true as const, value };
      settle(answered);
    },
    async surfaceInput() {},
    async surfaceResize() {},
    async setTheme(_palette: Partial<AppThemePalette>) {},
    async listPlugins() {
      return MOCK_PLUGINS;
    },
    async installPlugin(source: string, scope: PluginScope) {
      MOCK_PLUGINS.configured.push({ source, scope, filtered: false });
      emit({ type: "plugins_changed" });
    },
    async removePlugin(source: string) {
      MOCK_PLUGINS.configured = MOCK_PLUGINS.configured.filter((entry) => entry.source !== source);
      emit({ type: "plugins_changed" });
    },
    async updatePlugins() {
      emit({ type: "plugins_changed" });
    },
    async checkPluginUpdates() {
      return [];
    },
    async setPluginEnabled(source: string, enabled: boolean) {
      const entry = MOCK_PLUGINS.configured.find((candidate) => candidate.source === source);
      if (entry) entry.autoload = enabled ? undefined : false;
      emit({ type: "plugins_changed" });
    },
    async listResources() {
      return MOCK_RESOURCES;
    },
    async reloadSession() {
      emit({ type: "plugins_changed" });
    },
    async readToolOutput() {
      return { text: "the full output of the mock command\n", truncated: false };
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
      pending.clear();
    },
  };
}
