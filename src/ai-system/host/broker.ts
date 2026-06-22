// AIBroker — host-level orchestrator for AI requests. Dependency-injected
// (ipc/keyStore/settings/runner/tools/permissions) so it is unit-testable without Electron/AI-SDK.
// The concrete IPC & runtime implementations are wired by the Electron adapter.
//
// SECURITY: every handler enforces that only the main app window may reach it (the renderer is never
// trusted to gate this). Cloud access is gated by a stored API key (resolveAndGate). Provider keys are
// decrypted only in the runtime and never returned to the renderer. Egress classification (loopback vs
// off-device) and redaction live here. The assistant is ALWAYS agentic; what a gated tool call does is
// decided by the user's permission mode — never auto-approved by classification.

import {
  type AgentMessage,
  type AgentRunner,
  type AgentToolDeps,
  type AgentToolEvent,
  AI_CHANNELS,
  type AIAuthSettings,
  type AIKeyStore,
  type AIPermissionMode,
  type AISettings,
  type AIStatus,
  type BuildAgentTools,
  type ChatMessage,
  type ChatRequest,
  cachedVerdict,
  type DiagnosticsBundle,
  evaluateEgress,
  type GenerateRequest,
  type KnowledgeBankLike,
  type ListedModel,
  type PermissionsList,
  type PermissionsSnapshot,
  type PermissionsStoreLike,
  previewOutbound,
  type ResolveDecision,
  type ResolvedProvider,
  redactPayload,
  redactText,
  resolveProvider,
  type SandboxRunner,
  type ToolSet,
} from "@/ai-system/core";

// Renderer payloads are untrusted. A provider id must be a short, safe identifier so a malformed
// payload can never store a key under undefined/empty/"../" — and a key to store must be a
// non-empty string so encryption never receives garbage.
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function assertValidProvider(provider: unknown): asserts provider is string {
  if (typeof provider !== "string" || !PROVIDER_ID_RE.test(provider)) {
    throw new Error("AI: invalid provider id");
  }
}

// A command/web action the agent SURFACED for approval this stream — keyed by the broker-issued actionId
// the renderer echoes back. For a web action `args` holds the single query string.
interface PendingAction {
  kind: "command" | "web";
  program: string;
  args: string[];
}

// Per-stream state. A stream is one user turn and any human-resolved follow-up turns (resume): it
// outlives a single runner pass so an approval card can be resolved after the model stops, and holds the
// conversation so the resume turn can show the model the executed call's outcome.
interface StreamState {
  event: any;
  abort: AbortController;
  senderId: number | string;
  resolved: ResolvedProvider;
  secret?: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolSet;
  mode: AIPermissionMode;
  pending: Map<string, PendingAction>;
  assistantBuffer: string;
}

export interface AIBrokerDeps {
  keyStore: AIKeyStore;
  getAISettings: () => Promise<AISettings> | AISettings;
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  /** Push a stream event to the window that opened the stream. */
  send: (event: any, channel: string, payload: unknown) => void;
  /** Stable identity for a sender, so its streams can be reaped when its window closes. */
  senderId: (event: any) => number | string;
  /** Only the main app window may reach the AI subsystem. */
  isAllowedSender: (event: any) => boolean;
  /** Lists models from a provider's server; injected so it can be stubbed in tests. */
  listModels: (baseURL: string, opts?: { auth?: AIAuthSettings; secret?: string }) => Promise<ListedModel[]>;
  // Prompt builders — pure functions, injected so host never imports from runtimes.
  buildGeneratePrompt: (kind: "dockerfile" | "compose") => string;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  // Agentic runner + tools — all injected so the broker stays SDK-free and unit-testable.
  /** Drives the AI-SDK agent loop (streamText + tools + step cap); also used for one-shot generate (no tools). */
  agentRunner?: AgentRunner;
  /** Executes a command in the main sandbox (scrub + cap + redact; floor enforced unless enforceFloor:false). */
  runSandboxed?: SandboxRunner;
  /** Builds the AI-SDK tool set from tool deps (= createAgentTools); injected to avoid an SDK import here. */
  buildAgentTools?: BuildAgentTools;
  /** The user-managed allow/reject record (a versioned file in userData). Broker-owned writes. */
  permissionsStore?: PermissionsStoreLike;
  /** The seeded troubleshooting knowledge store. */
  knowledgeBank?: KnowledgeBankLike;
  /** Performs an SSRF-guarded web search; offered to the agent only when web search is enabled. */
  webSearcher?: (query: string) => Promise<{ text: string }>;
  logger?: { error: (...args: any[]) => void };
}

