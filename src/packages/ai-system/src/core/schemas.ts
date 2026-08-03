import { z } from "zod";
import {
  AI_CHANNELS,
  type AIInvokeChannel,
  type AIInvokeRequest,
  type AIInvokeResponse,
  type AIPushChannel,
  type AIPushPayload,
} from "./channels";
import type { EffectiveContextSectionKind, EffectiveContextSourceKind } from "./context";
import {
  MAX_ACTIVE_RUNS,
  MAX_AVATAR_DATA_URL_BYTES,
  MAX_AVATAR_NAME_CHARS,
  MAX_AVATARS,
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
  MAX_GOAL_CHARS,
  MAX_RETAINED_THREADS,
  MAX_RUN_SPAN_BATCH,
  MAX_RUN_SPAN_BYTES,
  MAX_RUN_SPANS,
  MAX_RUN_SYNTHESIS_CHARS,
  MAX_RUN_TASK_DESCRIPTION_CHARS,
  MAX_RUN_TASK_OUTPUT_CHARS,
  MAX_RUN_TASK_TOOL_RESULTS,
  MAX_RUN_TASKS,
  MAX_RUN_TOKEN_BUDGET,
  MAX_RUN_WORKERS,
  MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS,
  MAX_THREAD_COMPACTION_SUMMARY_CHARS,
  MAX_THREAD_COMPACTIONS,
  MAX_THREAD_MODEL_MESSAGES,
  MAX_THREAD_RECORD_BYTES,
  MAX_THREAD_TIMELINE_ITEMS,
  MAX_WORKER_ALLOWED_TOOLS,
  MAX_WORKER_NAME_CHARS,
  MAX_WORKER_PROMPT_CHARS,
  MAX_WORKER_SPECIALTY_CHARS,
  MAX_WORKERS,
} from "./limits";
import { PROJECT_CONTEXT_LIMITS } from "./projectContext";
import { SKILL_DIAGNOSTIC_CODES, SKILL_LIMITS } from "./skills";
import { MAX_AI_TEXT_CHARS, MAX_INITIAL_THREAD_HISTORY_MESSAGES } from "./threadEvents";
import { toolArtifactRecordSchema, toolArtifactReferenceSchema } from "./toolArtifacts";

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
const threadId = z.object({ threadId: id }).strict();
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
    content: z.string().max(MAX_AI_TEXT_CHARS),
    createdAt: z.number().nonnegative(),
  })
  .strict();

export const accessProfileId = z.enum(["observe", "workspace", "operator"]);
export const reasoningLevel = z.enum(["default", "low", "medium", "high"]);

export const submitThreadRequest = z
  .object({
    threadId: id,
    message: z
      .object({
        id,
        content: z
          .string()
          .trim()
          .min(1, "AI: Thread message is empty")
          .max(MAX_AI_TEXT_CHARS, "AI: Thread message is too long"),
        createdAt: z.number().nonnegative(),
      })
      .strict(),
    history: z.array(historyMessage).max(MAX_INITIAL_THREAD_HISTORY_MESSAGES, "AI: Thread history is too large"),
    providerId: optionalProvider,
    model,
    accessProfile: accessProfileId.optional(),
    reasoningLevel: reasoningLevel.optional(),
    bundle: diagnosticsBundle.optional(),
  })
  .strict();

export const approvalDecision = z.enum(["allow", "reject"]);
export const resolveThreadApprovalRequest = z
  .object({ threadId: id, approvalId: id, decision: approvalDecision })
  .strict();
export const permissionsList = z.enum(["allowed", "blocked"]);

// Team run. `model` drives the worker agents; `coordinatorModel` optionally points decomposition + synthesis at a
// cheaper model (the coordinator reasons over task titles, not tool output, so it rarely needs the frontier model).
// `maxTokens`/`maxTasks` are the user-facing cost caps — absent ⇒ the DEFAULT_RUN_* ceilings in limits.
export const startRunRequest = z
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

export const resolveRunPlanRequest = z.object({ runId: id, decision: approvalDecision }).strict();
export const resolveRunToolRequest = z.object({ runId: id, approvalId: id, decision: approvalDecision }).strict();

// The workers library
// A worker is a reusable agent definition the coordinator may assign to a plan task: its own model, system
// prompt and tool policy. Definitions are USER-AUTHORED and live host-side; a run references them by id only
// (see startRunRequest.workerIds), so nothing renderer-side can inject a policy into a run.
export const workerToolPolicyMode = z.enum(["all", "ask", "granular"]);

// Where a worker's tools execute. The union grows by adding members; a stored {kind:"host"} record is unaffected.
// A container/sandbox whose connection is an SSH (*_REMOTE) connection IS the remote-container case — the
// transport wraps argv in `ssh … --`, so no separate remote-container kind is needed.
const executionRef = z.string().trim().min(1).max(MAX_TITLE_CHARS);
export const workerExecutionTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("host") }).strict(),
  z.object({ kind: z.literal("remote"), connectionId: id }).strict(),
  z.object({ kind: z.literal("container"), connectionId: id, containerId: executionRef }).strict(),
  z.object({ kind: z.literal("sandbox"), connectionId: id, image: executionRef }).strict(),
]);

const workspaceChangeEntrySchema = z
  .object({
    path: z.string().max(1_024),
    previousPath: z.string().max(1_024).optional(),
    index: z.enum([
      "unchanged",
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "type-changed",
      "conflicted",
      "untracked",
    ]),
    worktree: z.enum([
      "unchanged",
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "type-changed",
      "conflicted",
      "untracked",
    ]),
  })
  .strict();

const workspaceChangeLocationSchema = {
  target: workerExecutionTarget,
  workspaceRoot: z.string().min(1).max(8_192),
};

const workspaceChangeSummarySchema = z
  .object({
    ...workspaceChangeLocationSchema,
    beforeCount: z.number().int().nonnegative().max(500),
    afterCount: z.number().int().nonnegative().max(500),
    introduced: z.array(z.string().max(1_024)).max(500),
    cleared: z.array(z.string().max(1_024)).max(500),
    updated: z.array(z.string().max(1_024)).max(500),
    contentChanged: z.boolean(),
    truncated: z.boolean(),
  })
  .strict();

