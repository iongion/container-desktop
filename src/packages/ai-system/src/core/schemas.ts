import { z } from "zod";
import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
} from "./channels";
import { MAX_CHAT_MESSAGE_CHARS, MAX_INITIAL_HISTORY_MESSAGES } from "./chatEvents";
import {
  MAX_ACTIVE_GOAL_RUNS,
  MAX_CONVERSATION_MODEL_MESSAGES,
  MAX_CONVERSATION_RECORD_BYTES,
  MAX_CONVERSATION_TIMELINE_ITEMS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
  MAX_GOAL_CHARS,
  MAX_RETAINED_CONVERSATIONS,
  MAX_RUN_SYNTHESIS_CHARS,
  MAX_RUN_TASK_DESCRIPTION_CHARS,
  MAX_RUN_TASK_OUTPUT_CHARS,
  MAX_RUN_TASKS,
  MAX_RUN_TOKEN_BUDGET,
  MAX_RUN_WORKERS,
  MAX_WORKER_ALLOWED_TOOLS,
  MAX_WORKER_NAME_CHARS,
  MAX_WORKER_PROMPT_CHARS,
  MAX_WORKER_SPECIALTY_CHARS,
  MAX_WORKERS,
} from "./limits";

const MAX_ID_CHARS = 256;
const MAX_PROVIDER_CHARS = 64;
const MAX_MODEL_CHARS = 512;
const MAX_TITLE_CHARS = 256;
const MAX_PERMISSION_KEY_CHARS = 8_192;
const MAX_CREDENTIAL_CHARS = 16_384;

const id = z.string().trim().min(1).max(MAX_ID_CHARS);
const provider = z
  .string({ error: "AI: invalid provider id" })
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "AI: invalid provider id")
  .max(MAX_PROVIDER_CHARS, "AI: invalid provider id");
const optionalProvider = provider.optional();
const model = z.string().max(MAX_MODEL_CHARS).optional();
const empty = z.undefined();
const sessionId = z.object({ sessionId: id }).strict();
const runRef = z.object({ runId: id }).strict();

export const diagnosticsBundle = z
  .object({
    os: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    engine: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    connection: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    screen: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    activity: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    resources: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS).optional(),
    errors: z.string().max(MAX_DIAGNOSTICS_BUNDLE_CHARS, "AI: diagnostics bundle is too large").optional(),
  })
  .strict();

const historyMessage = z
  .object({
    id,
    role: z.enum(["user", "assistant"]),
    content: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    createdAt: z.number().nonnegative(),
  })
  .strict();

export const submitChatRequest = z
  .object({
    sessionId: id,
    message: z
      .object({
        id,
        content: z
          .string()
          .trim()
          .min(1, "AI: chat message is empty")
          .max(MAX_CHAT_MESSAGE_CHARS, "AI: chat message is too long"),
        createdAt: z.number().nonnegative(),
      })
      .strict(),
    history: z.array(historyMessage).max(MAX_INITIAL_HISTORY_MESSAGES, "AI: chat history is too large"),
    providerId: optionalProvider,
    model,
    bundle: diagnosticsBundle.optional(),
  })
  .strict();

export const approvalDecision = z.enum(["allow", "reject"]);
export const resolveChatApprovalRequest = z
  .object({ sessionId: id, approvalId: id, decision: approvalDecision })
  .strict();
export const permissionsList = z.enum(["allowed", "blocked"]);

// Goal mode. `model` drives the worker agents; `coordinatorModel` optionally points decomposition + synthesis at a
// cheaper model (the coordinator reasons over task titles, not tool output, so it rarely needs the frontier model).
// `maxTokens`/`maxTasks` are the user-facing cost caps — absent ⇒ the DEFAULT_RUN_* ceilings in limits.
export const startGoalRequest = z
  .object({
    runId: id,
    goal: z.string().trim().min(1, "AI: goal is empty").max(MAX_GOAL_CHARS, "AI: goal is too long"),
    providerId: optionalProvider,
    model,
    coordinatorModel: model,
    maxTokens: z.number().int().positive().max(MAX_RUN_TOKEN_BUDGET).optional(),
    maxTasks: z.number().int().positive().max(MAX_RUN_TASKS).optional(),
    // Ids into the workers library. The host resolves them to definitions; absent/empty ⇒ every task runs
    // on the run defaults, which is the pre-workers behaviour.
    workerIds: z.array(id).max(MAX_RUN_WORKERS).optional(),
  })
  .strict();