export class AIBroker {
  private chatCounter = 0;
  private readonly streams = new Map<string, StreamState>();

  constructor(private readonly deps: AIBrokerDeps) {}

  register(): void {
    const { onInvoke } = this.deps;
    onInvoke(AI_CHANNELS.status, (event) => this.guardSender(event, () => this.handleStatus()));
    onInvoke(AI_CHANNELS.keyHas, (event, payload) =>
      this.guardSender(event, () => {
        assertValidProvider(payload?.provider);
        return this.deps.keyStore.hasKey(payload.provider);
      }),
    );
    onInvoke(AI_CHANNELS.keySet, (event, payload) => this.guardSender(event, () => this.handleKeySet(payload)));
    onInvoke(AI_CHANNELS.keyClear, (event, payload) =>
      this.guardSender(event, async () => {
        assertValidProvider(payload?.provider);
        await this.deps.keyStore.clearKey(payload.provider);
        return { ok: true };
      }),
    );
    onInvoke(AI_CHANNELS.preview, (event, payload) => this.guardSender(event, () => previewOutbound(payload?.payload)));
    onInvoke(AI_CHANNELS.egressCheck, (event, payload) => this.guardSender(event, () => this.handleEgress(payload)));
    onInvoke(AI_CHANNELS.chat, (event, payload) => this.guardSender(event, () => this.handleChat(event, payload)));
    onInvoke(AI_CHANNELS.generate, (event, payload) =>
      this.guardSender(event, () => this.handleGenerate(event, payload)),
    );
    onInvoke(AI_CHANNELS.modelsList, (event, payload) => this.guardSender(event, () => this.handleModelsList(payload)));
    onInvoke(AI_CHANNELS.permissionsList, (event) => this.guardSender(event, () => this.handlePermissionsList()));
    onInvoke(AI_CHANNELS.permissionsRemove, (event, payload) =>
      this.guardSender(event, () => this.handlePermissionsRemove(payload)),
    );
    onInvoke(AI_CHANNELS.permissionsSetWeb, (event, payload) =>
      this.guardSender(event, () => this.handlePermissionsSetWeb(payload)),
    );
    this.deps.onMessage(AI_CHANNELS.chatCancel, (event, payload) => {
      if (!this.deps.isAllowedSender(event)) {
        return;
      }
      this.cancelStream(payload?.streamId);
    });
    this.deps.onMessage(AI_CHANNELS.agentResolve, (event, payload) => {
      if (!this.deps.isAllowedSender(event)) {
        return;
      }
      return this.handleResolve(event, payload);
    });
  }

  private async guardSender<T>(event: any, fn: () => T | Promise<T>): Promise<T> {
    if (!this.deps.isAllowedSender(event)) {
      throw new Error("AI: unauthorized sender");
    }
    return fn();
  }

  private async handleStatus(): Promise<AIStatus> {
    return { encryption: this.deps.keyStore.getEncryptionStatus() };
  }

  private async handleKeySet(payload: any): Promise<{ ok: true }> {
    assertValidProvider(payload?.provider);
    if (typeof payload?.key !== "string" || payload.key.trim().length === 0) {
      throw new Error("AI: a non-empty API key is required");
    }
    await this.deps.keyStore.setKey(payload.provider, payload.key, { allowDegraded: !!payload?.allowDegraded });
    return { ok: true };
  }