export const workspaceChangeStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...workspaceChangeLocationSchema,
      state: z.enum(["clean", "changes"]),
      branch: z.string().max(8_192).optional(),
      head: z.string().max(256).optional(),
      entries: z.array(workspaceChangeEntrySchema).max(500),
      fingerprint: z.string().length(64),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...workspaceChangeLocationSchema,
      state: z.enum(["not-repository", "unavailable"]),
      entries: z.tuple([]),
      truncated: z.boolean(),
      message: z.string().max(512),
    })
    .strict(),
]);

export const workspaceDiffSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...workspaceChangeLocationSchema,
      state: z.enum(["clean", "changes"]),
      staged: z.string().max(128 * 1_024),
      unstaged: z.string().max(128 * 1_024),
      untracked: z.array(z.string().max(1_024)).max(500),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...workspaceChangeLocationSchema,
      state: z.enum(["not-repository", "unavailable"]),
      truncated: z.boolean(),
      message: z.string().max(512),
    })
    .strict(),
]);

export const workerDefinition = z
  .object({
    id,
    name: z.string().trim().min(1, "AI: a worker needs a name").max(MAX_WORKER_NAME_CHARS),
    // An opaque avatar reference — a shipped preset id or a custom library id. NEVER a preset/image copy, and it
    // MUST NOT be projected into the coordinator roster (see rosterBlock): the model never sees avatar bytes.
    avatarId: id.optional(),
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

// The avatar library — custom uploaded faces (presets are shipped assets, never stored). dataUrl is a downscaled
// inline image; the regex + byte cap are the trust boundary that keeps an arbitrary/oversized string out of the file.
export const avatarRecord = z
  .object({
    id,
    name: z.string().trim().min(1, "AI: an avatar needs a name").max(MAX_AVATAR_NAME_CHARS),
    dataUrl: z
      .string()
      .max(MAX_AVATAR_DATA_URL_BYTES, "AI: the avatar image is too large")
      .regex(/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/, "AI: unsupported avatar image"),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

export const avatarFileSchema = z
  .object({ version: z.literal(1), avatars: z.array(avatarRecord).max(MAX_AVATARS) })
  .strict();

export const saveAvatarRequest = z.object({ avatar: avatarRecord }).strict();
export const removeAvatarRequest = z.object({ id }).strict();
export const avatarsResult = z.object({ avatars: z.array(avatarRecord).max(MAX_AVATARS) }).strict();

const skillFingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const skillSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bundled") }).strict(),
  z.object({ kind: z.literal("user") }).strict(),
  z.object({ kind: z.literal("project"), workspaceId: skillFingerprint }).strict(),
]);
const skillDescriptor = z
  .object({
    id,
    command: z.string().startsWith("/skill:").max(MAX_TITLE_CHARS),
    shortCommand: z.string().startsWith("/skill:").max(MAX_TITLE_CHARS).optional(),
    name: z.string().min(1).max(SKILL_LIMITS.nameBytes),
    description: z.string().min(1).max(SKILL_LIMITS.descriptionBytes),
    argumentHint: z.string().max(SKILL_LIMITS.argumentHintBytes).optional(),
    allowedTools: z.array(id).max(SKILL_LIMITS.toolCount).optional(),
    paths: z.array(z.string().min(1).max(SKILL_LIMITS.pathBytes)).max(SKILL_LIMITS.pathCount).optional(),
    version: z.string().max(SKILL_LIMITS.versionBytes).optional(),
    source: skillSource,
    fingerprint: skillFingerprint,
    enabled: z.boolean(),
    trusted: z.boolean(),
  })
  .strict();
const skillDiagnostic = z
  .object({
    code: z.enum(SKILL_DIAGNOSTIC_CODES),
    field: z.string().max(128).optional(),
    entry: z.string().max(512).optional(),
  })
  .strict();
const skillHostSnapshot = z
  .object({
    revision: z.string().regex(/^\d+$/u),
    user: z.object({ root: z.string().min(1).max(8_192), status: z.enum(["ok", "error"]) }).strict(),
    skills: z.array(skillDescriptor).max(SKILL_LIMITS.skillsPerSource * 3),
    diagnostics: z.array(skillDiagnostic).max(SKILL_LIMITS.skillsPerSource * 4),
    project: z
      .object({
        workspaceId: skillFingerprint,
        root: z.string().min(1).max(8_192),
        enabled: z.boolean(),
        status: z.enum(["ok", "error"]),
      })
      .strict()
      .optional(),
  })
  .strict();

const projectContextContent = z
  .string()
  .max(PROJECT_CONTEXT_LIMITS.sourceBytes)
  .refine((value) => new TextEncoder().encode(value).byteLength <= PROJECT_CONTEXT_LIMITS.sourceBytes);
const projectMemoryContent = z
  .string()
  .trim()
  .min(1)
  .max(PROJECT_CONTEXT_LIMITS.memoryEntryBytes)
  .refine((value) => new TextEncoder().encode(value).byteLength <= PROJECT_CONTEXT_LIMITS.memoryEntryBytes);
const projectMemoryEntry = z
  .object({
    id,
    content: projectMemoryContent,
    source: z.enum(["user", "import"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
const projectRuleDescriptor = z
  .object({
    path: z.string().min(1).max(8_192),
    status: z.enum(["ready", "too-large", "unreadable"]),
    size: z.number().int().nonnegative().optional(),
    modifiedAt: z.number().nonnegative().optional(),
    fingerprint: skillFingerprint.optional(),
    included: z.boolean(),
  })
  .strict();
const projectContextSection = z
  .object({
    kind: z.enum(["rules", "memory"]),
    source: z.string().min(1).max(8_192),
    trust: z.enum(["project", "user"]),
    content: projectContextContent,
    fingerprint: skillFingerprint,
    modifiedAt: z.number().nonnegative(),
    originalBytes: z.number().int().nonnegative().max(PROJECT_CONTEXT_LIMITS.ruleFileBytes),
    includedBytes: z.number().int().nonnegative().max(PROJECT_CONTEXT_LIMITS.sourceBytes),
    truncated: z.boolean(),
  })
  .strict();
const projectContextPack = z
  .object({
    workspaceId: skillFingerprint,
    workspaceRoot: z.string().min(1).max(8_192),
    capturedAt: z.number().nonnegative(),
    fingerprint: skillFingerprint,
    sections: z
      .array(projectContextSection)
      .max(PROJECT_CONTEXT_LIMITS.ruleSources + PROJECT_CONTEXT_LIMITS.memoryEntries),
    budgetBytes: z.literal(PROJECT_CONTEXT_LIMITS.packBytes),
    usedBytes: z.number().int().nonnegative().max(PROJECT_CONTEXT_LIMITS.packBytes),
    omittedSources: z.number().int().nonnegative(),
    truncated: z.boolean(),
    initialTaint: z.boolean(),
  })
  .strict();
export const projectContextSnapshotSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("ready"),
      workspaceId: skillFingerprint,
      workspaceRoot: z.string().min(1).max(8_192),
      rulesEnabled: z.boolean(),
      rules: z.array(projectRuleDescriptor).max(PROJECT_CONTEXT_LIMITS.ruleSources),
      memory: z.array(projectMemoryEntry).max(PROJECT_CONTEXT_LIMITS.memoryEntries),
      pack: projectContextPack,
    })
    .strict(),
  z
    .object({
      state: z.enum(["unconfigured", "unavailable"]),
      rules: z.tuple([]),
      memory: z.tuple([]),
      message: z.string().max(1_024),
    })
    .strict(),
]);

export const invokeSchemas = {
  [AI_CHANNELS.status]: empty,
  [AI_CHANNELS.diagnostics]: z.object({ providerId: optionalProvider }).strict(),
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
  [AI_CHANNELS.threadList]: empty,
  [AI_CHANNELS.threadCreate]: z
    .object({
      id,
      title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
      providerId: optionalProvider,
      model,
      accessProfile: accessProfileId.optional(),
      reasoningLevel: reasoningLevel.optional(),
    })
    .strict(),
  [AI_CHANNELS.threadRename]: z.object({ threadId: id, title: z.string().trim().min(1).max(MAX_TITLE_CHARS) }).strict(),
  [AI_CHANNELS.threadConfigure]: z
    .object({
      threadId: id,
      accessProfile: accessProfileId.optional(),
      reasoningLevel: reasoningLevel.optional(),
    })
    .strict()
    .refine((request) => request.accessProfile !== undefined || request.reasoningLevel !== undefined, {
      message: "AI: Thread configuration is empty",
    }),
  [AI_CHANNELS.threadBranchPreview]: threadId,
  [AI_CHANNELS.threadBranch]: z
    .object({
      threadId: id,
      checkpointId: id,
      title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
    })
    .strict(),
  [AI_CHANNELS.threadCompactionPreview]: threadId,
  [AI_CHANNELS.threadCompact]: z
    .object({
      threadId: id,
      revision: z
        .object({
          lastSeq: z.number().int().nonnegative(),
          modelHistoryLength: z.number().int().nonnegative().max(MAX_THREAD_MODEL_MESSAGES),
          activeCompactionId: id.optional(),
        })
        .strict(),
      instructions: z.string().trim().min(1).max(MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS).optional(),
    })
    .strict(),
  [AI_CHANNELS.threadSubmit]: submitThreadRequest,
  [AI_CHANNELS.threadResolveApproval]: resolveThreadApprovalRequest,
  [AI_CHANNELS.threadStop]: threadId,
  [AI_CHANNELS.threadSnapshot]: threadId,
  [AI_CHANNELS.toolArtifactGet]: z.object({ threadId: id, artifactId: id }).strict(),
  [AI_CHANNELS.threadDelete]: threadId,
  [AI_CHANNELS.changesStatus]: empty,
  [AI_CHANNELS.changesDiff]: empty,
  [AI_CHANNELS.projectContextSnapshot]: empty,
  [AI_CHANNELS.projectRulesSetEnabled]: z.object({ enabled: z.boolean() }).strict(),
  [AI_CHANNELS.projectRulesInitialize]: empty,
  [AI_CHANNELS.projectMemoryAdd]: z.object({ content: projectMemoryContent }).strict(),
  [AI_CHANNELS.projectMemoryRemove]: z.object({ id }).strict(),
  [AI_CHANNELS.projectMemoryClear]: empty,
  [AI_CHANNELS.projectMemoryImport]: z.string().max(PROJECT_CONTEXT_LIMITS.storeBytes),
  [AI_CHANNELS.runStart]: startRunRequest,
  [AI_CHANNELS.runCancel]: runRef,
  [AI_CHANNELS.runApprovePlan]: resolveRunPlanRequest,
  [AI_CHANNELS.runApproveTool]: resolveRunToolRequest,
  [AI_CHANNELS.runSnapshot]: runRef,
  [AI_CHANNELS.runList]: empty,
  [AI_CHANNELS.workersList]: empty,
  [AI_CHANNELS.workersSave]: saveWorkerRequest,
  [AI_CHANNELS.workersRemove]: removeWorkerRequest,
  [AI_CHANNELS.avatarsList]: empty,
  [AI_CHANNELS.avatarsSave]: saveAvatarRequest,
  [AI_CHANNELS.avatarsRemove]: removeAvatarRequest,
  [AI_CHANNELS.modelsList]: z.object({ providerId: optionalProvider, requestId: id }).strict(),
  [AI_CHANNELS.modelsCancel]: z.object({ requestId: id }).strict(),
  [AI_CHANNELS.permissionsList]: empty,
  [AI_CHANNELS.permissionsRemove]: z
    .object({ list: permissionsList, key: z.string().max(MAX_PERMISSION_KEY_CHARS) })
    .strict(),
  [AI_CHANNELS.skillsSnapshot]: empty,
  [AI_CHANNELS.skillsReload]: empty,
  [AI_CHANNELS.skillsSetProjectSource]: z.object({ enabled: z.boolean() }).strict(),
  [AI_CHANNELS.skillsSetProjectTrust]: z
    .object({ skillId: id, expectedFingerprint: skillFingerprint, trusted: z.boolean() })
    .strict(),
  [AI_CHANNELS.skillsInvoke]: z
    .object({
      threadId: id,
      skillId: id,
      expectedFingerprint: skillFingerprint,
      arguments: z.string().max(SKILL_LIMITS.argumentBytes),
    })
    .strict(),
} satisfies Record<AIInvokeChannel, z.ZodType>;

export const threadPhase = z.enum(["idle", "model", "tool", "interrupting", "awaiting-approval", "stopping", "error"]);
const ok = z.object({ ok: z.literal(true) }).strict();
export const threadSummarySchema = z
  .object({
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    titleOrigin: z.enum(["default", "message", "user"]).optional(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    providerId: optionalProvider,
    model,
    accessProfile: accessProfileId.optional(),
    reasoningLevel: reasoningLevel.optional(),
    phase: threadPhase,
    lastSeq: z.number().int().nonnegative(),
  })
  .strict();
const args = z.record(z.string(), z.unknown());
const assistantMessageStatus = z.enum(["streaming", "complete", "interrupted", "stopped", "error"]);
const userMessageDelivery = z.enum(["queued", "applied", "discarded"]);
const threadErrorScope = z.enum(["submit", "model", "tool", "approval", "session"]);
const skillInvocationProvenance = z
  .object({
    skillId: id,
    command: z.string().min(1).max(MAX_TITLE_CHARS),
    source: z.enum(["bundled", "user", "project"]),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
const money = z.object({ amount: z.number().nonnegative(), currency: z.string().min(1).max(16) }).strict();
const effectiveContextSectionKinds = [
  "system",
  "history",
  "turn",
  "tools",
] as const satisfies readonly EffectiveContextSectionKind[];
const effectiveContextSourceKinds = [
  "os",
  "engine",
  "connection",
  "screen",
  "activity",
  "resources",
  "errors",
  "rules",
  "memory",
  "skill",
] as const satisfies readonly EffectiveContextSourceKind[];
const effectiveContext = z
  .object({
    providerId: provider,
    model: z.string().max(MAX_MODEL_CHARS),
    capturedAt: z.number().nonnegative(),
    window: z.discriminatedUnion("status", [
      z.object({ status: z.literal("unknown") }).strict(),
      z
        .object({
          status: z.literal("known"),
          maxInputTokens: z.number().int().nonnegative(),
          reservedOutputTokens: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
    sections: z
      .array(
        z
          .object({
            kind: z.enum(effectiveContextSectionKinds),
            items: z.number().int().nonnegative(),
            characters: z.number().int().nonnegative(),
            estimatedTokens: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(8),
    totals: z
      .object({ characters: z.number().int().nonnegative(), estimatedTokens: z.number().int().nonnegative() })
      .strict(),
    sources: z
      .array(
        z
          .object({
            kind: z.enum(effectiveContextSourceKinds),
            trust: z.enum(["application", "external", "user", "project"]),
            characters: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(16),
    tools: z
      .array(
        z
          .object({
            name: id,
            title: z.string().max(MAX_TITLE_CHARS),
            description: z.string().max(MAX_AI_TEXT_CHARS).optional(),
            group: z.enum(["container", "workspace", "other"]),
            gated: z.boolean(),
          })
          .strict(),
      )
      .max(256),
    permissionMode: z.enum(["ask", "remember", "allow"]),
    truncation: z.object({ applied: z.boolean(), omittedMessages: z.number().int().nonnegative() }).strict(),
  })
  .strict();
const threadUsage = z
  .object({
    requests: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    costs: z.array(money).max(16),
  })
  .strict();
const timelineItem = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      id,
      role: z.enum(["user", "assistant"]),
      content: z.string().max(MAX_AI_TEXT_CHARS),
      delivery: userMessageDelivery,
      status: assistantMessageStatus,
      skill: skillInvocationProvenance.optional(),
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
      artifact: toolArtifactReferenceSchema.optional(),
      message: z.string().max(MAX_AI_TEXT_CHARS).optional(),
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
      reason: z.string().max(MAX_AI_TEXT_CHARS),
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
      reason: z.string().max(MAX_AI_TEXT_CHARS),
    })
    .strict(),
  z
    .object({ kind: z.literal("error"), id, scope: threadErrorScope, message: z.string().max(MAX_AI_TEXT_CHARS) })
    .strict(),
  z
    .object({
      kind: z.literal("workspace-changes"),
      id,
      ...workspaceChangeSummarySchema.shape,
    })
    .strict(),
]);
export const threadView = z
  .object({
    threadId: id,
    phase: threadPhase,
    activeTaskId: id.optional(),
    activeSegmentId: id.optional(),
    lastSeq: z.number().int().nonnegative(),
    timeline: z.array(timelineItem).max(MAX_THREAD_TIMELINE_ITEMS),
    context: effectiveContext.optional(),
    usage: threadUsage.optional(),
    streamingAssistant: z
      .object({ id, timelineIndex: z.number().int().nonnegative(), content: z.string().max(MAX_AI_TEXT_CHARS) })
      .strict()
      .optional(),
  })
  .strict();

function streamingPointerConsistent(view: z.infer<typeof threadView>): boolean {
  const streaming = view.streamingAssistant;
  if (!streaming) return true;
  const item = view.timeline[streaming.timelineIndex];
  return (
    item?.kind === "message" && item.role === "assistant" && item.status === "streaming" && item.id === streaming.id
  );
}

function withinRecordBytes(record: unknown): boolean {
  try {
    return JSON.stringify(record).length <= MAX_THREAD_RECORD_BYTES;
  } catch {
    return false;
  }
}

// Durable thread record/file. Reuses threadView and adds the cross-field invariants the hand-written
// validators used to enforce: view.threadId === id, a consistent streaming-assistant pointer, and a
// per-record serialized-byte ceiling. parseThreadFile layers on the text-byte and unique-id checks.
export const threadCheckpointSchema = z
  .object({
    id,
    messageId: id,
    createdAt: z.number().nonnegative(),
    timelineLength: z.number().int().positive().max(MAX_THREAD_TIMELINE_ITEMS),
    modelHistoryLength: z.number().int().nonnegative().max(MAX_THREAD_MODEL_MESSAGES),
  })
  .strict();

export const threadLineageSchema = z
  .object({
    parentThreadId: id,
    parentCheckpointId: id,
  })
  .strict();

export const threadCompactionSourceSchema = z
  .object({
    historyStart: z.number().int().nonnegative().max(MAX_THREAD_MODEL_MESSAGES),
    historyEnd: z.number().int().positive().max(MAX_THREAD_MODEL_MESSAGES),
    messageStartId: id,
    messageEndId: id,
  })
  .strict();

export const threadCompactionSchema = z
  .object({
    id,
    createdAt: z.number().nonnegative(),
    source: threadCompactionSourceSchema,
    summary: z.string().trim().min(1).max(MAX_THREAD_COMPACTION_SUMMARY_CHARS),
    instructions: z.string().trim().min(1).max(MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS).optional(),
    providerId: optionalProvider,
    model,
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    contentTrust: z.enum(["application", "external", "user", "project"]),
    tainted: z.boolean(),
  })
  .strict()
  .refine((artifact) => artifact.source.historyStart < artifact.source.historyEnd, {
    message: "AI: Thread compaction source range is empty",
  })
  .refine((artifact) => artifact.tainted || !["external", "project"].includes(artifact.contentTrust), {
    message: "AI: untrusted Thread compaction must remain tainted",
  });

const threadRecordShape = z
  .object({
    version: z.literal(5),
    id,
    title: z.string().max(MAX_TITLE_CHARS),
    titleOrigin: z.enum(["default", "message", "user"]).optional(),
    createdAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    providerId: optionalProvider,
    model,
    accessProfile: accessProfileId,
    reasoningLevel,
    view: threadView,
    // Canonical AI-SDK model messages are opaque to core: bounded JSON only, never the AI SDK's own shapes.
    modelHistory: z.array(z.unknown()).max(MAX_THREAD_MODEL_MESSAGES),
    checkpoints: z.array(threadCheckpointSchema).max(MAX_THREAD_TIMELINE_ITEMS),
    lineage: threadLineageSchema.optional(),
    compactions: z.array(threadCompactionSchema).max(MAX_THREAD_COMPACTIONS),
    activeCompactionId: id.optional(),
  })
  .strict();

function checkpointsConsistent(record: z.infer<typeof threadRecordShape>): boolean {
  if (new Set(record.checkpoints.map((checkpoint) => checkpoint.id)).size !== record.checkpoints.length) return false;
  let timelineLength = 0;
  let modelHistoryLength = 0;
  for (const checkpoint of record.checkpoints) {
    if (
      checkpoint.timelineLength < timelineLength ||
      checkpoint.modelHistoryLength < modelHistoryLength ||
      checkpoint.timelineLength > record.view.timeline.length ||
      checkpoint.modelHistoryLength > record.modelHistory.length
    ) {
      return false;
    }
    const boundary = record.view.timeline[checkpoint.timelineLength - 1];
    if (boundary?.kind !== "message" || boundary.id !== checkpoint.messageId || boundary.delivery !== "applied") {
      return false;
    }
    timelineLength = checkpoint.timelineLength;
    modelHistoryLength = checkpoint.modelHistoryLength;
  }
  return true;
}

function compactionsConsistent(record: z.infer<typeof threadRecordShape>): boolean {
  if (new Set(record.compactions.map(({ id: compactionId }) => compactionId)).size !== record.compactions.length) {
    return false;
  }
  if (
    record.activeCompactionId &&
    !record.compactions.some(({ id: compactionId }) => compactionId === record.activeCompactionId)
  ) {
    return false;
  }
  let historyEnd = 0;
  for (const compaction of record.compactions) {
    if (compaction.source.historyEnd < historyEnd || compaction.source.historyEnd > record.modelHistory.length)
      return false;
    const checkpoint = record.checkpoints.find(
      (candidate) =>
        candidate.modelHistoryLength === compaction.source.historyEnd &&
        candidate.messageId === compaction.source.messageEndId,
    );
    const start = record.view.timeline.find(
      (item) => item.kind === "message" && item.id === compaction.source.messageStartId && item.delivery === "applied",
    );
    if (!checkpoint || !start) return false;
    historyEnd = compaction.source.historyEnd;
  }
  return true;
}

export const threadRecordSchema = threadRecordShape
  .refine((record) => record.view.threadId === record.id, { message: "AI: thread view/session id mismatch" })
  .refine((record) => streamingPointerConsistent(record.view), { message: "AI: streaming pointer inconsistent" })
  .refine(checkpointsConsistent, { message: "AI: Thread checkpoints are inconsistent" })
  .refine(compactionsConsistent, { message: "AI: Thread compactions are inconsistent" })
  .refine(withinRecordBytes, { message: "AI: thread record exceeds size limit" });

export const threadFileSchema = z
  .object({
    version: z.literal(5),
    records: z.array(threadRecordSchema).max(MAX_RETAINED_THREADS),
  })
  .strict()
  .refine((file) => new Set(file.records.map((record) => record.id)).size === file.records.length, {
    message: "AI: duplicate thread id",
  });

export const threadBranchPreviewSchema = z
  .object({
    source: threadSummarySchema,
    checkpoints: z.array(threadCheckpointSchema).max(MAX_THREAD_TIMELINE_ITEMS),
    bindings: z
      .object({
        providerId: optionalProvider,
        model,
        workspaceRoot: z.string().max(MAX_PERMISSION_KEY_CHARS).optional(),
        permissionMode: z.enum(["ask", "remember", "allow"]),
        contextPolicy: z.literal("application"),
        target: z.literal("host"),
      })
      .strict(),
    environmentRestored: z.literal(false),
  })
  .strict();

export const threadBranchResultSchema = z.object({ thread: threadSummarySchema, view: threadView }).strict();

const threadCompactionRevisionSchema = z
  .object({
    lastSeq: z.number().int().nonnegative(),
    modelHistoryLength: z.number().int().nonnegative().max(MAX_THREAD_MODEL_MESSAGES),
    activeCompactionId: id.optional(),
  })
  .strict();

const threadCompactionPlanSchema = z
  .object({
    source: threadCompactionSourceSchema,
    sourceHistoryMessages: z.number().int().positive().max(MAX_THREAD_MODEL_MESSAGES),
    retainedHistoryMessages: z.number().int().nonnegative().max(MAX_THREAD_MODEL_MESSAGES),
    replacesCompactionId: id.optional(),
    revision: threadCompactionRevisionSchema,
  })
  .strict()
  .refine((plan) => plan.sourceHistoryMessages === plan.source.historyEnd - plan.source.historyStart, {
    message: "AI: Thread compaction source count is inconsistent",
  });

const threadCompactionPreviewSchema = z
  .object({
    thread: threadSummarySchema,
    plan: threadCompactionPlanSchema,
    providerId: provider,
    model,
    active: threadCompactionSchema.optional(),
  })
  .strict();

const threadCompactionExecutionResultSchema = z
  .object({ thread: threadSummarySchema, view: threadView, compaction: threadCompactionSchema })
  .strict();

export const permissionRule = z
  .object({
    workspaceId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    targetId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("access-profile"), id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS) }).strict(),
      z.object({ kind: z.literal("worker"), id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS) }).strict(),
      z.object({ kind: z.literal("server"), id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS) }).strict(),
    ]),
    operation: z
      .object({
        kind: z.literal("tool"),
        id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
        serverId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS).optional(),
      })
      .strict(),
    normalizedArgs: z.string().max(MAX_PERMISSION_KEY_CHARS),
    contentTrustEpoch: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    addedAt: z.string().max(64).optional(),
  })
  .strict();
export const permissionsSnapshot = z
  .object({
    version: z.string().max(64),
    allowed: z.array(permissionRule).max(10_000),
    blocked: z.array(permissionRule).max(10_000),
    status: z.enum(["ok", "missing", "error"]),
    path: z.string().max(8_192),
  })
  .strict();

export const submitThreadResult = z
  .object({
    accepted: z.literal(true),
    threadId: id,
    taskId: id,
    mode: z.enum(["started", "interrupting", "queued", "duplicate"]),
    phase: threadPhase,
  })
  .strict();
export const resolveThreadApprovalResult = z.object({ accepted: z.boolean(), phase: threadPhase }).strict();

// Run projection. Where chat folds into a linear timeline, a Run folds into a task DAG: `dependsOn` carries
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
const runMoney = z.object({ amount: z.number().nonnegative(), currency: z.string().trim().min(1).max(16) }).strict();
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
    error: z.string().max(MAX_AI_TEXT_CHARS).optional(),
    // The model that ACTUALLY ran this task (resolved per-worker at dispatch, folded from the task-started event).
    // Only on the VIEW — the plan task (runTask) has no model, it is chosen when the task is dispatched. Absent
    // until the task starts; the UI-level multi-inference proof asserts ≥2 distinct values across completed tasks.
    model,
    provider: z.string().max(MAX_TITLE_CHARS).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cost: runMoney.optional(),
    startedAt: z.number().int().nonnegative().optional(),
    endedAt: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    toolCalls: z.number().int().nonnegative().optional(),
    toolResults: z
      .array(
        z
          .object({
            toolCallId: id,
            tool: id,
            title: z.string().max(MAX_TITLE_CHARS),
            args,
            ok: z.boolean(),
            result: z.unknown(),
          })
          .strict(),
      )
      .max(MAX_RUN_TASK_TOOL_RESULTS)
      .optional(),
    retries: z.number().int().nonnegative().optional(),
  })
  .strict();
// Cumulative run totals, not per-turn deltas — the reducer replaces rather than accumulates, so a dropped or
// replayed usage event can never double-count the budget the cost cap is enforced against.
const runUsage = z
  .object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() })
  .strict();
