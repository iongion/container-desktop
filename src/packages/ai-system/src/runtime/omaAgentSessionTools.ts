import type { LLMResponse, ToolCallContext, ToolCallDecision } from "@open-multi-agent/core";
import { toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";
import { describeError } from "@/ai-system/core/errors";
import { cachedVerdict, resolveToolAction, toolKey, toolRule } from "@/ai-system/core/permissions";
import type { ThreadEvent } from "@/ai-system/core/threadEvents";
import { prepareToolResultForTimeline, type ToolArtifactReference } from "@/ai-system/core/toolArtifacts";
import type { AgentSessionCreationOptions, AgentSessionTaskSettings, ApprovalDecision } from "@/ai-system/core/types";
import { asRecord } from "@/ai-system/runtime/omaSessionMessages";
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

interface AgentSessionToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface OmaAgentSessionToolControllerOptions {
  threadId: string;
  permissionsStore: AgentSessionCreationOptions["permissionsStore"];
  storeToolArtifact: AgentSessionCreationOptions["storeToolArtifact"];
  logger: AgentSessionCreationOptions["logger"];
  emit: (event: ThreadEvent) => void;
  abortTask: () => void;
}

function taskToolset(task: AgentSessionTaskSettings): Toolset | null {
  const execution = task.execution;
  const merged = mergeToolsets([
    execution.engineOps ? buildContainerToolset(execution.engineOps) : null,
    execution.workspaceAccess ? buildWorkspaceToolset(execution.workspaceAccess) : null,
  ]);
  if (!merged) return null;
  const available = task.allowedTools ? filterToolset(merged, task.allowedTools) : merged;
  return available ? serializeToolset(available) : null;
}

export class OmaAgentSessionToolController {
  private task: AgentSessionTaskSettings;
  private currentToolset: Toolset | null;
  private readonly approvals = new Map<string, (decision: ApprovalDecision) => void>();
  private readonly unclaimedToolCalls: AgentSessionToolCall[] = [];
  private readonly approvedToolCalls: AgentSessionToolCall[] = [];
  private gateTail = Promise.resolve();
  private currentFatalError: Extract<ThreadEvent, { type: "error" }> | null = null;
  private tainted = false;

  constructor(
    task: AgentSessionTaskSettings,
    private readonly options: OmaAgentSessionToolControllerOptions,
  ) {
    this.task = task;
    this.currentToolset = taskToolset(task);
  }

  get toolset(): Toolset | null {
    return this.currentToolset;
  }

  get fatalError(): Extract<ThreadEvent, { type: "error" }> | null {
    return this.currentFatalError;
  }

  reset(task: AgentSessionTaskSettings, tainted: boolean): void {
    this.task = task;
    this.currentToolset = taskToolset(task);
    this.currentFatalError = null;
    this.tainted = tainted;
  }

  captureToolCalls(response: LLMResponse): void {
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      this.unclaimedToolCalls.push({ id: block.id, name: block.name, input: asRecord(block.input) });
    }
  }

  async onToolResult(name: string, result: ToolRunResult): Promise<ToolArtifactReference | undefined> {
    const index = this.approvedToolCalls.findIndex((call) => call.name === name);
    const call = index >= 0 ? this.approvedToolCalls.splice(index, 1)[0] : this.claimToolCall(name, {});
    const prepared = prepareToolResultForTimeline(result.result);
    let artifact: ToolArtifactReference | undefined;
    if (prepared.artifactPayload && this.options.storeToolArtifact) {
      try {
        artifact = await this.options.storeToolArtifact({
          threadId: this.options.threadId,
          toolCallId: call.id,
          tool: name,
          ...prepared.artifactPayload,
        });
      } catch (error) {
        this.options.logger?.error("AI: large tool result could not be retained", error);
      }
    }
    this.tainted = true;
    this.options.emit({
      type: "tool-result",
      toolCallId: call.id,
      tool: name,
      title: this.currentToolset?.title(name) ?? name,
      ok: result.ok,
      result: prepared.result,
      ...(artifact ? { artifact } : {}),
    });
    return artifact;
  }

  queueToolGate(context: ToolCallContext): Promise<ToolCallDecision> {
    const decision = this.gateTail.then(() => this.decideToolCall(context));
    this.gateTail = decision.then(
      () => undefined,
      () => undefined,
    );
    return decision;
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): boolean {
    const resolve = this.approvals.get(approvalId);
    if (!resolve) return false;
    resolve(decision);
    return true;
  }

  rejectApprovals(): void {
    for (const resolve of this.approvals.values()) resolve("reject");
    this.approvals.clear();
  }

  private claimToolCall(name: string, input: Record<string, unknown>): AgentSessionToolCall {
    const index = this.unclaimedToolCalls.findIndex((call) => call.name === name);
    if (index >= 0) return this.unclaimedToolCalls.splice(index, 1)[0];
    return { id: randomUUID(), name, input };
  }

  private async decideToolCall(context: ToolCallContext): Promise<ToolCallDecision> {
    const toolset = this.currentToolset;
    const call = this.claimToolCall(context.toolName, context.input);
    if (!toolset?.has(context.toolName)) {
      this.options.emit({
        type: "tool-denied",
        toolCallId: call.id,
        tool: context.toolName,
        title: context.toolName,
        reason: "Unknown tool",
      });
      return { action: "deny", reason: "Tool is not available" };
    }
    const parsed = toolset.validate(context.toolName, context.input);
    if (!parsed.ok) {
      this.options.emit({
        type: "tool-error",
        toolCallId: call.id,
        tool: context.toolName,
        title: toolset.title(context.toolName),
        message: parsed.error,
      });
      return { action: "deny", reason: parsed.error };
    }
    const action = resolveToolAction({
      mode: this.task.permissionMode,
      floorBlocked: toolCommandFloorBlocked(parsed.value, "strict"),
      cached: this.task.permissions
        ? this.task.permissionContext
          ? cachedVerdict(this.task.permissions, toolKey(this.task.permissionContext, context.toolName, parsed.value))
          : undefined
        : undefined,
      tainted: this.tainted,
    });
    return this.applyToolAction(action, call, parsed.value);
  }

  private async applyToolAction(
    action: "run" | "ask" | "reject",
    call: AgentSessionToolCall,
    input: unknown,
  ): Promise<ToolCallDecision> {
    const title = this.currentToolset?.title(call.name) ?? call.name;
    if (action === "reject") {
      this.options.emit({
        type: "tool-denied",
        toolCallId: call.id,
        tool: call.name,
        title,
        reason: "Blocked by permission policy",
      });
      return { action: "deny", reason: "Blocked by the app permission policy" };
    }
    if (action === "ask") {
      const decision = await this.requestToolApproval(call, title, input);
      if (decision === "reject") {
        this.options.emit({
          type: "tool-denied",
          toolCallId: call.id,
          tool: call.name,
          title,
          reason: "Rejected by user",
        });
        return { action: "deny", reason: "Tool call rejected by the user" };
      }
    }
    this.approvedToolCalls.push(call);
    this.options.emit({ type: "tool-start", toolCallId: call.id, tool: call.name, title, args: asRecord(input) });
    return { action: "allow" };
  }

  private async requestToolApproval(
    call: AgentSessionToolCall,
    title: string,
    input: unknown,
  ): Promise<ApprovalDecision> {
    const approvalId = randomUUID();
    this.options.emit({
      type: "approval-request",
      approvalId,
      toolCallId: call.id,
      tool: call.name,
      title,
      args: asRecord(input),
      reason: `Approve ${title}?`,
    });
    const decision = await new Promise<ApprovalDecision>((resolve) => this.approvals.set(approvalId, resolve));
    this.approvals.delete(approvalId);
    this.options.emit({ type: "approval-resolved", approvalId, decision });
    if (this.task.permissionMode === "remember" && this.options.permissionsStore && this.task.permissionContext) {
      try {
        await this.options.permissionsStore.addCommand(
          decision === "allow" ? "allowed" : "blocked",
          toolRule(this.task.permissionContext, call.name, input),
        );
      } catch (error) {
        this.currentFatalError = { type: "error", scope: "approval", message: describeError(error) };
        this.options.abortTask();
        throw error;
      }
    }
    return decision;
  }
}