  private async handleEgress(payload: any) {
    const settings = await this.deps.getAISettings();
    const resolved = resolveProvider(settings, payload?.providerId);
    return evaluateEgress({ baseURL: resolved.baseURL });
  }

  disposeForSender(senderId: number | string): void {
    for (const [streamId, s] of this.streams) {
      if (s.senderId === senderId) {
        s.abort.abort();
        this.streams.delete(streamId);
      }
    }
  }

  private cancelStream(streamId?: string): void {
    if (!streamId) {
      return;
    }
    this.streams.get(streamId)?.abort.abort();
    this.streams.delete(streamId);
  }

  // Cloud consent is the saved API key: a key-requiring (cloud) provider with no stored key is refused
  // here — the sole gate now that allow-cloud/local-only are gone. Loopback locals need no key; a local
  // provider pointed at an off-device URL is admitted by that explicit configuration. Redaction still
  // scrubs every payload downstream.
  private async resolveAndGate(providerId?: string): Promise<{ resolved: ResolvedProvider; secret?: string }> {
    const settings = await this.deps.getAISettings();
    const resolved = resolveProvider(settings, providerId);
    const secret = resolved.requiresKey ? await this.deps.keyStore.getKey(resolved.id) : undefined;
    if (resolved.requiresKey && !secret) {
      throw new Error("AI: no credential stored for this provider");
    }
    return { resolved, secret };
  }

