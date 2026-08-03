import {
  type AgentRunResult,
  type LLMAdapter,
  type LLMChatOptions,
  type LLMMessage,
  type LLMResponse,
  OpenMultiAgent,
  type StreamEvent,
  type TraceSink,
} from "@open-multi-agent/core";
import type { EffectiveContextSource } from "@/ai-system/core/context";
import type { CostRegistry } from "@/ai-system/core/cost";
import { describeError } from "@/ai-system/core/errors";
import { MAX_RUN_SPAN_BYTES, MAX_RUN_SPANS } from "@/ai-system/core/limits";
import type { RunSpanView } from "@/ai-system/core/runEvents";
import { spanToRunEvents, type TraceRecordLike } from "@/ai-system/core/spanEvents";
import {
  type AssistantMessageStatus,
  MAX_PENDING_INPUTS,
  type ThreadEvent,
  type ThreadEventEnvelope,
  type ThreadView,
} from "@/ai-system/core/threadEvents";
import { reduceThreadEvent, viewFromMessages } from "@/ai-system/core/threadReducer";
import type {
  AgentSessionCreationOptions,
  AgentSessionInputMessage,
  AgentSessionPort,
  AgentSessionTaskSettings,
  ApprovalDecision,
  CreateAgentSession,
} from "@/ai-system/core/types";
import {
  summarizeWorkspaceChanges,
  type WorkspaceChangeSnapshot,
  type WorkspaceChangesPort,
} from "@/ai-system/core/workspaceChanges";
import { defaultCostRegistry } from "@/ai-system/runtime/cost/defaultCostRegistry";
import { buildEffectiveContextSnapshot } from "@/ai-system/runtime/effectiveContext";
import { OmaAgentSessionToolController } from "@/ai-system/runtime/omaAgentSessionTools";
import { responseText, seedModelHistory, tokenCount } from "@/ai-system/runtime/omaSessionMessages";
import { buildCustomTools } from "@/ai-system/runtime/omaTools";
import { buildThreadCompactionContext } from "@/ai-system/runtime/threadCompactionContext";
import { buildToolGuidance } from "@/ai-system/runtime/toolGuidance";
import { randomUUID } from "@/utils/randomUUID";

export interface OmaAgentSessionAdapterObserver {
  onToken(delta: string, messages: readonly LLMMessage[]): void;
}

export type OmaAgentSessionAdapterFactory = (
  task: AgentSessionTaskSettings,
  observer: OmaAgentSessionAdapterObserver,
) => LLMAdapter;

const MAX_TURNS = 8;
const textEncoder = new TextEncoder();

interface ActiveAssistant {
  id: string;
  text: string;
  started: boolean;
}

interface WorkspaceChangeCapture {
  port: WorkspaceChangesPort;
  before: Promise<WorkspaceChangeSnapshot | undefined>;
}

class OmaAgentSession implements AgentSessionPort {
  private view: ThreadView;
  private seq: number;
  private task: AgentSessionTaskSettings;
  private readonly modelHistory: LLMMessage[];
  private readonly tools: OmaAgentSessionToolController;
  private readonly pending: AgentSessionInputMessage[] = [];
  private readonly traceRecords: RunSpanView[] = [];
  private retainedSkillSources: EffectiveContextSource[];
  private traceBytes = 0;
  private taskAbort: AbortController | null = null;
  private modelAbort: AbortController | null = null;
  private activeTaskId: string | null = null;
  private activeAssistant: ActiveAssistant | null = null;

  constructor(
    private readonly options: AgentSessionCreationOptions,
    private readonly makeAdapter: OmaAgentSessionAdapterFactory,
    private readonly costRegistry: CostRegistry,
  ) {
    this.view = options.view ? structuredClone(options.view) : viewFromMessages(options.threadId, options.history);
    this.seq = this.view.lastSeq;
    this.task = options.taskSettings;
    this.modelHistory = seedModelHistory(options);
    this.tools = new OmaAgentSessionToolController(this.task, {
      threadId: options.threadId,
      permissionsStore: options.permissionsStore,
      storeToolArtifact: options.storeToolArtifact,
      logger: options.logger,
      emit: (event) => this.emit(event),
      abortTask: () => this.taskAbort?.abort(),
    });
    this.retainedSkillSources = options.view?.context?.sources.filter(({ kind }) => kind === "skill") ?? [];
  }

  private captureSkillSources(): void {
    const sources = [
      ...this.retainedSkillSources,
      ...(this.task.contextSources ?? []).filter(({ kind }) => kind === "skill"),
    ];
    const totals = new Map<string, EffectiveContextSource>();
    for (const source of sources) {
      const key = `${source.kind}:${source.trust}`;
      const previous = totals.get(key);
      totals.set(key, previous ? { ...source, characters: previous.characters + source.characters } : { ...source });
    }
    this.retainedSkillSources = [...totals.values()];
  }

