import type { ContentBlock, LLMAdapter, LLMMessage, ToolUseBlock } from "@open-multi-agent/core";
import { toolCommandFloorBlocked } from "@/ai-system/core/commandFloor";
import { DEFAULT_RUN_MAX_CONCURRENCY } from "@/ai-system/core/limits";
import {
  cachedVerdict,
  resolveToolAction,
  resolveWorkerToolAction,
  toolKey,
  toolRule,
} from "@/ai-system/core/permissions";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunEvent, RunEventEnvelope, RunPlanTask, RunTaskStatus, RunView } from "@/ai-system/core/runEvents";
import { dependentsToSkip, parsePlan, readyTaskIds } from "@/ai-system/core/runPlan";
import { emptyRunView, reduceRunEvent } from "@/ai-system/core/runReducer";
import type {
  ApprovalDecision,
  CreateGoalRun,
  GoalRunCreationOptions,
  GoalRunPort,
  ResolvedWorker,
} from "@/ai-system/core/types";
import { buildContainerToolset } from "@/ai-system/runtime/tools/containerToolset";
import { filterToolset, mergeToolsets, type Toolset } from "@/ai-system/runtime/tools/toolset";
import { buildWorkspaceToolset } from "@/ai-system/runtime/tools/workspaceToolset";
import goalDecomposeSystem from "@/resources/prompts/goal-decompose.md?raw";
import goalSynthesisSystem from "@/resources/prompts/goal-synthesis.md?raw";
import goalWorkerSystem from "@/resources/prompts/goal-worker.md?raw";
import { randomUUID } from "@/utils/randomUUID";

// The role a model turn plays in a run — decomposition/synthesis vs. a worker task.
export type GoalRole = "coordinator" | "worker";

// The provider access ONE turn runs against: endpoint + credentials + the model id to bind.
//
// The model MUST be selected here, where the adapter is constructed. OMA's AISdkAdapter captures its
// LanguageModel at construction and ignores the per-call `model` option entirely, so routing a turn to a
// different model by passing it to stream() silently does nothing — every turn would run on the run-level
// model while the option still *reads* correct in a test. One value decides the model, and it is the value the
// factory builds from.
export interface GoalTurnAccess {
  resolved: ResolvedProvider;
  providerFetch: typeof fetch;
  model: string;
}

export type GoalAdapterFactory = (access: GoalTurnAccess, role: GoalRole) => LLMAdapter;

const MAX_WORKER_STEPS = 6;
// How much of a dependency's report is carried into a dependent's brief. Fan-in tasks would otherwise
// concatenate every upstream transcript and blow the context window.
const MAX_BRIEF_CONTEXT_CHARS = 4_000;

function messageText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolResultBlock(toolUseId: string, content: string, isError: boolean): ContentBlock {
  return { type: "tool_result", tool_use_id: toolUseId, content, is_error: isError };
}