export const resolveGoalPlanRequest = z.object({ runId: id, decision: approvalDecision }).strict();
export const resolveGoalToolRequest = z.object({ runId: id, approvalId: id, decision: approvalDecision }).strict();

// The workers library
// A worker is a reusable agent definition the coordinator may assign to a plan task: its own model, system
// prompt and tool policy. Definitions are USER-AUTHORED and live host-side; a run references them by id only
// (see startGoalRequest.workerIds), so nothing renderer-side can inject a policy into a run.
export const workerToolPolicyMode = z.enum(["all", "ask", "granular"]);

// Where a worker's tools execute. Only the host is implemented today; the union exists so adding a container
// target later is an added member rather than a stored-record migration.
export const workerExecutionTarget = z.discriminatedUnion("kind", [z.object({ kind: z.literal("host") }).strict()]);

export const workerDefinition = z
  .object({
    id,
    name: z.string().trim().min(1, "AI: a worker needs a name").max(MAX_WORKER_NAME_CHARS),
    // One line describing what this worker is good at. Goes into the coordinator's roster, so it is what the
    // model actually reads when deciding which worker a task belongs to.
    specialty: z.string().trim().max(MAX_WORKER_SPECIALTY_CHARS),
    systemPrompt: z.string().max(MAX_WORKER_PROMPT_CHARS),
    providerId: optionalProvider,
    model,
    toolPolicy: z
      .object({
        mode: workerToolPolicyMode,
        // Tool ids, consulted only when mode is "granular". Bounded opaque strings: validating them against the
        // real tool unions belongs in the editor UI, which can enumerate both toolsets.
        allowed: z.array(z.string().trim().min(1).max(MAX_TITLE_CHARS)).max(MAX_WORKER_ALLOWED_TOOLS),
      })
      .strict(),
    execution: workerExecutionTarget,
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const workerFileSchema = z
  .object({ version: z.literal(1), workers: z.array(workerDefinition).max(MAX_WORKERS) })
  .strict();

export const saveWorkerRequest = z.object({ worker: workerDefinition }).strict();
export const removeWorkerRequest = z.object({ id }).strict();
export const workersResult = z.object({ workers: z.array(workerDefinition).max(MAX_WORKERS) }).strict();

export const invokeSchemas = {
  [AI_CHANNELS.status]: empty,
  [AI_CHANNELS.keyHas]: z.object({ provider }).strict(),
  [AI_CHANNELS.keySet]: z
    .object({
      provider,
      key: z
        .string({ error: "AI: a non-empty API key is required" })
        .trim()
        .min(1, "AI: a non-empty API key is required")
        .max(MAX_CREDENTIAL_CHARS),
      allowDegraded: z.boolean().optional(),
    })
    .strict(),
  [AI_CHANNELS.keyClear]: z.object({ provider }).strict(),
  [AI_CHANNELS.chatList]: empty,
  [AI_CHANNELS.chatCreate]: z
    .object({ id, title: z.string().trim().min(1).max(MAX_TITLE_CHARS), providerId: optionalProvider, model })
    .strict(),
  [AI_CHANNELS.chatSubmit]: submitChatRequest,
  [AI_CHANNELS.chatResolve]: resolveChatApprovalRequest,
  [AI_CHANNELS.chatCancel]: sessionId,
  [AI_CHANNELS.chatSnapshot]: sessionId,
  [AI_CHANNELS.chatDispose]: sessionId,
  [AI_CHANNELS.goalStart]: startGoalRequest,
  [AI_CHANNELS.goalCancel]: runRef,
  [AI_CHANNELS.goalApprovePlan]: resolveGoalPlanRequest,
  [AI_CHANNELS.goalApproveTool]: resolveGoalToolRequest,
  [AI_CHANNELS.goalSnapshot]: runRef,
  [AI_CHANNELS.goalList]: empty,
  [AI_CHANNELS.workersList]: empty,
  [AI_CHANNELS.workersSave]: saveWorkerRequest,
  [AI_CHANNELS.workersRemove]: removeWorkerRequest,
  [AI_CHANNELS.modelsList]: z.object({ providerId: optionalProvider, requestId: id }).strict(),
  [AI_CHANNELS.modelsCancel]: z.object({ requestId: id }).strict(),
  [AI_CHANNELS.permissionsList]: empty,
  [AI_CHANNELS.permissionsRemove]: z
    .object({ list: permissionsList, key: z.string().max(MAX_PERMISSION_KEY_CHARS) })
    .strict(),
  [AI_CHANNELS.permissionsSetWeb]: z.object({ verdict: z.enum(["allow", "block"]).nullable() }).strict(),
} satisfies Record<AIInvokeChannel, z.ZodType>;

export const chatPhase = z.enum(["idle", "model", "tool", "interrupting", "awaiting-approval", "stopping", "error"]);
const ok = z.object({ ok: z.literal(true) }).strict();
export const conversationSummarySchema = z
  .object({
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    providerId: optionalProvider,
    model,
    phase: chatPhase,
    lastSeq: z.number().int().nonnegative(),
  })
  .strict();
const args = z.record(z.string(), z.unknown());
const assistantMessageStatus = z.enum(["streaming", "complete", "interrupted", "stopped", "error"]);
const userMessageDelivery = z.enum(["queued", "applied", "discarded"]);
const chatErrorScope = z.enum(["submit", "model", "tool", "approval", "session"]);
const timelineItem = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      id,
      role: z.enum(["user", "assistant"]),
      content: z.string().max(MAX_CHAT_MESSAGE_CHARS),
      delivery: userMessageDelivery,
      status: assistantMessageStatus,
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool"),
      id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      status: z.enum(["running", "complete", "error"]),
      ok: z.boolean().optional(),
      result: z.unknown().optional(),
      message: z.string().max(MAX_CHAT_MESSAGE_CHARS).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("approval"),
      id,
      approvalId: id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
      status: z.enum(["pending", "resolving", "allowed", "rejected"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("denied"),
      id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
  z
    .object({ kind: z.literal("error"), id, scope: chatErrorScope, message: z.string().max(MAX_CHAT_MESSAGE_CHARS) })
    .strict(),
]);
export const chatView = z
  .object({
    sessionId: id,
    phase: chatPhase,
    activeTaskId: id.optional(),
    activeSegmentId: id.optional(),
    lastSeq: z.number().int().nonnegative(),
    timeline: z.array(timelineItem).max(MAX_CONVERSATION_TIMELINE_ITEMS),
    streamingAssistant: z
      .object({ id, timelineIndex: z.number().int().nonnegative(), content: z.string().max(MAX_CHAT_MESSAGE_CHARS) })
      .strict()
      .optional(),
  })
  .strict();

function streamingPointerConsistent(view: z.infer<typeof chatView>): boolean {
  const streaming = view.streamingAssistant;
  if (!streaming) return true;
  const item = view.timeline[streaming.timelineIndex];
  return (
    item?.kind === "message" && item.role === "assistant" && item.status === "streaming" && item.id === streaming.id
  );
}

function withinRecordBytes(record: unknown): boolean {
  try {
    return JSON.stringify(record).length <= MAX_CONVERSATION_RECORD_BYTES;
  } catch {
    return false;
  }
}

// Durable conversation record/file. Reuses chatView and adds the cross-field invariants the hand-written
// validators used to enforce: view.sessionId === id, a consistent streaming-assistant pointer, and a
// per-record serialized-byte ceiling. parseConversationFile layers on the text-byte and unique-id checks.
export const conversationRecordSchema = z
  .object({
    version: z.literal(1),
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    providerId: optionalProvider,
    model,
    view: chatView,
    // Canonical AI-SDK model messages are opaque to core: bounded JSON only, never the AI SDK's own shapes.
    modelHistory: z.array(z.unknown()).max(MAX_CONVERSATION_MODEL_MESSAGES),
  })
  .strict()
  .refine((record) => record.view.sessionId === record.id, { message: "AI: conversation view/session id mismatch" })
  .refine((record) => streamingPointerConsistent(record.view), { message: "AI: streaming pointer inconsistent" })
  .refine(withinRecordBytes, { message: "AI: conversation record exceeds size limit" });

export const conversationFileSchema = z
  .object({
    version: z.literal(1),
    records: z.array(conversationRecordSchema).max(MAX_RETAINED_CONVERSATIONS),
  })
  .strict()
  .refine((file) => new Set(file.records.map((record) => record.id)).size === file.records.length, {
    message: "AI: duplicate conversation id",
  });

export const permissionRule = z
  .object({
    program: z.string().max(MAX_PERMISSION_KEY_CHARS),
    args: z.array(z.string().max(MAX_PERMISSION_KEY_CHARS)).max(256),
    addedAt: z.string().max(64).optional(),
  })
  .strict();
export const permissionsSnapshot = z
  .object({
    version: z.string().max(64),
    allowed: z.array(permissionRule).max(10_000),
    blocked: z.array(permissionRule).max(10_000),
    webSearch: z.enum(["allow", "block"]).optional(),
    status: z.enum(["ok", "missing", "error"]),
    path: z.string().max(8_192),
  })
  .strict();

export const submitChatResult = z
  .object({
    accepted: z.literal(true),
    sessionId: id,
    taskId: id,
    mode: z.enum(["started", "interrupting", "queued", "duplicate"]),
    phase: chatPhase,
  })
  .strict();
export const resolveChatApprovalResult = z.object({ accepted: z.boolean(), phase: chatPhase }).strict();

// Goal-mode projection. Where chat folds into a linear timeline, a run folds into a task DAG: `dependsOn` carries
// the edges, and the renderer lays the graph out from them. Task output is the per-agent transcript, kept on the
// task rather than in a parallel structure so one seq-ordered event stream drives the whole view.
export const runPhase = z.enum([
  "idle",
  "planning",
  "awaiting-plan",
  "running",
  "synthesizing",
  "cancelling",
  "stopped",
  "done",
  "error",
]);
// "awaiting-approval" is a VIEW-only status: the scheduler still counts the task as running (its worker is
// in-flight, holding a concurrency slot), but the DAG shows it blocked so the user can see what to act on.
const runTaskStatus = z.enum(["pending", "running", "awaiting-approval", "complete", "failed", "skipped"]);
const runErrorScope = z.enum(["start", "plan", "task", "synthesis", "run"]);
// BOTH runTask and runTaskView carry `workerId`, and they must change together. The reducer spreads a plan task
// straight into the view ({...task, status, output}), and the push-validation failure at the client bridge is
// swallowed by design — so a workerId present on one schema and absent from the other would silently drop
// `plan-ready` and leave the screen stuck in "planning" with no error anywhere.
const runTask = z
  .object({
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    description: z.string().max(MAX_RUN_TASK_DESCRIPTION_CHARS),
    dependsOn: z.array(id).max(MAX_RUN_TASKS),
    agent: z.string().max(MAX_TITLE_CHARS),
    // Set when the run supplied a roster: which library worker carries this task out.
    workerId: id.optional(),
  })
  .strict();
const runTaskView = z
  .object({
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    description: z.string().max(MAX_RUN_TASK_DESCRIPTION_CHARS),
    dependsOn: z.array(id).max(MAX_RUN_TASKS),
    agent: z.string().max(MAX_TITLE_CHARS),
    workerId: id.optional(),
    status: runTaskStatus,
    output: z.string().max(MAX_RUN_TASK_OUTPUT_CHARS),
    error: z.string().max(MAX_CHAT_MESSAGE_CHARS).optional(),
  })
  .strict();
// Cumulative run totals, not per-turn deltas — the reducer replaces rather than accumulates, so a dropped or
// replayed usage event can never double-count the budget the cost cap is enforced against.
const runUsage = z
  .object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() })
  .strict();