const runSpanStatus = z.enum([
  "running",
  "ok",
  "error",
  "cancelled",
  "timeout",
  "budget_exhausted",
  "rejected",
  "skipped",
  "unknown",
]);
const runSpanView = z
  .object({
    key: id,
    traceId: id,
    spanId: id,
    parentKey: id.optional(),
    attempt: z.number().int().positive(),
    kind: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(MAX_TITLE_CHARS),
    status: runSpanStatus,
    incomplete: z.boolean(),
    startUnixMs: z.number().int().nonnegative().optional(),
    endUnixMs: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    agent: z.string().max(MAX_TITLE_CHARS).optional(),
    taskId: id.optional(),
    taskTitle: z.string().max(MAX_TITLE_CHARS).optional(),
    model,
    provider: z.string().max(MAX_TITLE_CHARS).optional(),
    tool: id.optional(),
    phase: z.string().max(64).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cost: runMoney.optional(),
    retries: z.number().int().nonnegative().optional(),
    error: z.string().max(MAX_AI_TEXT_CHARS).optional(),
  })
  .strict();
const runSpanUpdate = z.object({ type: z.enum(["open", "close"]), span: runSpanView }).strict();
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
    reason: z.string().max(MAX_AI_TEXT_CHARS),
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
    spans: z.array(runSpanView).max(MAX_RUN_SPANS),
    spanBytes: z.number().int().nonnegative().max(MAX_RUN_SPAN_BYTES).optional(),
    droppedSpanRecords: z.number().int().nonnegative().optional(),
    approvals: z.array(runApproval).max(MAX_RUN_TASKS),
    synthesis: z.string().max(MAX_RUN_SYNTHESIS_CHARS),
    usage: runUsage,
    // The run's token budget (the cap `usage` is spent against). Threaded from the run's settings via the usage
    // event so the UI can render "spent / cap"; absent until the first usage event, then exact.
    maxTokens: z.number().int().positive().max(MAX_RUN_TOKEN_BUDGET).optional(),
    // The run-level failure (planning/synthesis/transport), so the error screen can say WHY it failed and offer a
    // way out — a task-scoped fault is recorded on the task instead. Set when phase becomes "error".
    error: z
      .object({ scope: runErrorScope, message: z.string().max(MAX_AI_TEXT_CHARS) })
      .strict()
      .optional(),
    planPending: z.boolean(),
  })
  .strict();

