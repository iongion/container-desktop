import type { ContentBlock, LLMAdapter, LLMMessage, ToolUseBlock } from "@open-multi-agent/core";
import {
  type ChatEvent,
  type ChatEventEnvelope,
  type ChatSessionView,
  MAX_PENDING_INPUTS,
  type SubmitChatRequest,
} from "@/ai-system/core/chatEvents";
import { reduceChatEvent, viewFromMessages } from "@/ai-system/core/chatReducer";
import { toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";
import { cachedVerdict, resolveToolAction, toolKey, toolRule } from "@/ai-system/core/permissions";
import type {
  AgentSessionCreationOptions,
  AgentSessionPort,
  AgentSessionTaskSettings,
  CreateAgentSession,
} from "@/ai-system/core/types";
import { buildContainerToolset } from "@/ai-system/runtime/tools/containerToolset";
import { mergeToolsets, type Toolset } from "@/ai-system/runtime/tools/toolset";
import { buildWorkspaceToolset } from "@/ai-system/runtime/tools/workspaceToolset";
import { randomUUID } from "@/utils/randomUUID";

// Resolves the open-multi-agent model adapter for a turn. Real sessions build it from the provider/keychain stack
// (createOmaAdapter); the mock session returns a scripted adapter. Passed per-turn so a mid-conversation model switch
// (carried on AgentSessionTaskSettings) takes effect on the next submit.
export type OmaAdapterFactory = (task: AgentSessionTaskSettings) => LLMAdapter;

const MAX_TURN_TEXT = 32_000;
const MAX_STEPS = 8;

type ApprovalDecision = "allow" | "reject";

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toolResultBlock(toolUseId: string, content: string, isError: boolean): ContentBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError };
}

// Content-block discriminators this engine understands. The retired AI-SDK engine persisted HYPHENATED parts
// ("tool-call" / "tool-result"); these are underscored, so the two shapes are distinguishable by block type
// alone — which is what makes the all-or-nothing check below able to spot a foreign transcript.
const LLM_BLOCK_TYPES = new Set(["text", "reasoning", "image", "tool_use", "tool_result"]);

// CONVERSATION MIGRATION (clean break — AI is experimental). A conversation persisted by the previous engine
// holds model messages this engine cannot speak: partially-compatible ones would survive a naive per-element
// filter and then break tool-call/result pairing, which providers reject outright. So the rule is ALL-OR-NOTHING:
// if any entry fails to validate, the whole `modelHistory` is DISCARDED and the turn is re-seeded from the
// human-readable `view` transcript, which is always kept. The user loses the model's hidden scratch state, never
// the conversation they can see.
function seedModelHistory(options: AgentSessionCreationOptions): LLMMessage[] {
  const persisted = options.modelHistory;
  if (Array.isArray(persisted) && persisted.length > 0 && persisted.every(isLlmMessage)) {
    return persisted as LLMMessage[];
  }
  const seeded: LLMMessage[] = [];
  for (const message of options.history) {
    if (message.role === "user" || message.role === "assistant") {
      seeded.push({ role: message.role, content: [{ type: "text", text: message.content }] });
    }
  }
  return seeded;
}

function isLlmMessage(value: unknown): value is LLMMessage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { role?: unknown; content?: unknown };
  if (record.role !== "user" && record.role !== "assistant") return false;
  if (!Array.isArray(record.content)) return false;
  return record.content.every((block) => {
    if (!block || typeof block !== "object") return false;
    return LLM_BLOCK_TYPES.has((block as { type?: unknown }).type as string);
  });
}