// Workers run in parallel, so several can be blocked on a tool approval at once — hence a LIST, not a single
// pending approval the way the linear chat timeline can assume.
const runApproval = z
  .object({
    approvalId: id,
    taskId: id,
    toolCallId: id,
    tool: id,
    title: z.string().max(MAX_TITLE_CHARS),
    args,
    reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    status: z.enum(["pending", "allowed", "rejected"]),
  })
  .strict();

export const runView = z
  .object({
    runId: id,
    goal: z.string().max(MAX_GOAL_CHARS),
    phase: runPhase,
    lastSeq: z.number().int().nonnegative(),
    tasks: z.array(runTaskView).max(MAX_RUN_TASKS),
    approvals: z.array(runApproval).max(MAX_RUN_TASKS),
    synthesis: z.string().max(MAX_RUN_SYNTHESIS_CHARS),
    usage: runUsage,
    planPending: z.boolean(),
  })
  .strict();

export const startGoalResult = z.object({ accepted: z.literal(true), runId: id, phase: runPhase }).strict();
export const resolveGoalPlanResult = z.object({ accepted: z.boolean(), phase: runPhase }).strict();

export const runEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("phase-changed"), phase: runPhase }).strict(),
  z.object({ type: z.literal("plan-ready"), tasks: z.array(runTask).max(MAX_RUN_TASKS) }).strict(),
  z.object({ type: z.literal("plan-resolved"), decision: approvalDecision }).strict(),
  z.object({ type: z.literal("task-started"), taskId: id }).strict(),
  z.object({ type: z.literal("task-delta"), taskId: id, text: z.string().max(MAX_RUN_TASK_OUTPUT_CHARS) }).strict(),
  z.object({ type: z.literal("task-completed"), taskId: id }).strict(),
  z.object({ type: z.literal("task-failed"), taskId: id, message: z.string().max(MAX_CHAT_MESSAGE_CHARS) }).strict(),
  z.object({ type: z.literal("task-skipped"), taskId: id, reason: z.string().max(MAX_CHAT_MESSAGE_CHARS) }).strict(),
  z
    .object({
      type: z.literal("tool-approval-request"),
      approvalId: id,
      taskId: id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
  z.object({ type: z.literal("tool-approval-resolved"), approvalId: id, decision: approvalDecision }).strict(),
  z.object({ type: z.literal("synthesis-delta"), text: z.string().max(MAX_RUN_SYNTHESIS_CHARS) }).strict(),
  z
    .object({
      type: z.literal("usage"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ type: z.literal("run-complete"), finishReason: z.string().max(MAX_TITLE_CHARS) }).strict(),
  z.object({ type: z.literal("run-stopped") }).strict(),
  z
    .object({ type: z.literal("error"), scope: runErrorScope, message: z.string().max(MAX_CHAT_MESSAGE_CHARS) })
    .strict(),
]);

export const runEventEnvelope = z
  .object({ version: z.literal(1), runId: id, seq: z.number().int().nonnegative(), event: runEvent })
  .strict();

export const responseSchemas = {
  [AI_CHANNELS.status]: z
    .object({
      encryption: z
        .object({ available: z.boolean(), backend: z.string().max(256).optional(), degraded: z.boolean() })
        .strict(),
      webSearchAvailable: z.boolean(),
    })
    .strict(),
  [AI_CHANNELS.keyHas]: z.boolean(),
  [AI_CHANNELS.keySet]: ok,
  [AI_CHANNELS.keyClear]: ok,
  [AI_CHANNELS.chatList]: z.array(conversationSummarySchema).max(MAX_RETAINED_CONVERSATIONS),
  [AI_CHANNELS.chatCreate]: conversationSummarySchema,
  [AI_CHANNELS.chatSubmit]: submitChatResult,
  [AI_CHANNELS.chatResolve]: resolveChatApprovalResult,
  [AI_CHANNELS.chatCancel]: ok,
  [AI_CHANNELS.chatSnapshot]: chatView.nullable(),
  [AI_CHANNELS.chatDispose]: ok,
  [AI_CHANNELS.goalStart]: startGoalResult,
  [AI_CHANNELS.goalCancel]: ok,
  [AI_CHANNELS.goalApprovePlan]: resolveGoalPlanResult,
  [AI_CHANNELS.goalApproveTool]: resolveGoalPlanResult,
  [AI_CHANNELS.goalSnapshot]: runView.nullable(),
  [AI_CHANNELS.goalList]: z.object({ runs: z.array(runView).max(MAX_ACTIVE_GOAL_RUNS) }).strict(),
  [AI_CHANNELS.workersList]: workersResult,
  [AI_CHANNELS.workersSave]: workersResult,
  [AI_CHANNELS.workersRemove]: workersResult,
  [AI_CHANNELS.modelsList]: z
    .object({ models: z.array(z.object({ id: z.string().trim().min(1).max(MAX_MODEL_CHARS) }).strict()).max(10_000) })
    .strict(),
  [AI_CHANNELS.modelsCancel]: ok,
  [AI_CHANNELS.permissionsList]: permissionsSnapshot,
  [AI_CHANNELS.permissionsRemove]: permissionsSnapshot,
  [AI_CHANNELS.permissionsSetWeb]: permissionsSnapshot,
} satisfies Record<AIInvokeChannel, z.ZodType>;

export const chatEvent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase-changed"),
      phase: chatPhase,
    })
    .strict(),
  z
    .object({
      type: z.literal("user-message"),
      id,
      content: z.string().max(MAX_CHAT_MESSAGE_CHARS),
      delivery: userMessageDelivery,
    })
    .strict(),
  z.object({ type: z.literal("user-message-applied"), id }).strict(),
  z.object({ type: z.literal("user-message-discarded"), id }).strict(),
  z.object({ type: z.literal("assistant-start"), id }).strict(),
  z.object({ type: z.literal("assistant-delta"), id, text: z.string().max(MAX_CHAT_MESSAGE_CHARS) }).strict(),
  z
    .object({ type: z.literal("assistant-end"), id, status: z.enum(["complete", "interrupted", "stopped", "error"]) })
    .strict(),
  z
    .object({ type: z.literal("tool-start"), toolCallId: id, tool: id, title: z.string().max(MAX_TITLE_CHARS), args })
    .strict(),
  z
    .object({
      type: z.literal("tool-result"),
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      ok: z.boolean(),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-error"),
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      message: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-denied"),
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("approval-request"),
      approvalId: id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      reason: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
  z.object({ type: z.literal("approval-resolved"), approvalId: id, decision: approvalDecision }).strict(),
  z.object({ type: z.literal("task-complete"), finishReason: z.string().max(MAX_TITLE_CHARS) }).strict(),
  z.object({ type: z.literal("task-stopped") }).strict(),
  z
    .object({
      type: z.literal("error"),
      scope: chatErrorScope,
      message: z.string().max(MAX_CHAT_MESSAGE_CHARS),
    })
    .strict(),
]);