// The roster the coordinator assigns from, appended to the static decompose prompt rather than inlined into it,
// so the prompt file stays a file and the dynamic part stays one testable function. Empty roster ⇒ empty string,
// which leaves the prompt byte-identical to the pre-workers one.
export function rosterBlock(workers: readonly ResolvedWorker[]): string {
  if (workers.length === 0) return "";
  const lines = workers.map((worker) => `- \`${worker.id}\` — ${worker.name}: ${worker.specialty}`).join("\n");
  return `\n\n# Available workers\n\nAssign every task to exactly one worker by setting \`workerId\` to its id. Use no other value.\n\n${lines}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

// Builds the owned multi-agent driver satisfying GoalRunPort. OMA's own OpenMultiAgent orchestrator cannot be
// used here: it is reachable only through the package barrel, and it statically imports registerBuiltInTools →
// bashTool → node:child_process, which must never enter the webview bundle. So — exactly as the interactive loop
// and the tool layer are owned — this drives the same node-free adapter.stream() primitive directly:
// decompose → plan approval → dependsOn-ordered worker dispatch → synthesis.
export function makeCreateGoalRun(makeAdapter: GoalAdapterFactory): CreateGoalRun {
  return (options: GoalRunCreationOptions): GoalRunPort => {
    const task = options.taskSettings;
    let view: RunView = emptyRunView(options.runId, options.goal);
    let seq = 0;
    let abort: AbortController | null = null;
    let resolvePlanDecision: ((decision: ApprovalDecision) => void) | null = null;
    let launched = false;
    let plan: RunPlanTask[] = [];
    const statuses: Record<string, RunTaskStatus> = {};
    const reports: Record<string, string> = {};
    const usage = { inputTokens: 0, outputTokens: 0 };
    // Several workers can be blocked on a tool approval at the same time, so pending resolvers are keyed by
    // approvalId. Cancelling rejects every one of them so no worker is left awaiting a promise that never settles.
    const toolApprovals = new Map<string, (decision: ApprovalDecision) => void>();

    // The run's default access, and the coordinator's — which may point at a cheaper model for decomposition and
    // synthesis, since those reason over titles and summaries rather than raw tool output.
    const runAccess: GoalTurnAccess = {
      resolved: task.resolved,
      providerFetch: task.providerFetch,
      model: task.resolved.model || "",
    };
    const coordinatorAccess: GoalTurnAccess = {
      ...runAccess,
      model: task.coordinatorModel?.trim() || runAccess.model,
    };

    // Single seq authority: bump, fold into the local view (so snapshot() matches the renderer's projection), emit.
    function emit(event: RunEvent): void {
      seq += 1;
      const envelope: RunEventEnvelope = { version: 1, runId: options.runId, seq, event };
      view = reduceRunEvent(view, envelope).view;
      options.emit(envelope);
    }

    function creditUsage(response: unknown): void {
      const record = response as { usage?: { input_tokens?: number; output_tokens?: number } } | null;
      usage.inputTokens += Math.max(0, Math.trunc(record?.usage?.input_tokens ?? 0));
      usage.outputTokens += Math.max(0, Math.trunc(record?.usage?.output_tokens ?? 0));
      emit({ type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    }

    const overBudget = (): boolean => usage.inputTokens + usage.outputTokens >= task.budget.maxTokens;

    function rejectPendingToolApprovals(): void {
      for (const resolve of toolApprovals.values()) resolve("reject");
      toolApprovals.clear();
    }

    // The run's roster, indexed once. Empty ⇒ every task runs on the run defaults (the pre-workers behaviour).
    const roster = task.workers ?? [];
    const workerFor = (planTask: RunPlanTask): ResolvedWorker | undefined =>
      planTask.workerId ? roster.find((entry) => entry.id === planTask.workerId) : undefined;

    // A bound worker brings its own provider + model; the model must be chosen HERE because the adapter binds it
    // at construction (see GoalTurnAccess).
    const accessFor = (worker?: ResolvedWorker): GoalTurnAccess =>
      worker
        ? {
            resolved: worker.resolved,
            providerFetch: worker.providerFetch,
            model: worker.resolved.model || runAccess.model,
          }
        : runAccess;

    const systemFor = (worker?: ResolvedWorker): string => `${worker?.system ?? task.system}\n\n${goalWorkerSystem}`;

    const buildToolset = (worker?: ResolvedWorker): Toolset | null => {
      const merged = mergeToolsets([
        task.execution.engineOps ? buildContainerToolset(task.execution.engineOps) : null,
        task.execution.workspaceAccess ? buildWorkspaceToolset(task.execution.workspaceAccess) : null,
      ]);
      if (!merged || !worker?.allowedTools) return merged;
      return filterToolset(merged, worker.allowedTools);
    };

    const titleOf = (taskId: string): string => plan.find((entry) => entry.id === taskId)?.title ?? taskId;

    // One model turn. Tool calls are returned rather than executed so each caller applies its own policy: the
    // coordinator is offered no tools at all, workers run them through the gate below.
    async function turn(
      role: GoalRole,
      access: GoalTurnAccess,
      system: string,
      history: LLMMessage[],
      toolset: Toolset | null,
      signal: AbortSignal,
      onDelta?: (text: string) => void,
    ): Promise<{ text: string; toolUses: ToolUseBlock[] }> {
      const adapter = makeAdapter(access, role);
      let text = "";
      const toolUses: ToolUseBlock[] = [];
      const stream = adapter.stream(history, {
        model: access.model,
        systemPrompt: system,
        tools: toolset?.defs,
        abortSignal: signal,
      });
      for await (const event of stream) {
        if (signal.aborted) break;
        if (event.type === "text") {
          const delta = String(event.data ?? "");
          if (!delta) continue;
          text += delta;
          onDelta?.(delta);
        } else if (event.type === "tool_use") {
          toolUses.push(event.data as ToolUseBlock);
        } else if (event.type === "done") {
          creditUsage(event.data);
          break;
        } else if (event.type === "error") {
          throw event.data instanceof Error ? event.data : new Error(messageText(event.data));
        }
      }
      return { text, toolUses };
    }

    // Decide run/reject for one gated tool call, prompting the user (and parking this worker) when policy says
    // "ask". Only THIS worker blocks — its siblings keep running, and the scheduler keeps its slot reserved, so a
    // forgotten prompt stalls one branch rather than corrupting the DAG.
    async function gateTool(
      toolUse: ToolUseBlock,
      args: unknown,
      title: string,
      taskId: string,
      tainted: boolean,
      worker?: ResolvedWorker,
    ): Promise<ApprovalDecision> {
      const cached = task.permissions ? cachedVerdict(task.permissions, toolKey(toolUse.name, args)) : undefined;
      const floorBlocked = toolCommandFloorBlocked(args);
      // A bound worker's own policy decides; an unbound task keeps the app-global mode exactly as before.
      const action = worker
        ? resolveWorkerToolAction({
            policy: worker.policy,
            runMode: task.permissionMode,
            floorBlocked,
            cached,
            tainted,
          })
        : resolveToolAction({ mode: task.permissionMode, floorBlocked, cached, tainted });
      if (action === "run") return "allow";
      if (action === "reject") return "reject";
      const approvalId = randomUUID();
      emit({
        type: "tool-approval-request",
        approvalId,
        taskId,
        toolCallId: toolUse.id,
        tool: toolUse.name,
        title,
        args: asRecord(args),
        reason: `Approve ${title}?`,
      });
      const decision = await new Promise<ApprovalDecision>((resolve) => toolApprovals.set(approvalId, resolve));
      toolApprovals.delete(approvalId);
      emit({ type: "tool-approval-resolved", approvalId, decision });
      // "ask" means ask every time, so a verdict taken under it is not remembered — persisting one would make
      // the next call skip the prompt the user explicitly asked for.
      if (task.permissionMode === "remember" && worker?.policy !== "ask" && options.permissionsStore) {
        await options.permissionsStore
          .addCommand(decision === "allow" ? "allowed" : "blocked", toolRule(toolUse.name, args))
          .catch(() => undefined);
      }
      return decision;
    }

    async function executeWorkerTool(
      toolUse: ToolUseBlock,
      toolset: Toolset,
      taskId: string,
      tainted: boolean,
      worker?: ResolvedWorker,
    ): Promise<ContentBlock> {
      const title = toolset.title(toolUse.name);
      if (!toolset.has(toolUse.name)) return toolResultBlock(toolUse.id, "Unknown tool", true);
      const valid = toolset.validate(toolUse.name, toolUse.input);
      if (!valid.ok) return toolResultBlock(toolUse.id, valid.error, true);
      // A worker on the "ask" policy gates EVERY tool it holds, including ungated reads — the only way to see
      // what an agent reads, which is where prompt injection enters.
      const requiresGate = worker?.policy === "ask" ? true : toolset.gated(toolUse.name);
      if (requiresGate) {
        const decision = await gateTool(toolUse, valid.value, title, taskId, tainted, worker);
        if (decision === "reject") {
          emit({ type: "task-delta", taskId, text: `\n[denied: ${title}]\n` });
          return toolResultBlock(toolUse.id, "Tool call rejected by the user", true);
        }
      }
      try {
        const outcome = await toolset.run(toolUse.name, valid.value);
        emit({ type: "task-delta", taskId, text: `\n[${title}]\n` });
        return toolResultBlock(toolUse.id, JSON.stringify(outcome.summary ?? null), !outcome.ok);
      } catch (error) {
        return toolResultBlock(toolUse.id, messageText(error), true);
      }
    }

    function workerBrief(planTask: RunPlanTask): string {
      const context = planTask.dependsOn
        .map((dependencyId) => {
          const report = reports[dependencyId];
          if (!report) return "";
          return `\n## Result of "${titleOf(dependencyId)}"\n${report.slice(0, MAX_BRIEF_CONTEXT_CHARS)}`;
        })
        .join("");
      return `Overall goal: ${options.goal}\n\n# Your task: ${planTask.title}\n${planTask.description}${context}`;
    }

    function synthesisBrief(): string {
      const results = plan
        .map((planTask) => {
          const status = statuses[planTask.id] ?? "pending";
          const report = reports[planTask.id];
          const body = report
            ? report.slice(0, MAX_BRIEF_CONTEXT_CHARS)
            : (view.tasks.find((entry) => entry.id === planTask.id)?.error ?? "no output");
          return `## ${planTask.title} — ${status}\n${body}`;
        })
        .join("\n\n");
      return `Goal: ${options.goal}\n\n# Task results\n${results}`;
    }

    function cascadeSkips(failedId: string): void {
      for (const skippedId of dependentsToSkip(plan, failedId, statuses)) {
        statuses[skippedId] = "skipped";
        emit({
          type: "task-skipped",
          taskId: skippedId,
          reason: `Depends on "${titleOf(failedId)}", which did not finish.`,
        });
      }
    }

    async function runWorker(planTask: RunPlanTask, signal: AbortSignal): Promise<void> {
      statuses[planTask.id] = "running";
      emit({ type: "task-started", taskId: planTask.id });
      const worker = workerFor(planTask);
      const toolset = buildToolset(worker);
      const history: LLMMessage[] = [{ role: "user", content: [{ type: "text", text: workerBrief(planTask) }] }];
      let report = "";
      // Injection resistance. A worker whose brief carries upstream agents' reports has ALREADY ingested content
      // it did not author, so it starts tainted; an independent worker becomes tainted at its first tool result.
      let tainted = planTask.dependsOn.length > 0;
      try {
        for (let step = 0; step < MAX_WORKER_STEPS; step += 1) {
          if (signal.aborted || overBudget()) break;
          const { text, toolUses } = await turn(
            "worker",
            accessFor(worker),
            systemFor(worker),
            history,
            toolset,
            signal,
            (delta) => emit({ type: "task-delta", taskId: planTask.id, text: delta }),
          );
          if (text.trim()) report = text;
          const assistant: ContentBlock[] = [...(text ? [{ type: "text" as const, text }] : []), ...toolUses];
          if (assistant.length > 0) history.push({ role: "assistant", content: assistant });
          if (toolUses.length === 0 || !toolset) break;
          const results: ContentBlock[] = [];
          for (const toolUse of toolUses) {
            if (signal.aborted) break;
            results.push(await executeWorkerTool(toolUse, toolset, planTask.id, tainted, worker));
            tainted = true;
          }
          if (signal.aborted) break;
          history.push({ role: "user", content: results });
        }
        if (signal.aborted) return;
        reports[planTask.id] = report;
        statuses[planTask.id] = "complete";
        emit({ type: "task-completed", taskId: planTask.id });
      } catch (error) {
        const message = messageText(error);
        statuses[planTask.id] = "failed";
        emit({ type: "task-failed", taskId: planTask.id, message });
        // Task-scoped, so the reducer keeps the run alive: sibling branches still have work to do.
        emit({ type: "error", scope: "task", message: `${planTask.title}: ${message}` });
        cascadeSkips(planTask.id);
      }
    }

    // Dispatch every task whose dependencies have completed, up to the concurrency cap, and re-evaluate each time
    // one settles. Exits when nothing is running and nothing is ready — either the DAG is drained, or the rest is
    // downstream of a failure and already skipped.
    async function runScheduler(signal: AbortSignal): Promise<void> {
      const inFlight = new Set<Promise<void>>();
      while (!signal.aborted && !overBudget()) {
        const slots = Math.max(0, DEFAULT_RUN_MAX_CONCURRENCY - inFlight.size);
        for (const taskId of readyTaskIds(plan, statuses).slice(0, slots)) {
          const planTask = plan.find((entry) => entry.id === taskId);
          if (!planTask) continue;
          const pending: Promise<void> = runWorker(planTask, signal).finally(() => {
            inFlight.delete(pending);
          });
          inFlight.add(pending);
        }
        if (inFlight.size === 0) break;
        await Promise.race(inFlight);
      }
      await Promise.allSettled([...inFlight]);
    }

    async function drive(signal: AbortSignal): Promise<void> {
      try {
        emit({ type: "phase-changed", phase: "planning" });
        const decomposition = await turn(
          "coordinator",
          coordinatorAccess,
          `${goalDecomposeSystem}${rosterBlock(roster)}`,
          [{ role: "user", content: [{ type: "text", text: options.goal }] }],
          null,
          signal,
        );
        if (signal.aborted) {
          emit({ type: "run-stopped" });
          return;
        }
        const parsed = parsePlan(decomposition.text, task.budget.maxTasks, roster);
        if (!parsed.ok) {
          emit({ type: "error", scope: "plan", message: parsed.error });
          return;
        }
        plan = parsed.tasks;
        for (const planTask of plan) statuses[planTask.id] = "pending";
        emit({ type: "plan-ready", tasks: plan });
        emit({ type: "phase-changed", phase: "awaiting-plan" });

        const decision = await new Promise<ApprovalDecision>((resolve) => {
          resolvePlanDecision = resolve;
        });
        resolvePlanDecision = null;
        if (signal.aborted) {
          emit({ type: "run-stopped" });
          return;
        }
        emit({ type: "plan-resolved", decision });
        if (decision !== "allow") {
          emit({ type: "run-complete", finishReason: "plan-rejected" });
          return;
        }

        emit({ type: "phase-changed", phase: "running" });
        await runScheduler(signal);
        if (signal.aborted) {
          emit({ type: "run-stopped" });
          return;
        }

        emit({ type: "phase-changed", phase: "synthesizing" });
        await turn(
          "coordinator",
          coordinatorAccess,
          goalSynthesisSystem,
          [{ role: "user", content: [{ type: "text", text: synthesisBrief() }] }],
          null,
          signal,
          (delta) => emit({ type: "synthesis-delta", text: delta }),
        );
        if (signal.aborted) {
          emit({ type: "run-stopped" });
          return;
        }
        emit({ type: "run-complete", finishReason: overBudget() ? "budget" : "stop" });
      } catch (error) {
        emit({ type: "error", scope: "run", message: messageText(error) });
      }
    }

    return {
      async start() {
        if (launched) return { accepted: true, runId: options.runId, phase: view.phase };
        launched = true;
        const controller = new AbortController();
        abort = controller;
        void drive(controller.signal)
          .catch((error) => options.logger?.error("ai goal run failed", error))
          .finally(() => {
            if (abort === controller) abort = null;
          });
        return { accepted: true, runId: options.runId, phase: view.phase };
      },
      async resolvePlan(decision: ApprovalDecision) {
        if (!resolvePlanDecision) return { accepted: false, phase: view.phase };
        resolvePlanDecision(decision);
        return { accepted: true, phase: view.phase };
      },
      async resolveToolApproval(approvalId: string, decision: ApprovalDecision) {
        const resolve = toolApprovals.get(approvalId);
        if (!resolve) return { accepted: false, phase: view.phase };
        resolve(decision);
        return { accepted: true, phase: view.phase };
      },
      async cancel() {
        if (view.phase !== "idle") emit({ type: "phase-changed", phase: "cancelling" });
        abort?.abort();
        resolvePlanDecision?.("reject");
        rejectPendingToolApprovals();
      },
      snapshot() {
        return view;
      },
      async dispose() {
        abort?.abort();
        resolvePlanDecision?.("reject");
        rejectPendingToolApprovals();
      },
    };
  };
}