  private emit(event: ThreadEvent, taskId = this.activeTaskId ?? undefined): void {
    this.seq += 1;
    const envelope: ThreadEventEnvelope = {
      version: 1,
      threadId: this.options.threadId,
      seq: this.seq,
      event,
      ...(taskId ? { taskId } : {}),
    };
    this.view = reduceThreadEvent(this.view, envelope).view;
    this.options.emit(envelope);
  }

  private startAssistant(): ActiveAssistant {
    const active = this.activeAssistant ?? { id: randomUUID(), text: "", started: false };
    if (!active.started) {
      this.emit({ type: "assistant-start", id: active.id });
      active.started = true;
    }
    this.activeAssistant = active;
    return active;
  }

  private onToken(delta: string): void {
    if (!delta) return;
    const active = this.startAssistant();
    active.text += delta;
    this.emit({ type: "assistant-delta", id: active.id, text: delta });
  }

  private finishAssistant(fullText: string, status: Exclude<AssistantMessageStatus, "streaming">): string {
    if (fullText && !this.activeAssistant) this.onToken(fullText);
    else if (this.activeAssistant && fullText.startsWith(this.activeAssistant.text)) {
      this.onToken(fullText.slice(this.activeAssistant.text.length));
    }
    const active = this.activeAssistant;
    this.activeAssistant = null;
    if (!active?.started) return fullText;
    this.emit({ type: "assistant-end", id: active.id, status });
    return active.text;
  }

  private partialAssistantText(): string {
    return this.activeAssistant?.text ?? "";
  }

  private applyPendingToToolResult(messages: LLMMessage[]): void {
    if (this.pending.length === 0) return;
    const last = messages.at(-1);
    if (last?.role !== "user" || !last.content.some((block) => block.type === "tool_result")) return;
    for (const message of this.pending.splice(0)) {
      last.content.push({ type: "text", text: message.content });
      this.emit({ type: "user-message-applied", id: message.id });
    }
  }