export const chatEventEnvelope = z
  .object({
    version: z.literal(1),
    sessionId: id,
    taskId: id.optional(),
    segmentId: id.optional(),
    seq: z.number().int().nonnegative(),
    event: chatEvent,
  })
  .strict();

export const pushSchemas = {
  [AI_CHANNELS.chatEvent]: chatEventEnvelope,
  [AI_CHANNELS.goalEvent]: runEventEnvelope,
} satisfies Record<AIPushChannel, z.ZodType>;

// Indexing a schema map by a generic channel yields a union of concrete schemas whose `.parse` output TS
// can't reconcile with the mapped return type. The union is still assignable to the base ZodType, so parse
// through it and assert the derived type at this single trust-boundary seam.
function parseWith<TValue>(schema: z.ZodType, payload: unknown): TValue {
  return schema.parse(payload) as TValue;
}

export function validateAIInvokeRequest<TChannel extends AIInvokeChannel>(
  channel: TChannel,
  payload: unknown,
): AIInvokeRequest<TChannel> {
  return parseWith(invokeSchemas[channel], payload);
}

export function validateAIInvokeResponse<TChannel extends AIInvokeChannel>(
  channel: TChannel,
  payload: unknown,
): AIInvokeResponse<TChannel> {
  return parseWith(responseSchemas[channel], payload);
}

export function validateAIPushPayload<TChannel extends AIPushChannel>(
  channel: TChannel,
  payload: unknown,
): AIPushPayload<TChannel> {
  return parseWith(pushSchemas[channel], payload);
}
