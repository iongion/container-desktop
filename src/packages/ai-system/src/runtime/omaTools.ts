import {
  type ContentBlock,
  defineTool,
  type ToolCallContext,
  type ToolCallDecision,
  type ToolCallGate,
  type ToolDefinition,
  type ToolUseContext,
} from "@open-multi-agent/core";
import { z } from "zod";
import { toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";
import { describeError } from "@/ai-system/core/errors";
import {
  cachedVerdict,
  normalizePermissionArguments,
  type PermissionsStoreLike,
  resolveToolAction,
  resolveWorkerToolAction,
  toolKey,
  toolRule,
} from "@/ai-system/core/permissions";
import type { RunEvent, RunPlanTask } from "@/ai-system/core/runEvents";
import type { ToolArtifactReference } from "@/ai-system/core/toolArtifacts";
import type { ApprovalDecision, ResolvedWorker, TeamRunTaskSettings } from "@/ai-system/core/types";
import { buildContainerToolset } from "@/ai-system/runtime/tools/containerToolset";
import {
  filterToolset,
  mergeToolsets,
  serializeToolset,
  type ToolRunResult,
  type Toolset,
} from "@/ai-system/runtime/tools/toolset";
import { buildWorkspaceToolset } from "@/ai-system/runtime/tools/workspaceToolset";
import { randomUUID } from "@/utils/randomUUID";

type OmaToolResultObserver = (
  name: string,
  result: ToolRunResult,
  context: ToolUseContext,
  input: unknown,
) => ToolArtifactReference | undefined | Promise<ToolArtifactReference | undefined>;

export function buildCustomTools(toolset: Toolset, onResult?: OmaToolResultObserver): ToolDefinition[] {
  return toolset.defs.map((definition) => {
    // OMA's public type surface names its bundled Zod-3 schema, while the app owns Zod 4. ToolExecutor only uses
    // safeParse here, and llmInputSchema bypasses OMA's Zod converter, so this is the narrow structural seam.
    const inputSchema = z.custom<Record<string, unknown>>(
      (input) => toolset.validate(definition.name, input).ok,
    ) as unknown as ToolDefinition<Record<string, unknown>>["inputSchema"];
    return defineTool({
      name: definition.name,
      description: definition.description,
      inputSchema,
      llmInputSchema: definition.inputSchema,
      async execute(input, context) {
        if (context.abortSignal?.aborted) return { data: "Tool call aborted", isError: true };
        const parsed = toolset.validate(definition.name, input);
        if (!parsed.ok) return { data: parsed.error, isError: true };
        let result: ToolRunResult;
        try {
          result = await toolset.run(definition.name, parsed.value);
        } catch (error) {
          result = { ok: false, result: null, summary: describeError(error) };
        }
        const artifact = await onResult?.(definition.name, result, context, parsed.value);
        const modelResult = artifact
          ? { summary: result.summary ?? null, artifactId: artifact.id }
          : (result.summary ?? null);
        return { data: JSON.stringify(modelResult), isError: !result.ok };
      },
    });
  });
}

interface OmaToolCallSideChannel {
  capture(agentName: string, taskId: string | undefined, content: readonly ContentBlock[]): void;
  claim(context: ToolCallContext): string;
  complete(name: string, input: unknown, context: ToolUseContext): string;
  discard(context: ToolCallContext): void;
}

function callKey(agentName: string, taskId: string | undefined, name: string, input: unknown): string {
  return [agentName, taskId ?? "", name, normalizePermissionArguments(input)].join("\u0000");
}

function executionKey(agentName: string, taskId: string | undefined, name: string): string {
  return [agentName, taskId ?? "", name].join("\u0000");
}

function takeCall(calls: Map<string, string[]>, key: string): string | undefined {
  const queue = calls.get(key);
  const id = queue?.shift();
  if (queue?.length === 0) calls.delete(key);
  return id;
}

export function createOmaToolCallSideChannel(): OmaToolCallSideChannel {
  const pending = new Map<string, string[]>();
  const executing = new Map<string, string[]>();
  return {
    capture(agentName, taskId, content) {
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        const key = callKey(agentName, taskId, block.name, block.input);
        pending.set(key, [...(pending.get(key) ?? []), block.id]);
      }
    },
    claim(context) {
      const key = callKey(context.agentName, context.taskId, context.toolName, context.input);
      const id = takeCall(pending, key) ?? randomUUID();
      const activeKey = executionKey(context.agentName, context.taskId, context.toolName);
      executing.set(activeKey, [...(executing.get(activeKey) ?? []), id]);
      return id;
    },
    complete(name, input, context) {
      const activeKey = executionKey(context.agent.name, context.taskId, name);
      const pendingKey = callKey(context.agent.name, context.taskId, name, input);
      return takeCall(executing, activeKey) ?? takeCall(pending, pendingKey) ?? randomUUID();
    },
    discard(context) {
      takeCall(executing, executionKey(context.agentName, context.taskId, context.toolName));
    },
  };
}