export const startRunResult = z.object({ accepted: z.literal(true), runId: id, phase: runPhase }).strict();
export const resolveRunPlanResult = z.object({ accepted: z.boolean(), phase: runPhase }).strict();

export const runEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("phase-changed"), phase: runPhase }).strict(),
  z.object({ type: z.literal("plan-ready"), tasks: z.array(runTask).max(MAX_RUN_TASKS) }).strict(),
  z.object({ type: z.literal("plan-resolved"), decision: approvalDecision }).strict(),
  z.object({ type: z.literal("task-started"), taskId: id, model }).strict(),
  z.object({ type: z.literal("task-delta"), taskId: id, text: z.string().max(MAX_RUN_TASK_OUTPUT_CHARS) }).strict(),
  z.object({ type: z.literal("task-completed"), taskId: id }).strict(),
  z.object({ type: z.literal("task-failed"), taskId: id, message: z.string().max(MAX_AI_TEXT_CHARS) }).strict(),
  z.object({ type: z.literal("task-skipped"), taskId: id, reason: z.string().max(MAX_AI_TEXT_CHARS) }).strict(),
  z
    .object({
      type: z.literal("task-metrics"),
      taskId: id,
      model,
      provider: z.string().max(MAX_TITLE_CHARS).optional(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      cost: runMoney.optional(),
      startedAt: z.number().int().nonnegative().optional(),
      endedAt: z.number().int().nonnegative().optional(),
      durationMs: z.number().nonnegative().optional(),
      toolCalls: z.number().int().nonnegative().optional(),
      retries: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal("span-open"), span: runSpanView }).strict(),
  z.object({ type: z.literal("span-close"), span: runSpanView }).strict(),
  z
    .object({
      type: z.literal("span-batch"),
      updates: z.array(runSpanUpdate).max(MAX_RUN_SPAN_BATCH),
      dropped: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("task-tool-result"),
      taskId: id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      ok: z.boolean(),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-approval-request"),
      approvalId: id,
      taskId: id,
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      args,
      reason: z.string().max(MAX_AI_TEXT_CHARS),
    })
    .strict(),
  z.object({ type: z.literal("tool-approval-resolved"), approvalId: id, decision: approvalDecision }).strict(),
  z.object({ type: z.literal("synthesis-delta"), text: z.string().max(MAX_RUN_SYNTHESIS_CHARS) }).strict(),
  z
    .object({
      type: z.literal("usage"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      // The run's token budget, carried on the usage stream so the view can render "spent / cap".
      maxTokens: z.number().int().positive().max(MAX_RUN_TOKEN_BUDGET).optional(),
    })
    .strict(),
  z.object({ type: z.literal("run-complete"), finishReason: z.string().max(MAX_TITLE_CHARS) }).strict(),
  z.object({ type: z.literal("run-stopped") }).strict(),
  z.object({ type: z.literal("error"), scope: runErrorScope, message: z.string().max(MAX_AI_TEXT_CHARS) }).strict(),
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
  [AI_CHANNELS.diagnostics]: z
    .object({
      capturedAt: z.number().nonnegative(),
      provider: z
        .object({
          id: provider,
          kind: z.enum(["local", "anthropic", "openai", "openai-compatible"]),
          model: z.string().max(MAX_MODEL_CHARS),
          destination: z.enum(["local", "cloud"]),
          credential: z.enum(["not-required", "stored", "missing"]),
          reachability: z.enum(["reachable", "unreachable", "not-checked"]),
          modelCount: z.number().int().nonnegative().max(10_000).optional(),
          message: z.string().max(512).optional(),
        })
        .strict(),
      security: z
        .object({
          encryption: z
            .object({ available: z.boolean(), backend: z.string().max(256).optional(), degraded: z.boolean() })
            .strict(),
          permissions: z.enum(["ok", "missing", "error", "unavailable"]),
          webSearch: z.enum(["enabled", "disabled", "unavailable"]),
        })
        .strict(),
      capabilities: z
        .object({
          agentSessions: z.boolean(),
          teamRuns: z.boolean(),
          sandbox: z.boolean(),
          containerTools: z.boolean(),
          workspaceTools: z.boolean(),
          executionTargets: z.boolean(),
        })
        .strict(),
      extensions: z
        .object({
          skills: z
            .object({
              state: z.enum(["ok", "warning", "error", "unavailable"]),
              count: z.number().int().nonnegative(),
              diagnostics: z.number().int().nonnegative(),
            })
            .strict(),
          mcp: z.object({ state: z.literal("unavailable") }).strict(),
        })
        .strict(),
      recentErrors: z
        .array(
          z
            .object({
              at: z.number().nonnegative(),
              message: z.string().max(512),
              context: z.string().max(MAX_ID_CHARS).optional(),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  [AI_CHANNELS.keyHas]: z.boolean(),
  [AI_CHANNELS.keySet]: ok,
  [AI_CHANNELS.keyClear]: ok,
  [AI_CHANNELS.threadList]: z.array(threadSummarySchema).max(MAX_RETAINED_THREADS),
  [AI_CHANNELS.threadCreate]: threadSummarySchema,
  [AI_CHANNELS.threadRename]: threadSummarySchema,
  [AI_CHANNELS.threadConfigure]: threadSummarySchema,
  [AI_CHANNELS.threadBranchPreview]: threadBranchPreviewSchema,
  [AI_CHANNELS.threadBranch]: threadBranchResultSchema,
  [AI_CHANNELS.threadCompactionPreview]: threadCompactionPreviewSchema,
  [AI_CHANNELS.threadCompact]: threadCompactionExecutionResultSchema,
  [AI_CHANNELS.threadSubmit]: submitThreadResult,
  [AI_CHANNELS.threadResolveApproval]: resolveThreadApprovalResult,
  [AI_CHANNELS.threadStop]: ok,
  [AI_CHANNELS.threadSnapshot]: threadView.nullable(),
  [AI_CHANNELS.toolArtifactGet]: toolArtifactRecordSchema,
  [AI_CHANNELS.threadDelete]: ok,
  [AI_CHANNELS.changesStatus]: workspaceChangeStatusSchema,
  [AI_CHANNELS.changesDiff]: workspaceDiffSchema,
  [AI_CHANNELS.projectContextSnapshot]: projectContextSnapshotSchema,
  [AI_CHANNELS.projectRulesSetEnabled]: projectContextSnapshotSchema,
  [AI_CHANNELS.projectRulesInitialize]: z
    .object({ result: z.enum(["created", "exists"]), snapshot: projectContextSnapshotSchema })
    .strict(),
  [AI_CHANNELS.projectMemoryAdd]: projectContextSnapshotSchema,
  [AI_CHANNELS.projectMemoryRemove]: projectContextSnapshotSchema,
  [AI_CHANNELS.projectMemoryClear]: projectContextSnapshotSchema,
  [AI_CHANNELS.projectMemoryImport]: projectContextSnapshotSchema,
  [AI_CHANNELS.runStart]: startRunResult,
  [AI_CHANNELS.runCancel]: ok,
  [AI_CHANNELS.runApprovePlan]: resolveRunPlanResult,
  [AI_CHANNELS.runApproveTool]: resolveRunPlanResult,
  [AI_CHANNELS.runSnapshot]: runView.nullable(),
  [AI_CHANNELS.runList]: z.object({ runs: z.array(runView).max(MAX_ACTIVE_RUNS) }).strict(),
  [AI_CHANNELS.workersList]: workersResult,
  [AI_CHANNELS.workersSave]: workersResult,
  [AI_CHANNELS.workersRemove]: workersResult,
  [AI_CHANNELS.avatarsList]: avatarsResult,
  [AI_CHANNELS.avatarsSave]: avatarsResult,
  [AI_CHANNELS.avatarsRemove]: avatarsResult,
  [AI_CHANNELS.modelsList]: z
    .object({ models: z.array(z.object({ id: z.string().trim().min(1).max(MAX_MODEL_CHARS) }).strict()).max(10_000) })
    .strict(),
  [AI_CHANNELS.modelsCancel]: ok,
  [AI_CHANNELS.permissionsList]: permissionsSnapshot,
  [AI_CHANNELS.permissionsRemove]: permissionsSnapshot,
  [AI_CHANNELS.skillsSnapshot]: skillHostSnapshot,
  [AI_CHANNELS.skillsReload]: skillHostSnapshot,
  [AI_CHANNELS.skillsSetProjectSource]: skillHostSnapshot,
  [AI_CHANNELS.skillsSetProjectTrust]: skillHostSnapshot,
  [AI_CHANNELS.skillsInvoke]: submitThreadResult,
} satisfies Record<AIInvokeChannel, z.ZodType>;

export const threadEvent = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("phase-changed"),
      phase: threadPhase,
    })
    .strict(),
  z
    .object({
      type: z.literal("user-message"),
      id,
      content: z.string().max(MAX_AI_TEXT_CHARS),
      delivery: userMessageDelivery,
      skill: skillInvocationProvenance.optional(),
    })
    .strict(),
  z.object({ type: z.literal("user-message-applied"), id }).strict(),
  z.object({ type: z.literal("user-message-discarded"), id }).strict(),
  z.object({ type: z.literal("assistant-start"), id }).strict(),
  z.object({ type: z.literal("assistant-delta"), id, text: z.string().max(MAX_AI_TEXT_CHARS) }).strict(),
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
      artifact: toolArtifactReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-error"),
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      message: z.string().max(MAX_AI_TEXT_CHARS),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-denied"),
      toolCallId: id,
      tool: id,
      title: z.string().max(MAX_TITLE_CHARS),
      reason: z.string().max(MAX_AI_TEXT_CHARS),
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
      reason: z.string().max(MAX_AI_TEXT_CHARS),
    })
    .strict(),
  z.object({ type: z.literal("approval-resolved"), approvalId: id, decision: approvalDecision }).strict(),
  z.object({ type: z.literal("context"), context: effectiveContext }).strict(),
  z
    .object({
      type: z.literal("usage"),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      cost: money.optional(),
    })
    .strict(),
  z.object({ type: z.literal("task-complete"), finishReason: z.string().max(MAX_TITLE_CHARS) }).strict(),
  z.object({ type: z.literal("task-stopped") }).strict(),
  z.object({ type: z.literal("workspace-changes"), summary: workspaceChangeSummarySchema }).strict(),
  z
    .object({
      type: z.literal("error"),
      scope: threadErrorScope,
      message: z.string().max(MAX_AI_TEXT_CHARS),
    })
    .strict(),
]);

export const threadEventEnvelope = z
  .object({
    version: z.literal(1),
    threadId: id,
    taskId: id.optional(),
    segmentId: id.optional(),
    seq: z.number().int().nonnegative(),
    event: threadEvent,
  })
  .strict();

export const pushSchemas = {
  [AI_CHANNELS.threadEvent]: threadEventEnvelope,
  [AI_CHANNELS.runEvent]: runEventEnvelope,
  [AI_CHANNELS.skillsChanged]: skillHostSnapshot,
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
