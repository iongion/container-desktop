import { z } from "zod";
import { PI_THINKING_LEVELS } from "@/pi-bridge/protocol";
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
  MAX_DIAGNOSTICS_BUNDLE_CHARS,
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

const MAX_ID_CHARS = 256;
const MAX_PROVIDER_CHARS = 64;
const MAX_MODEL_CHARS = 512;
const MAX_TITLE_CHARS = 256;
const MAX_PERMISSION_KEY_CHARS = 8_192;
// An engine failure message is the engine's own text, which the model reads to decide what to do next. Long
// enough to keep a CLI error intact, short enough that a runaway one cannot flood a tool result.
const MAX_ENGINE_OP_ERROR_CHARS = 4_096;
const MAX_CREDENTIAL_CHARS = 16_384;

const id = z.string().trim().min(1).max(MAX_ID_CHARS);
const provider = z
  .string({ error: "AI: invalid provider id" })
  .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/i, "AI: invalid provider id")
  .max(MAX_PROVIDER_CHARS, "AI: invalid provider id");
const optionalProvider = provider.optional();
const model = z.string().max(MAX_MODEL_CHARS).optional();
const empty = z.undefined();
const _threadId = z.object({ threadId: id }).strict();

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
    bundle: diagnosticsBundle.optional(),
  })
  .strict();

export const approvalDecision = z.enum(["allow", "reject"]);
export const resolveThreadApprovalRequest = z
  .object({ threadId: id, approvalId: id, decision: approvalDecision })
  .strict();
export const permissionsList = z.enum(["allowed", "blocked"]);

// One remembered allow/reject, scoped to a workspace, target, authority subject, typed operation, normalized
// arguments and trust epoch. Declared up here because the invoke registry below validates it on the wire.
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

// A worker's stored shape. The library that edited these is gone, but the record still types the execution
// target an off-host workspace is resolved from, and the tool-policy vocabulary the permission policy reads.
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

// One container operation the agent asked the app to run. The op name is validated against the real container
// tool list by the dispatcher, so this only has to bound the strings; `args` stays open because twenty-one
// operations take twenty-one argument shapes and restating them here would be a second source of truth.
const engineOpRequest = z
  .object({
    op: z.string().min(1).max(MAX_TITLE_CHARS),
    args: z.record(z.string(), z.unknown()).optional(),
    // The connection the asking session runs on, used only when the operation did not name one.
    defaultConnectionId: z.string().max(MAX_ID_CHARS).optional(),
  })
  .strict();

// Answered as a value, not by throwing: a blocked agent is waiting on this, so a failure has to come back as a
// reason it can act on rather than a rejected invoke the renderer would have to translate.
const engineOpResult = z.union([
  z.object({ ok: z.literal(true), value: z.unknown().optional() }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(MAX_ENGINE_OP_ERROR_CHARS) }).strict(),
]);

// One public-web query. Bounded because it is model-authored text on its way to a URL; the adapter redacts it
// before it leaves the device and rejects an empty one.
const webSearchRequest = z.object({ query: z.string().trim().min(1).max(MAX_TITLE_CHARS) }).strict();