export function buildOmaWorkerToolset(settings: TeamRunTaskSettings, worker?: ResolvedWorker): Toolset | null {
  const execution = worker?.execution ?? settings.execution;
  const merged = mergeToolsets([
    execution.engineOps ? buildContainerToolset(execution.engineOps) : null,
    execution.workspaceAccess ? buildWorkspaceToolset(execution.workspaceAccess) : null,
  ]);
  if (!merged) return null;
  const available = worker?.allowedTools ? filterToolset(merged, worker.allowedTools) : merged;
  return available ? serializeToolset(available) : null;
}

interface OmaToolGateController {
  readonly onToolCall: ToolCallGate;
  markTainted(taskId: string | undefined): void;
  seedPlanTaint(tasks: readonly RunPlanTask[]): void;
  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean;
  rejectPending(): void;
}

interface OmaToolGateOptions {
  settings: TeamRunTaskSettings;
  workersByAgent: ReadonlyMap<string, ResolvedWorker | undefined>;
  toolsetsByAgent: ReadonlyMap<string, Toolset>;
  permissionsStore?: PermissionsStoreLike;
  toolCalls?: OmaToolCallSideChannel;
  emit: (event: RunEvent) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function makeOmaToolGate(options: OmaToolGateOptions): OmaToolGateController {
  const pending = new Map<string, (decision: ApprovalDecision) => void>();
  const taintedTasks = new Set<string>();

  const onToolCall = async (context: ToolCallContext): Promise<ToolCallDecision> => {
    const toolset = options.toolsetsByAgent.get(context.agentName);
    if (!toolset?.has(context.toolName)) return { action: "deny", reason: "Tool is not available" };
    if (!context.taskId) return { action: "deny", reason: "Tool call has no task context" };
    const parsed = toolset.validate(context.toolName, context.input);
    if (!parsed.ok) return { action: "deny", reason: parsed.error };
    const worker = options.workersByAgent.get(context.agentName);
    const permissionContext = worker?.permissionContext ?? options.settings.permissionContext;
    const toolCallId = options.toolCalls?.claim(context) ?? randomUUID();
    const requiresGate = worker?.policy === "ask" || toolset.gated(context.toolName);
    if (!requiresGate) return { action: "allow" };

    const cached =
      options.settings.permissions && permissionContext
        ? cachedVerdict(options.settings.permissions, toolKey(permissionContext, context.toolName, parsed.value))
        : undefined;
    const floorBlocked = toolCommandFloorBlocked(parsed.value, worker?.floorScope ?? "strict");
    const action = worker
      ? resolveWorkerToolAction({
          policy: worker.policy,
          runMode: options.settings.permissionMode,
          floorBlocked,
          cached,
          tainted: taintedTasks.has(context.taskId),
        })
      : resolveToolAction({
          mode: options.settings.permissionMode,
          floorBlocked,
          cached,
          tainted: taintedTasks.has(context.taskId),
        });
    if (action === "run") return { action: "allow" };
    if (action === "reject") {
      options.toolCalls?.discard(context);
      return { action: "deny", reason: "Blocked by the app permission policy" };
    }

    const approvalId = randomUUID();
    const title = toolset.title(context.toolName);
    options.emit({
      type: "tool-approval-request",
      approvalId,
      taskId: context.taskId,
      toolCallId,
      tool: context.toolName,
      title,
      args: asRecord(parsed.value),
      reason: `Approve ${title}?`,
    });
    const decision = await new Promise<ApprovalDecision>((resolve) => pending.set(approvalId, resolve));
    pending.delete(approvalId);
    options.emit({ type: "tool-approval-resolved", approvalId, decision });
    if (
      options.settings.permissionMode === "remember" &&
      worker?.policy !== "ask" &&
      options.permissionsStore &&
      permissionContext
    ) {
      await options.permissionsStore.addCommand(
        decision === "allow" ? "allowed" : "blocked",
        toolRule(permissionContext, context.toolName, parsed.value),
      );
    }
    if (decision === "allow") return { action: "allow" };
    options.toolCalls?.discard(context);
    return { action: "deny", reason: "Tool call rejected by the user" };
  };

  return {
    onToolCall,
    markTainted(taskId) {
      if (taskId) taintedTasks.add(taskId);
    },
    seedPlanTaint(tasks) {
      for (const task of tasks) {
        if (task.dependsOn.length > 0) taintedTasks.add(task.id);
      }
    },
    resolveApproval(approvalId, decision) {
      const resolve = pending.get(approvalId);
      if (!resolve) return false;
      resolve(decision);
      return true;
    },
    rejectPending() {
      for (const resolve of pending.values()) resolve("reject");
      pending.clear();
    },
  };
}