  private interruptedResponse(text: string): LLMResponse {
    return {
      id: randomUUID(),
      content: text ? [{ type: "text", text }] : [],
      model: this.task.resolved.model ?? "unknown",
      stop_reason: "interrupted",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  private async chat(messages: LLMMessage[], chatOptions: LLMChatOptions): Promise<LLMResponse> {
    this.applyPendingToToolResult(messages);
    if (this.view.phase !== "model") this.emit({ type: "phase-changed", phase: "model" });
    const taskAbort = this.taskAbort;
    if (!taskAbort || taskAbort.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const segment = new AbortController();
    this.modelAbort = segment;
    this.activeAssistant = null;
    const signal = AbortSignal.any([taskAbort.signal, segment.signal]);
    const adapter = this.makeAdapter(this.task, { onToken: (delta) => this.onToken(delta) });
    const compaction = this.options.activeCompaction;
    const historyStart = Math.min(compaction?.source.historyEnd ?? 0, this.modelHistory.length);
    const history = this.modelHistory.slice(historyStart);
    const historySummary = compaction ? buildThreadCompactionContext(compaction) : undefined;
    const requestMessages = [...history, ...messages];
    const systemPrompt = [this.task.system, historySummary, buildToolGuidance(this.tools.toolset)]
      .filter(Boolean)
      .join("\n\n");
    this.emit({
      type: "context",
      context: buildEffectiveContextSnapshot({
        providerId: this.task.resolved.id,
        model: this.task.resolved.model,
        systemPrompt,
        history,
        historySummary,
        omittedMessages: historyStart,
        turn: messages,
        tools: chatOptions.tools,
        toolset: this.tools.toolset,
        permissionMode: this.task.permissionMode,
        sources: [
          ...(this.task.contextSources ?? []).filter(({ kind }) => kind !== "skill"),
          ...this.retainedSkillSources,
        ],
      }),
    });
    try {
      const response = await adapter.chat(requestMessages, {
        ...chatOptions,
        model: this.task.resolved.model ?? chatOptions.model,
        systemPrompt,
        abortSignal: signal,
        ...(this.task.thinking ? { thinking: this.task.thinking } : {}),
      });
      this.tools.captureToolCalls(response);
      this.finishAssistant(responseText(response), "complete");
      const usage = {
        inputTokens: tokenCount(response.usage.input_tokens),
        outputTokens: tokenCount(response.usage.output_tokens),
      };
      const cost = this.costRegistry.estimate(this.task.resolved.id, usage, {
        model: response.model || this.task.resolved.model,
      });
      this.emit({ type: "usage", ...usage, ...(cost ? { cost } : {}) });
      return response;
    } catch (error) {
      if (segment.signal.aborted && !taskAbort.signal.aborted) {
        const partial = this.finishAssistant(this.partialAssistantText(), "interrupted");
        return this.interruptedResponse(partial);
      }
      this.finishAssistant(this.partialAssistantText(), taskAbort.signal.aborted ? "stopped" : "error");
      throw error;
    } finally {
      if (this.modelAbort === segment) this.modelAbort = null;
    }
  }

  private adapter(): LLMAdapter {
    return {
      name: "container-desktop-agent-session",
      chat: (messages, options) => this.chat(messages, options),
      stream: async function* (): AsyncIterable<StreamEvent> {
        yield { type: "error", data: new Error("OMA Agent Session uses the Agent runner's request path") };
      },
    };
  }

  private captureTrace(record: TraceRecordLike): void {
    const update = spanToRunEvents(record).find(
      (event): event is Extract<typeof event, { type: "span-open" | "span-close" }> =>
        event.type === "span-open" || event.type === "span-close",
    );
    if (!update) return;
    const index = this.traceRecords.findIndex((span) => span.key === update.span.key);
    const current = index >= 0 ? this.traceRecords[index] : undefined;
    const next = current ? { ...current, ...update.span } : update.span;
    const nextBytes =
      this.traceBytes -
      (current ? textEncoder.encode(JSON.stringify(current)).byteLength : 0) +
      textEncoder.encode(JSON.stringify(next)).byteLength;
    if ((index < 0 && this.traceRecords.length >= MAX_RUN_SPANS) || nextBytes > MAX_RUN_SPAN_BYTES) return;
    if (index < 0) this.traceRecords.push(next);
    else this.traceRecords[index] = next;
    this.traceBytes = nextBytes;
  }

  private orchestrator(): OpenMultiAgent {
    let accepted = 0;
    const flushResult = () => ({ status: "ok" as const, accepted, exported: accepted, dropped: 0, failed: 0 });
    const traceSink: TraceSink = {
      emit: (record) => {
        accepted += 1;
        this.captureTrace(record);
      },
      forceFlush: async () => flushResult(),
      shutdown: async () => flushResult(),
    };
    return new OpenMultiAgent({ defaultCwd: null, observability: { sinks: [traceSink] } });
  }

  private async runSegment(prompt: string, signal: AbortSignal): Promise<AgentRunResult> {
    const customTools = this.tools.toolset
      ? buildCustomTools(this.tools.toolset, (name, result) => this.tools.onToolResult(name, result))
      : undefined;
    return this.orchestrator().runAgent(
      {
        name: `agent-session-${this.options.threadId}`,
        model: this.task.resolved.model ?? "unknown",
        adapter: this.adapter(),
        systemPrompt: this.task.system,
        customTools,
        onToolCall: (context) => this.tools.queueToolGate(context),
        parallelToolCalls: false,
        maxTurns: MAX_TURNS,
        cwd: null,
      },
      prompt,
      { abortSignal: signal, runId: this.activeTaskId ?? undefined },
    );
  }

  private drainPendingPrompt(): string | null {
    if (this.pending.length === 0) return null;
    const messages = this.pending.splice(0);
    for (const message of messages) this.emit({ type: "user-message-applied", id: message.id });
    return messages.map((message) => message.content).join("\n\n");
  }

  private async captureWorkspaceStatus(port: WorkspaceChangesPort): Promise<WorkspaceChangeSnapshot | undefined> {
    try {
      return await port.status();
    } catch (error) {
      this.options.logger?.error("AI workspace change capture failed", error);
      return undefined;
    }
  }

  private async emitTaskTerminal(
    event: Extract<ThreadEvent, { type: "task-complete" | "task-stopped" | "error" }>,
    capture: WorkspaceChangeCapture | undefined,
    before: WorkspaceChangeSnapshot | undefined,
  ): Promise<void> {
    if (capture && before) {
      const after = await this.captureWorkspaceStatus(capture.port);
      if (after) {
        const summary = summarizeWorkspaceChanges(before, after);
        if (summary) this.emit({ type: "workspace-changes", summary });
      }
    }
    this.emit(event);
  }

  private async runTask(initialPrompt: string, signal: AbortSignal, capture?: WorkspaceChangeCapture): Promise<void> {
    const before = await capture?.before;
    let prompt: string | null = initialPrompt;
    let terminal: Extract<ThreadEvent, { type: "task-complete" | "task-stopped" | "error" }> = {
      type: "task-complete",
      finishReason: "stop",
    };
    try {
      while (prompt !== null) {
        const result = await this.runSegment(prompt, signal);
        if (this.tools.fatalError) {
          terminal = this.tools.fatalError;
          break;
        }
        this.modelHistory.push({ role: "user", content: [{ type: "text", text: prompt }] }, ...result.messages);
        if (signal.aborted) {
          terminal = { type: "task-stopped" };
          break;
        }
        if (!result.success) {
          const withError = result as AgentRunResult & { error?: unknown };
          terminal = {
            type: "error",
            scope: "model",
            message: describeError(withError.error ?? result.errorInfo ?? result.output),
          };
          break;
        }
        prompt = this.drainPendingPrompt();
      }
    } catch (error) {
      terminal =
        this.tools.fatalError ??
        (signal.aborted ? { type: "task-stopped" } : { type: "error", scope: "model", message: describeError(error) });
    }
    await this.emitTaskTerminal(terminal, capture, before);
  }

  private startTask(message: AgentSessionInputMessage): string {
    const taskId = randomUUID();
    const controller = new AbortController();
    this.captureSkillSources();
    this.tools.reset(
      this.task,
      !!this.task.initialTaint ||
        !!this.options.activeCompaction?.tainted ||
        this.retainedSkillSources.some(({ trust }) => trust === "project"),
    );
    this.activeTaskId = taskId;
    this.taskAbort = controller;
    this.emit({ type: "phase-changed", phase: "model" }, taskId);
    this.emit(
      {
        type: "user-message",
        id: message.id,
        content: message.displayContent ?? message.content,
        delivery: "applied",
        ...(message.skill ? { skill: message.skill } : {}),
      },
      taskId,
    );
    const changes = this.task.execution.workspaceChanges;
    const capture = changes ? { port: changes, before: this.captureWorkspaceStatus(changes) } : undefined;
    void this.runTask(message.content, controller.signal, capture)
      .catch((error) => this.options.logger?.error("OMA Agent Session turn failed", error))
      .finally(() => {
        if (this.taskAbort === controller) this.taskAbort = null;
        if (this.activeTaskId === taskId) this.activeTaskId = null;
      });
    return taskId;
  }

  async submit(message: AgentSessionInputMessage, taskSettings?: AgentSessionTaskSettings) {
    if (taskSettings) this.task = taskSettings;
    if (!this.activeTaskId) {
      const taskId = this.startTask(message);
      return {
        accepted: true as const,
        threadId: this.options.threadId,
        taskId,
        mode: "started" as const,
        phase: "model" as const,
      };
    }
    if (this.pending.length >= MAX_PENDING_INPUTS) {
      this.emit({
        type: "user-message",
        id: message.id,
        content: message.displayContent ?? message.content,
        delivery: "discarded",
        ...(message.skill ? { skill: message.skill } : {}),
      });
      return {
        accepted: true as const,
        threadId: this.options.threadId,
        taskId: this.activeTaskId,
        mode: "duplicate" as const,
        phase: this.view.phase,
      };
    }
    const modelAbort = this.modelAbort;
    this.pending.push(message);
    this.emit({
      type: "user-message",
      id: message.id,
      content: message.displayContent ?? message.content,
      delivery: "queued",
      ...(message.skill ? { skill: message.skill } : {}),
    });
    if (modelAbort) {
      this.emit({ type: "phase-changed", phase: "interrupting" });
      modelAbort.abort();
    }
    return {
      accepted: true as const,
      threadId: this.options.threadId,
      taskId: this.activeTaskId,
      mode: modelAbort ? ("interrupting" as const) : ("queued" as const),
      phase: this.view.phase,
    };
  }

  async resolveApproval(approvalId: string, decision: ApprovalDecision) {
    if (!this.tools.resolveApproval(approvalId, decision)) {
      return { accepted: false, phase: this.view.phase };
    }
    return { accepted: true, phase: this.view.phase };
  }

  async cancel(): Promise<void> {
    this.taskAbort?.abort();
    this.modelAbort?.abort();
    this.tools.rejectApprovals();
  }

  snapshot(): ThreadView {
    return this.view;
  }

  durableSnapshot() {
    return { view: this.view, modelHistory: this.modelHistory, traceRecords: this.traceRecords };
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}

export function makeCreateOmaAgentSession(
  makeAdapter: OmaAgentSessionAdapterFactory,
  costRegistry: CostRegistry = defaultCostRegistry,
): CreateAgentSession {
  return (options) => new OmaAgentSession(options, makeAdapter, costRegistry);
}