// Builds the owned interactive turn-loop satisfying AgentSessionPort by driving an OMA LLMAdapter and emitting the
// neutral ChatEventEnvelope protocol the renderer already folds (via reduceChatEvent). OMA's Agent runner streams at
// turn granularity with no multi-turn + cancellable + tool-approval API, so — like any agent harness — we own
// a multi-step loop over adapter.stream(): stream text, execute any tool calls (gated by the app's permission policy)
// through host ports, feed results back, and continue until the model answers with no further tool calls.
export function makeCreateAgentSession(makeAdapter: OmaAdapterFactory): CreateAgentSession {
  return (options: AgentSessionCreationOptions): AgentSessionPort => {
    let view: ChatSessionView = viewFromMessages(options.sessionId, options.history);
    let seq = view.lastSeq;
    const modelHistory: LLMMessage[] = seedModelHistory(options);
    let task: AgentSessionTaskSettings = options.taskSettings;
    let abort: AbortController | null = null;
    // Aborts only the in-flight model call, and is non-null exactly while one is in flight. Steering cuts a segment
    // short to redirect the RUNNING task, so it must not reuse the task-level controller above — that one is Stop,
    // and Stop is terminal.
    let segmentAbort: AbortController | null = null;
    let activeTaskId: string | null = null;
    const approvals = new Map<string, (decision: ApprovalDecision) => void>();
    // Messages typed while a turn was running, spliced into that same turn before its next model call.
    const pending: SubmitChatRequest["message"][] = [];

    // Single seq authority: bump, fold into the local view (so snapshot() matches the renderer's projection), emit.
    function emit(event: ChatEvent, taskId?: string): void {
      seq += 1;
      const envelope: ChatEventEnvelope = {
        version: 1,
        sessionId: options.sessionId,
        seq,
        event,
        ...(taskId ? { taskId } : {}),
      };
      view = reduceChatEvent(view, envelope).view;
      options.emit(envelope);
    }

    function rejectPendingApprovals(): void {
      for (const resolve of approvals.values()) resolve("reject");
      approvals.clear();
    }

    // Decide run/reject for a gated tool, prompting (and awaiting resolveApproval) when the policy says "ask".
    // `tainted` carries whether this turn already ingested untrusted content, so a remembered allow stops being
    // honored once the model may be echoing instructions it read from a file or a tool result.
    async function gate(
      name: string,
      args: unknown,
      toolCallId: string,
      taskId: string,
      tainted: boolean,
    ): Promise<ApprovalDecision> {
      const snapshot = task.permissions;
      const cached = snapshot ? cachedVerdict(snapshot, toolKey(name, args)) : undefined;
      const action = resolveToolAction({
        mode: task.permissionMode,
        floorBlocked: toolCommandFloorBlocked(args),
        cached,
        tainted,
      });
      if (action === "run") return "allow";
      if (action === "reject") return "reject";
      const approvalId = randomUUID();
      emit(
        {
          type: "approval-request",
          approvalId,
          toolCallId,
          tool: name,
          title: name,
          args: asRecord(args),
          reason: `Approve ${name}?`,
        },
        taskId,
      );
      const decision = await new Promise<ApprovalDecision>((resolve) => approvals.set(approvalId, resolve));
      approvals.delete(approvalId);
      emit({ type: "approval-resolved", approvalId, decision }, taskId);
      if (task.permissionMode === "remember" && options.permissionsStore) {
        await options.permissionsStore
          .addCommand(decision === "allow" ? "allowed" : "blocked", toolRule(name, args))
          .catch(() => undefined);
      }
      return decision;
    }

    async function executeToolUse(
      tu: ToolUseBlock,
      toolset: Toolset,
      taskId: string,
      tainted: boolean,
    ): Promise<ContentBlock> {
      const title = toolset.title(tu.name);
      if (!toolset.has(tu.name)) {
        emit({ type: "tool-error", toolCallId: tu.id, tool: tu.name, title, message: "Unknown tool" }, taskId);
        return toolResultBlock(tu.id, "Unknown tool", true);
      }
      const valid = toolset.validate(tu.name, tu.input);
      if (!valid.ok) {
        emit({ type: "tool-error", toolCallId: tu.id, tool: tu.name, title, message: valid.error }, taskId);
        return toolResultBlock(tu.id, valid.error, true);
      }
      if (toolset.gated(tu.name)) {
        const decision = await gate(tu.name, valid.value, tu.id, taskId, tainted);
        if (decision === "reject") {
          emit({ type: "tool-denied", toolCallId: tu.id, tool: tu.name, title, reason: "Rejected by user" }, taskId);
          return toolResultBlock(tu.id, "Tool call rejected by the user", true);
        }
      }
      emit({ type: "tool-start", toolCallId: tu.id, tool: tu.name, title, args: asRecord(valid.value) }, taskId);
      try {
        const out = await toolset.run(tu.name, valid.value);
        emit({ type: "tool-result", toolCallId: tu.id, tool: tu.name, title, ok: out.ok, result: out.result }, taskId);
        return toolResultBlock(tu.id, JSON.stringify(out.summary ?? null), !out.ok);
      } catch (error) {
        const message = messageText(error);
        emit({ type: "tool-error", toolCallId: tu.id, tool: tu.name, title, message }, taskId);
        return toolResultBlock(tu.id, message, true);
      }
    }

    // Splice every message typed during this turn into the history the next model call will read, promoting each
    // from "queued" to "applied". Providers reject consecutive user messages, and a tool-result turn is itself
    // role "user", so a steer landing on one merges into it rather than opening a second user turn.
    function applyPending(taskId: string): void {
      const drained = pending.splice(0);
      if (drained.length === 0) return;
      const blocks: ContentBlock[] = [];
      for (const message of drained) {
        emit({ type: "user-message-applied", id: message.id }, taskId);
        blocks.push({ type: "text", text: message.content });
      }
      const lastIndex = modelHistory.length - 1;
      const last = modelHistory[lastIndex];
      if (last && last.role === "user") {
        modelHistory[lastIndex] = { ...last, content: [...last.content, ...blocks] };
        return;
      }
      modelHistory.push({ role: "user", content: blocks });
    }

    async function runTurn(taskId: string, signal: AbortSignal): Promise<void> {
      const engineOps = task.execution?.engineOps;
      const workspaceAccess = task.execution?.workspaceAccess;
      const toolset = mergeToolsets([
        engineOps ? buildContainerToolset(engineOps) : null,
        workspaceAccess ? buildWorkspaceToolset(workspaceAccess) : null,
      ]);
      const tools = toolset ? toolset.defs : undefined;
      // Injection resistance, scoped to THIS turn: once a tool result has entered the conversation the model may
      // be repeating instructions it read from untrusted content, so a remembered allow stops auto-running.
      let tainted = false;
      try {
        for (let step = 0; step < MAX_STEPS; step += 1) {
          const assistantId = randomUUID();
          let started = false;
          let text = "";
          const toolUses: ToolUseBlock[] = [];
          const adapter = makeAdapter(task);
          // One controller per model call. Stop and steering both cut the stream, but only steering trips the
          // segment controller — so afterwards the two are told apart by which signal aborted.
          const segment = new AbortController();
          segmentAbort = segment;
          const cut = AbortSignal.any([signal, segment.signal]);
          const stream = adapter.stream(modelHistory, {
            model: task.resolved.model ?? "",
            systemPrompt: task.system,
            tools,
            abortSignal: cut,
          });
          try {
            for await (const streamEvent of stream) {
              if (cut.aborted) break;
              if (streamEvent.type === "text") {
                const delta = String(streamEvent.data ?? "");
                if (!delta) continue;
                if (!started) {
                  emit({ type: "assistant-start", id: assistantId }, taskId);
                  started = true;
                }
                text = `${text}${delta}`.slice(0, MAX_TURN_TEXT);
                emit({ type: "assistant-delta", id: assistantId, text: delta }, taskId);
              } else if (streamEvent.type === "tool_use") {
                toolUses.push(streamEvent.data as ToolUseBlock);
              } else if (streamEvent.type === "done") {
                break;
              } else if (streamEvent.type === "error") {
                throw streamEvent.data instanceof Error ? streamEvent.data : new Error(messageText(streamEvent.data));
              }
            }
          } finally {
            // Cleared per step so `segmentAbort !== null` means exactly "a model call is in flight" — the test
            // submit() uses to decide whether an arriving message interrupts or waits for the tool to settle.
            segmentAbort = null;
          }
          if (signal.aborted) {
            if (started) emit({ type: "assistant-end", id: assistantId, status: "stopped" }, taskId);
            emit({ type: "task-stopped" }, taskId);
            return;
          }
          // STEERING, mid model call. The segment was cut short so a message typed while the model streamed can
          // redirect this task now. Freeze the partial reply as Interrupted, keep its text as context, splice the
          // message in and run the next step of the SAME task — deferring to a fresh task would make the user watch
          // the model finish the very work they just redirected.
          if (segment.signal.aborted) {
            if (started) emit({ type: "assistant-end", id: assistantId, status: "interrupted" }, taskId);
            // Only the text survives: a partial tool_use block would have no matching tool_result, and providers
            // reject that pairing outright.
            if (text) modelHistory.push({ role: "assistant", content: [{ type: "text", text }] });
            applyPending(taskId);
            emit({ type: "phase-changed", phase: "model" }, taskId);
            continue;
          }
          if (started) emit({ type: "assistant-end", id: assistantId, status: "complete" }, taskId);

          const assistantContent: ContentBlock[] = [...(text ? [{ type: "text" as const, text }] : []), ...toolUses];
          if (assistantContent.length > 0) modelHistory.push({ role: "assistant", content: assistantContent });
          if (toolUses.length === 0) {
            emit({ type: "task-complete", finishReason: "stop" }, taskId);
            return;
          }
          if (!toolset) {
            emit({ type: "error", scope: "model", message: "Model requested a tool but none are available" }, taskId);
            return;
          }

          emit({ type: "phase-changed", phase: "tool" }, taskId);
          const toolResults: ContentBlock[] = [];
          for (const tu of toolUses) {
            if (signal.aborted) break;
            toolResults.push(await executeToolUse(tu, toolset, taskId, tainted));
            tainted = true;
          }
          if (signal.aborted) {
            emit({ type: "task-stopped" }, taskId);
            return;
          }
          modelHistory.push({ role: "user", content: toolResults });
          // STEERING, mid tool call. The tool settles exactly once, then anything typed while it ran is spliced in
          // ahead of the next model call — same task, no interruption needed.
          applyPending(taskId);
          emit({ type: "phase-changed", phase: "model" }, taskId);
        }
        emit({ type: "task-complete", finishReason: "max_steps" }, taskId);
      } catch (error) {
        emit({ type: "error", scope: "model", message: messageText(error) }, taskId);
      }
    }

    // Begin a task for `message`. `alreadyAnnounced` is true for a queued message, whose user-message event was
    // emitted when it was accepted — it only needs promoting from "queued" to "applied" now that it is running.
    function startTask(message: SubmitChatRequest["message"], alreadyAnnounced: boolean): string {
      const taskId = randomUUID();
      activeTaskId = taskId;
      const controller = new AbortController();
      abort = controller;
      emit({ type: "phase-changed", phase: "model" }, taskId);
      if (alreadyAnnounced) {
        emit({ type: "user-message-applied", id: message.id }, taskId);
      } else {
        emit({ type: "user-message", id: message.id, content: message.content, delivery: "applied" }, taskId);
      }
      modelHistory.push({ role: "user", content: [{ type: "text", text: message.content }] });
      void runTurn(taskId, controller.signal)
        .catch((error) => options.logger?.error("ai interactive turn failed", error))
        .finally(() => {
          if (abort === controller) abort = null;
          activeTaskId = null;
          // A steer is normally consumed inside the turn it was typed into. This catches the narrow race where one
          // lands after the last model call — it still must not vanish, so it opens a turn of its own.
          const next = pending.shift();
          if (next) startTask(next, true);
        });
      return taskId;
    }

    return {
      async submit(message, taskSettings) {
        if (taskSettings) task = taskSettings;
        // STEERING. The composer stays live while a task runs, so a message can arrive mid-turn. It redirects THAT
        // task rather than queueing behind it: during a model call the segment is cut short at once, during a tool
        // call the tool settles and the message is spliced in before the next model call.
        if (activeTaskId) {
          if (pending.length >= MAX_PENDING_INPUTS) {
            emit(
              { type: "user-message", id: message.id, content: message.content, delivery: "discarded" },
              activeTaskId,
            );
            return {
              accepted: true,
              sessionId: options.sessionId,
              taskId: activeTaskId,
              mode: "duplicate",
              phase: view.phase,
            };
          }
          // A live segment controller IS "a model call is in flight"; during a tool call it is null and the message
          // simply waits for that tool to settle.
          const segment = segmentAbort;
          pending.push(message);
          emit({ type: "user-message", id: message.id, content: message.content, delivery: "queued" }, activeTaskId);
          if (segment) {
            emit({ type: "phase-changed", phase: "interrupting" }, activeTaskId);
            segment.abort();
          }
          return {
            accepted: true,
            sessionId: options.sessionId,
            taskId: activeTaskId,
            mode: segment ? "interrupting" : "queued",
            phase: view.phase,
          };
        }
        const taskId = startTask(message, false);
        return { accepted: true, sessionId: options.sessionId, taskId, mode: "started", phase: "model" };
      },
      async resolveApproval(approvalId, decision) {
        const resolve = approvals.get(approvalId);
        if (!resolve) return { accepted: false, phase: view.phase };
        resolve(decision === "allow" ? "allow" : "reject");
        return { accepted: true, phase: view.phase };
      },
      async cancel() {
        abort?.abort();
        rejectPendingApprovals();
      },
      snapshot() {
        return view;
      },
      durableSnapshot() {
        return { view, modelHistory };
      },
      async dispose() {
        abort?.abort();
        rejectPendingApprovals();
      },
    };
  };
}