// The page text the agent reads. Bounded ABOVE the adapter's own 96 KB download cap rather than at the
// model-facing text limit: a legitimate result must not be rejected here, and pi already truncates long tool
// output inside the container — writing the full text to a file the card can read back — so the model-facing
// decision belongs there and not in this channel.
const webSearchResult = z.object({ text: z.string().max(128 * 1024) }).strict();

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
  // The file name is session-scoped, not a path: the host decides where its private agent directory is, so a
  // caller cannot aim this write anywhere else.
  [AI_CHANNELS.agentGatewayEnv]: z
    .object({
      provider,
      fileName: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9._-]+\.env$/, "AI: the gateway env file name must be a simple <name>.env"),
      baseUrl: z.url().max(2048),
      bridgeToken: z.string().trim().min(1).max(256),
      gatewayPort: z.number().int().positive().max(65535),
    })
    .strict(),
  [AI_CHANNELS.agentEnvFile]: z
    .object({
      // The same naming rule as the gateway's: a simple <name>.env, never a path. Both writers refuse anything else
      // in the native realm too — this is the first of the two checks, not the only one.
      fileName: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9._-]+\.env$/, "AI: the agent env file name must be a simple <name>.env"),
      // The whole env body. Bounded well above what the agent needs, and far below anything that would be a file
      // rather than an environment.
      contents: z.string().min(1).max(65536),
    })
    .strict(),
  [AI_CHANNELS.changesStatus]: empty,
  [AI_CHANNELS.changesDiff]: empty,
  [AI_CHANNELS.projectContextSnapshot]: empty,
  [AI_CHANNELS.projectRulesSetEnabled]: z.object({ enabled: z.boolean() }).strict(),
  [AI_CHANNELS.projectRulesInitialize]: empty,
  [AI_CHANNELS.projectMemoryAdd]: z.object({ content: projectMemoryContent }).strict(),
  [AI_CHANNELS.projectMemoryRemove]: z.object({ id }).strict(),
  [AI_CHANNELS.projectMemoryClear]: empty,
  [AI_CHANNELS.projectMemoryImport]: z.string().max(PROJECT_CONTEXT_LIMITS.storeBytes),
  [AI_CHANNELS.modelsList]: z.object({ providerId: optionalProvider, requestId: id }).strict(),
  [AI_CHANNELS.modelsCancel]: z.object({ requestId: id }).strict(),
  [AI_CHANNELS.modelWindow]: z
    .object({ providerId: optionalProvider, model: z.string().trim().min(1).max(MAX_MODEL_CHARS) })
    .strict(),
  [AI_CHANNELS.engineOp]: engineOpRequest,
  [AI_CHANNELS.webSearch]: webSearchRequest,
  [AI_CHANNELS.permissionsList]: empty,
  [AI_CHANNELS.permissionsAdd]: z.object({ list: permissionsList, rule: permissionRule }).strict(),
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
          // Whether that reservation is the provider's published cap or our own default standing in for one.
          reservedFromProvider: z.boolean(),
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
  // Something the TURN did that the transcript would otherwise have nothing to show for. A code, not prose: the
  // projector is pure and cannot translate, so the renderer owns the words.
  z.object({ kind: z.literal("notice"), id, notice: z.enum(["empty-answer", "output-cap"]) }).strict(),
  z
    .object({
      kind: z.literal("workspace-changes"),
      id,
      ...workspaceChangeSummarySchema.shape,
    })
    .strict(),
  // Data a plugin published for the GUI: `pi.appendEntry` or a custom `pi.sendMessage`. The customType is
  // the card key, and `data` is the plugin's own payload — unknown by design, rendered as inspectable JSON
  // until a card claims that type.
  z
    .object({
      kind: z.literal("data"),
      id,
      customType: z.string().min(1).max(MAX_TITLE_CHARS),
      data: z.unknown().optional(),
      text: z.string().max(MAX_AI_TEXT_CHARS).optional(),
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

// A resolved skill, rendered but not yet sent. The host owns resolution — the trust check, the fingerprint
// match and the prompt template — and the renderer owns submission, because the agent lives on the pi bridge
// rather than behind this broker.
export const skillInvocationResult = z
  .object({
    prompt: z.string().max(SKILL_LIMITS.renderedPromptBytes),
    displayContent: z.string().max(MAX_TITLE_CHARS),
    skill: z
      .object({
        skillId: id,
        command: z.string().max(MAX_TITLE_CHARS),
        source: z.enum(["bundled", "user", "project"]),
        fingerprint: skillFingerprint,
      })
      .strict(),
    // The skill's declared `allowed-tools`, absent when it declared none.
    allowedTools: z.array(z.string().trim().min(1).max(MAX_TITLE_CHARS)).max(MAX_WORKER_ALLOWED_TOOLS).optional(),
    // The source is not one the user has vouched for, so its instructions are untrusted for the turn.
    initialTaint: z.boolean().optional(),
  })
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
  [AI_CHANNELS.agentGatewayEnv]: z.object({ path: z.string().min(1).max(4096) }).strict(),
  [AI_CHANNELS.agentEnvFile]: z.object({ path: z.string().min(1).max(4096) }).strict(),
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
  [AI_CHANNELS.modelsList]: z
    .object({ models: z.array(z.object({ id: z.string().trim().min(1).max(MAX_MODEL_CHARS) }).strict()).max(10_000) })
    .strict(),
  [AI_CHANNELS.modelsCancel]: ok,
  // Every field absent means the provider did not say — rendered as "unknown", never as a confident number.
  [AI_CHANNELS.modelWindow]: z
    .object({
      contextWindow: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      // Dollars per million tokens, so fractional by nature — a rate of 0.01 is a real price, not a rounding error.
      pricing: z
        .object({
          input: z.number().nonnegative(),
          output: z.number().nonnegative(),
          cacheRead: z.number().positive().optional(),
          cacheWrite: z.number().positive().optional(),
        })
        .strict()
        .optional(),
      // Present only when a provider published a reasoning capability for this model. An empty object still says
      // "it reasons" — the levels are how hard it may be asked to, which not every provider names.
      reasoning: z
        .object({
          levels: z.array(z.enum(PI_THINKING_LEVELS)).max(PI_THINKING_LEVELS.length).optional(),
          mandatory: z.boolean().optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  [AI_CHANNELS.engineOp]: engineOpResult,
  [AI_CHANNELS.webSearch]: webSearchResult,
  [AI_CHANNELS.permissionsList]: permissionsSnapshot,
  [AI_CHANNELS.permissionsAdd]: permissionsSnapshot,
  [AI_CHANNELS.permissionsRemove]: permissionsSnapshot,
  [AI_CHANNELS.skillsSnapshot]: skillHostSnapshot,
  [AI_CHANNELS.skillsReload]: skillHostSnapshot,
  [AI_CHANNELS.skillsSetProjectSource]: skillHostSnapshot,
  [AI_CHANNELS.skillsSetProjectTrust]: skillHostSnapshot,
  [AI_CHANNELS.skillsInvoke]: skillInvocationResult,
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