  // The one always-agentic conversation
  private async handleChat(event: any, payload: any): Promise<{ streamId: string }> {
    const { agentRunner, runSandboxed, buildAgentTools, knowledgeBank } = this.deps;
    if (!agentRunner || !runSandboxed || !buildAgentTools || !knowledgeBank) {
      throw new Error("AI: the assistant is not available");
    }
    const req = (payload ?? {}) as Partial<ChatRequest>;
    const rawMessages = Array.isArray(req.messages) ? (req.messages as ChatMessage[]) : [];
    if (rawMessages.length === 0) {
      throw new Error("AI: chat requires at least one message");
    }
    const settings = await this.deps.getAISettings();
    const { resolved, secret } = await this.resolveAndGate(req.providerId);
    if (typeof req.model === "string" && req.model.trim()) {
      resolved.model = req.model.trim();
    }

    // Permission mode + the remembered allow/reject cache govern every gated tool call this run. A cache
    // that cannot be read is FAIL-CLOSED: force "ask" for this run rather than honoring a stale/empty file.
    const snapshot = this.deps.permissionsStore ? await this.deps.permissionsStore.load() : undefined;
    let mode: AIPermissionMode = settings.permissionMode ?? "ask";
    if (snapshot?.status === "error") {
      mode = "ask";
      this.deps.logger?.error("AI: permissions cache unreadable — forcing 'ask' for this run");
    }

    const messages: AgentMessage[] = rawMessages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: redactText(m.content) }));
    const system = this.deps.buildAgentPrompt(req.bundle ? redactPayload(req.bundle) : undefined);

    this.chatCounter += 1;
    const streamId = `ai-${this.chatCounter}`;
    const abort = new AbortController();

    const webAllowed = !!settings.webSearch && !!this.deps.webSearcher;
    const toolDeps: AgentToolDeps = {
      runSandboxed,
      searchKnowledge: (q: string) => knowledgeBank.search(q),
      webSearch: webAllowed ? this.deps.webSearcher : undefined,
      onEvent: (e) => this.emitTool(streamId, e),
      mode,
      cacheLookup: snapshot ? (key) => cachedVerdict(snapshot, key) : undefined,
      webVerdict: snapshot?.webSearch,
    };

    this.streams.set(streamId, {
      event,
      abort,
      senderId: this.deps.senderId(event),
      resolved,
      secret,
      system,
      messages,
      tools: buildAgentTools(toolDeps),
      mode,
      pending: new Map(),
      assistantBuffer: "",
    });
    this.startTurn(streamId);
    return { streamId };
  }

  private async handleGenerate(event: any, payload: any): Promise<{ streamId: string }> {
    const { agentRunner } = this.deps;
    if (!agentRunner) {
      throw new Error("AI: the assistant is not available");
    }
    const req = (payload ?? {}) as Partial<GenerateRequest>;
    const kind = req.kind === "compose" ? "compose" : "dockerfile";
    const { resolved, secret } = await this.resolveAndGate(req.providerId);
    const userContent = `${req.instruction?.trim() || "Generate a suitable file."}\n\nCurrent content:\n${req.template || "(empty)"}`;

    this.chatCounter += 1;
    const streamId = `ai-${this.chatCounter}`;
    // One-shot generation: no tools, no approvals, no resume — just a streamed text turn.
    this.streams.set(streamId, {
      event,
      abort: new AbortController(),
      senderId: this.deps.senderId(event),
      resolved,
      secret,
      system: this.deps.buildGeneratePrompt(kind),
      messages: [{ role: "user", content: redactText(userContent) }],
      tools: {},
      mode: "ask",
      pending: new Map(),
      assistantBuffer: "",
    });
    this.startTurn(streamId);
    return { streamId };
  }

  private async handleModelsList(payload: any): Promise<{ models: ListedModel[] }> {
    const { resolved, secret } = await this.resolveAndGate(payload?.providerId);
    return { models: await this.deps.listModels(resolved.baseURL, { auth: resolved.auth, secret }) };
  }

  // Permission cache management (broker-owned writes)
  private async handlePermissionsList(): Promise<PermissionsSnapshot> {
    if (!this.deps.permissionsStore) {
      throw new Error("AI: the permission store is not available");
    }
    return this.deps.permissionsStore.load();
  }

  private async handlePermissionsRemove(payload: any): Promise<PermissionsSnapshot> {
    if (!this.deps.permissionsStore) {
      throw new Error("AI: the permission store is not available");
    }
    const list: PermissionsList = payload?.list === "blocked" ? "blocked" : "allowed";
    const key = String(payload?.key ?? "");
    return this.deps.permissionsStore.removeCommand(list, key);
  }

  private async handlePermissionsSetWeb(payload: any): Promise<PermissionsSnapshot> {
    if (!this.deps.permissionsStore) {
      throw new Error("AI: the permission store is not available");
    }
    const verdict = payload?.verdict === "allow" ? "allow" : payload?.verdict === "block" ? "block" : undefined;
    return this.deps.permissionsStore.setWebSearch(verdict);
  }

  // Streaming a single runner turn (initial + each human-resolved resume)
  private startTurn(streamId: string): void {
    const state = this.streams.get(streamId);
    if (!state || !this.deps.agentRunner) {
      return;
    }
    state.assistantBuffer = "";
    const push = (type: "delta" | "tool" | "done" | "error", value: unknown) =>
      this.deps.send(state.event, AI_CHANNELS.streamEvent, { streamId, type, payload: value });

    this.deps.agentRunner({
      resolved: state.resolved,
      secret: state.secret,
      system: state.system,
      messages: state.messages,
      tools: state.tools,
      signal: state.abort.signal,
      // Mock runners inject tool-timeline events directly; real runners' tools emit via toolDeps.onEvent.
      onToolEvent: (e) => this.emitTool(streamId, e),
      onDelta: (text) => {
        state.assistantBuffer += text;
        push("delta", { text });
      },
      onDone: (finishReason) => {
        if (state.assistantBuffer) {
          state.messages.push({ role: "assistant", content: state.assistantBuffer });
        }
        push("done", { finishReason });
        // Keep the stream alive while approvals are pending (the card outlives the turn); else reap it.
        if (this.streams.get(streamId)?.pending.size === 0) {
          this.streams.delete(streamId);
        }
      },
      onError: (message) => {
        push("error", { message: redactText(String(message)) });
        this.streams.delete(streamId);
      },
    });
  }

  // Forward a tool-timeline event to the renderer AND, for an approval-request, remember the exact action
  // (keyed by its broker-side actionId) so handleResolve can only run something the agent actually surfaced.
  private emitTool(streamId: string, e: AgentToolEvent): void {
    const state = this.streams.get(streamId);
    if (!state) {
      return;
    }
    if (e.type === "approval-request") {
      state.pending.set(e.actionId, { kind: e.kind, program: e.program, args: e.args.map(String) });
    }
    this.deps.send(state.event, AI_CHANNELS.streamEvent, { streamId, type: "tool", payload: { event: e } });
  }

  // Resolve a surfaced approval: run/persist per mode, then resume the turn so the model sees the outcome.
  // EXPLICIT — a reject NEVER runs. One-shot + sender-checked: a compromised/buggy renderer cannot run an
  // action the user never saw, nor replay one.
  private async handleResolve(event: any, payload: any): Promise<void> {
    const streamId = typeof payload?.streamId === "string" ? payload.streamId : undefined;
    const actionId = typeof payload?.actionId === "string" ? payload.actionId : undefined;
    const decision: ResolveDecision | undefined =
      payload?.decision === "allow" ? "allow" : payload?.decision === "reject" ? "reject" : undefined;
    if (!streamId || !actionId || !decision) {
      return;
    }
    const state = this.streams.get(streamId);
    if (!state || state.senderId !== this.deps.senderId(event)) {
      return; // unknown stream or a different sender — refuse
    }
    const action = state.pending.get(actionId);
    if (!action) {
      return; // unknown or already-resolved (one-shot)
    }
    state.pending.delete(actionId);

    const label =
      action.kind === "web" ? `web search "${action.args[0] ?? ""}"` : `${action.program} ${action.args.join(" ")}`;

    try {
      if (decision === "reject") {
        if (state.mode === "remember") {
          await this.persistVerdict(action, "block");
        }
        // The approval card itself shows the declined state in the UI — no extra timeline event needed; the
        // model is told via the resume note so it stops waiting and continues.
        state.messages.push({ role: "user", content: `I declined to run ${label}. Continue without it.` });
        this.startTurn(streamId);
        return;
      }

      // allow
      if (state.mode === "remember") {
        await this.persistVerdict(action, "allow");
      }
      if (action.kind === "web") {
        const text = this.deps.webSearcher ? (await this.deps.webSearcher(action.args[0] ?? "")).text : "";
        state.messages.push({ role: "user", content: `Results of ${label}:\n${redactText(text)}` });
      } else if (this.deps.runSandboxed) {
        const res = await this.deps.runSandboxed(
          { program: action.program, args: action.args },
          { enforceFloor: state.mode !== "allow" },
        );
        this.emitTool(streamId, {
          type: "command-result",
          program: action.program,
          args: action.args,
          ok: res.ok,
          stdout: res.stdout,
          stderr: res.stderr,
        });
        state.messages.push({
          role: "user",
          content: `I approved and ran \`${label}\`.\nstdout:\n${res.stdout || "(empty)"}\nstderr:\n${res.stderr || "(empty)"}`,
        });
      }
      this.startTurn(streamId);
    } catch (error: any) {
      this.deps.send(state.event, AI_CHANNELS.streamEvent, {
        streamId,
        type: "error",
        payload: { message: redactText(String(error?.message ?? error)) },
      });
    }
  }

  private async persistVerdict(action: PendingAction, verdict: "allow" | "block"): Promise<void> {
    if (!this.deps.permissionsStore) {
      return;
    }
    if (action.kind === "web") {
      await this.deps.permissionsStore.setWebSearch(verdict);
    } else {
      await this.deps.permissionsStore.addCommand(verdict === "allow" ? "allowed" : "blocked", {
        program: action.program,
        args: action.args,
      });
    }
  }
}
