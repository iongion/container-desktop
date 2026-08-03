import {
  type AgentConfig,
  type AgentRunResult,
  type LLMAdapter,
  type LLMMessage,
  OpenMultiAgent,
  type OrchestratorEvent,
  type Task,
  type TeamRunResult,
  type TraceSink,
} from "@open-multi-agent/core";
import { type CostRegistry, makeEstimateCost } from "@/ai-system/core/cost";
import { describeError } from "@/ai-system/core/errors";
import { DEFAULT_RUN_MAX_CONCURRENCY, MAX_RUN_SPAN_BATCH } from "@/ai-system/core/limits";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunEvent, RunEventEnvelope, RunPlanTask, RunTaskView, RunView } from "@/ai-system/core/runEvents";
import { emptyRunView, reduceRunEvent } from "@/ai-system/core/runReducer";
import { spanToRunEvents } from "@/ai-system/core/spanEvents";
import type {
  ApprovalDecision,
  CreateTeamRun,
  ResolvedWorker,
  TeamRunCreationOptions,
  TeamRunPort,
} from "@/ai-system/core/types";
import { defaultCostRegistry } from "@/ai-system/runtime/cost/defaultCostRegistry";
import { createOmaAdapter } from "@/ai-system/runtime/omaAdapter";
import { validateOmaPlan } from "@/ai-system/runtime/omaPlan";
import {
  buildCustomTools,
  buildOmaWorkerToolset,
  createOmaToolCallSideChannel,
  makeOmaToolGate,
} from "@/ai-system/runtime/omaTools";
import { buildToolGuidance } from "@/ai-system/runtime/toolGuidance";
import type { Toolset } from "@/ai-system/runtime/tools/toolset";
import omaWorkerPrompt from "@/resources/prompts/oma-worker.md?raw";
import { renderPrompt } from "@/template/renderPrompt";

const COORDINATOR_ID = "coordinator";
const DEFAULT_WORKER_ID = "default-worker";
const TERMINAL_TASK_STATUSES = new Set<RunTaskView["status"]>(["complete", "failed", "skipped"]);

const OMA_SIMPLE_GOAL_MAX_LENGTH = 200;

interface OmaTeamWorker {
  id: string;
  name: string;
  system: string;
  specialty: string;
  resolved: ResolvedProvider;
  providerFetch: typeof fetch;
  source?: ResolvedWorker;
}

export interface OmaTeamAdapterContext {
  agentName: string;
  model: string;
  onToken: (agentName: string, delta: string, messages?: readonly LLMMessage[]) => void;
  providerFetch: typeof fetch;
  resolved: ResolvedProvider;
  role: "coordinator" | "worker";
}

export type OmaTeamAdapterFactory = (context: OmaTeamAdapterContext) => LLMAdapter;

function forceOmaCoordinator(goal: string): string {
  return goal.length > OMA_SIMPLE_GOAL_MAX_LENGTH ? goal : goal.padEnd(OMA_SIMPLE_GOAL_MAX_LENGTH + 1, " ");
}

function resultFrom(value: unknown): AgentRunResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const direct = value as Partial<AgentRunResult>;
  if (typeof direct.output === "string" && typeof direct.success === "boolean") return direct as AgentRunResult;
  const nested = (value as { result?: unknown }).result;
  return nested && typeof nested === "object" ? resultFrom(nested) : undefined;
}

function missingOutput(current: string, complete: string): string {
  if (!complete || current === complete) return "";
  return complete.startsWith(current) ? complete.slice(current.length) : current ? "" : complete;
}

export function makeCreateOmaTeamRun(
  makeAdapter: OmaTeamAdapterFactory,
  costRegistry: CostRegistry = defaultCostRegistry,
): CreateTeamRun {
  return (options: TeamRunCreationOptions): TeamRunPort => {
    const settings = options.taskSettings;
    let view: RunView = emptyRunView(options.runId, options.goal);
    let sequence = 0;
    let controller: AbortController | null = null;
    let launched = false;
    let resolvePlanDecision: ((decision: ApprovalDecision) => void) | null = null;
    let planRejected = false;
    const activeTaskByAgent = new Map<string, string>();
    const providerErrorByAgent = new Map<string, unknown>();
    const toolCalls = createOmaToolCallSideChannel();

    const configuredWorkers = settings.workers ?? [];
    const workers: OmaTeamWorker[] =
      configuredWorkers.length > 0
        ? configuredWorkers.map((worker) => ({
            id: worker.id,
            name: worker.name,
            system: worker.system,
            specialty: worker.specialty,
            resolved: worker.resolved,
            providerFetch: worker.providerFetch,
            source: worker,
          }))
        : [
            {
              id: DEFAULT_WORKER_ID,
              name: "Agent",
              system: settings.system,
              specialty: "General container and workspace assistance",
              resolved: settings.resolved,
              providerFetch: settings.providerFetch,
            },
          ];
    const workersById = new Map(workers.map((worker) => [worker.id, worker]));
    const modelsByAgent = new Map(workers.map((worker) => [worker.id, worker.resolved.model]));

    function emit(event: RunEvent): void {
      sequence += 1;
      const envelope: RunEventEnvelope = { version: 1, runId: options.runId, seq: sequence, event };
      view = reduceRunEvent(view, envelope).view;
      options.emit(envelope);
    }

    function taskIdFromMessages(messages: readonly LLMMessage[] | undefined): string | undefined {
      if (!messages) return undefined;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.role !== "user") continue;
        for (const block of message.content) {
          if (block.type !== "text") continue;
          const title = block.text.match(/^# Task: (.+)$/m)?.[1]?.trim();
          if (title) return view.tasks.find((task) => task.title === title)?.id;
        }
      }
      return undefined;
    }

    function onToken(agentName: string, delta: string, messages?: readonly LLMMessage[]): void {
      if (!delta) return;
      if (agentName === COORDINATOR_ID) {
        if (view.phase === "synthesizing") emit({ type: "synthesis-delta", text: delta });
        return;
      }
      const taskId = taskIdFromMessages(messages) ?? activeTaskByAgent.get(agentName);
      if (taskId) emit({ type: "task-delta", taskId, text: delta });
    }

    const toolsetsByAgent = new Map<string, Toolset>();
    const workersByAgent = new Map<string, ResolvedWorker | undefined>(
      workers.map((worker) => [worker.id, worker.source]),
    );
    const toolGate = makeOmaToolGate({
      settings,
      workersByAgent,
      toolsetsByAgent,
      permissionsStore: options.permissionsStore,
      toolCalls,
      emit,
    });

    function captureProviderErrors(agentName: string, adapter: LLMAdapter): LLMAdapter {
      return {
        name: adapter.name,
        capabilities: adapter.capabilities,
        async chat(messages, adapterOptions) {
          try {
            const response = await adapter.chat(messages, adapterOptions);
            if (agentName !== COORDINATOR_ID) {
              toolCalls.capture(
                agentName,
                taskIdFromMessages(messages) ?? activeTaskByAgent.get(agentName),
                response.content,
              );
            }
            return response;
          } catch (error) {
            providerErrorByAgent.set(agentName, error);
            throw error;
          }
        },
        async *stream(messages, adapterOptions) {
          try {
            yield* adapter.stream(messages, adapterOptions);
          } catch (error) {
            providerErrorByAgent.set(agentName, error);
            throw error;
          }
        },
      };
    }

    function adapterFor(worker: OmaTeamWorker): LLMAdapter {
      return captureProviderErrors(
        worker.id,
        makeAdapter({
          agentName: worker.id,
          model: worker.resolved.model,
          onToken,
          providerFetch: worker.providerFetch,
          resolved: worker.resolved,
          role: "worker",
        }),
      );
    }

    const agents: AgentConfig[] = workers.map((worker) => {
      const toolset = buildOmaWorkerToolset(settings, worker.source);
      if (toolset) toolsetsByAgent.set(worker.id, toolset);
      return {
        name: worker.id,
        model: worker.resolved.model,
        adapter: adapterFor(worker),
        systemPrompt: renderPrompt(omaWorkerPrompt, {
          system: worker.system,
          specialty: worker.specialty,
          toolGuidance: buildToolGuidance(toolset),
        }),
        cwd: null,
        customTools: toolset
          ? buildCustomTools(toolset, (name, result, context, input) => {
              toolGate.markTainted(context.taskId);
              if (context.taskId) {
                emit({ type: "task-delta", taskId: context.taskId, text: `\n[${toolset.title(name)}]\n` });
                emit({
                  type: "task-tool-result",
                  taskId: context.taskId,
                  toolCallId: toolCalls.complete(name, input, context),
                  tool: name,
                  title: toolset.title(name),
                  args:
                    input && typeof input === "object" && !Array.isArray(input)
                      ? (input as Record<string, unknown>)
                      : {},
                  ok: result.ok,
                  result: result.result,
                });
              }
              return undefined;
            })
          : [],
        onToolCall: toolGate.onToolCall,
        parallelToolCalls: false,
      };
    });
    const coordinatorResolved = {
      ...settings.resolved,
      model: settings.coordinatorModel?.trim() || settings.resolved.model,
    };
    const coordinatorAdapter = captureProviderErrors(
      COORDINATOR_ID,
      makeAdapter({
        agentName: COORDINATOR_ID,
        model: coordinatorResolved.model,
        onToken,
        providerFetch: settings.providerFetch,
        resolved: coordinatorResolved,
        role: "coordinator",
      }),
    );
    const providerByAgent = new Map(workers.map((worker) => [worker.id, worker.resolved.id]));
    providerByAgent.set(COORDINATOR_ID, coordinatorResolved.id);
    const resolveProvider = (context: { agentName?: string; provider?: string }) =>
      (context.agentName ? providerByAgent.get(context.agentName) : undefined) ?? context.provider;
    const estimateOmaCost = makeEstimateCost(costRegistry, resolveProvider);

    function maybeEnterSynthesis(): void {
      if (
        view.phase === "running" &&
        view.tasks.length > 0 &&
        view.tasks.every((task) => TERMINAL_TASK_STATUSES.has(task.status))
      ) {
        emit({ type: "phase-changed", phase: "synthesizing" });
      }
    }

    function projectTask(task: Task): RunPlanTask {
      const worker = task.assignee ? workersById.get(task.assignee) : undefined;
      return {
        id: task.id,
        title: task.title,
        description: task.description,
        dependsOn: [...(task.dependsOn ?? [])],
        agent: worker?.name ?? task.assignee ?? "Unassigned",
        ...(configuredWorkers.length > 0 && task.assignee ? { workerId: task.assignee } : {}),
      };
    }

    async function requestPlan(projected: RunPlanTask[]): Promise<boolean> {
      const error = validateOmaPlan(
        projected,
        settings.budget.maxTasks,
        new Set(configuredWorkers.map(({ id }) => id)),
      );
      if (error) {
        emit({ type: "error", scope: "plan", message: error });
        return false;
      }
      toolGate.seedPlanTaint(projected);
      emit({ type: "plan-ready", tasks: projected });
      emit({ type: "phase-changed", phase: "awaiting-plan" });
      const decision = await new Promise<ApprovalDecision>((resolve) => {
        resolvePlanDecision = resolve;
      });
      resolvePlanDecision = null;
      planRejected = decision !== "allow";
      emit({ type: "plan-resolved", decision });
      if (!planRejected && !controller?.signal.aborted) emit({ type: "phase-changed", phase: "running" });
      return !planRejected;
    }

    function skipFailedDependents(failedTaskId: string): void {
      const queue = [failedTaskId];
      while (queue.length > 0) {
        const dependencyId = queue.shift();
        if (!dependencyId) continue;
        const dependency = view.tasks.find((task) => task.id === dependencyId);
        for (const task of view.tasks) {
          if (TERMINAL_TASK_STATUSES.has(task.status) || !task.dependsOn.includes(dependencyId)) continue;
          emit({
            type: "task-skipped",
            taskId: task.id,
            reason: `Skipped because dependency "${dependency?.title ?? dependencyId}" failed.`,
          });
          queue.push(task.id);
        }
      }
    }

    function onProgress(event: OrchestratorEvent): void {
      if (event.type === "task_start" && event.task && event.agent) {
        activeTaskByAgent.set(event.agent, event.task);
        emit({ type: "task-started", taskId: event.task, model: modelsByAgent.get(event.agent) });
        return;
      }
      if (event.type === "task_complete" && event.task) {
        const result = resultFrom(event.data);
        const task = view.tasks.find((candidate) => candidate.id === event.task);
        const delta = result && task ? missingOutput(task.output, result.output) : "";
        if (delta) emit({ type: "task-delta", taskId: event.task, text: delta });
        emit({ type: "task-completed", taskId: event.task });
        if (event.agent) activeTaskByAgent.delete(event.agent);
        maybeEnterSynthesis();
        return;
      }
      if (event.type === "task_skipped" && event.task) {
        const task = event.data as { error?: unknown } | undefined;
        emit({ type: "task-skipped", taskId: event.task, reason: describeError(task?.error ?? "Task skipped") });
        maybeEnterSynthesis();
        return;
      }
      if (event.type === "error" && event.task) {
        if (controller?.signal.aborted) return;
        const message = describeError((event.agent ? providerErrorByAgent.get(event.agent) : undefined) ?? event.data);
        emit({ type: "task-failed", taskId: event.task, message });
        emit({ type: "error", scope: "task", message });
        skipFailedDependents(event.task);
        if (event.agent) activeTaskByAgent.delete(event.agent);
        maybeEnterSynthesis();
        return;
      }
      if (event.type === "error" && !controller?.signal.aborted) {
        const kind = (event.data as { kind?: unknown } | undefined)?.kind;
        emit({
          type: "error",
          scope: kind === "synthesis_failed" || view.phase === "synthesizing" ? "synthesis" : "run",
          message: describeError(providerErrorByAgent.get(COORDINATOR_ID) ?? event.data),
        });
      }
    }

    function reconcile(result: TeamRunResult): boolean {
      emit({
        type: "usage",
        inputTokens: Math.max(0, Math.trunc(result.totalTokenUsage.input_tokens)),
        outputTokens: Math.max(0, Math.trunc(result.totalTokenUsage.output_tokens)),
        maxTokens: settings.budget.maxTokens,
      });
      const synthesis = result.agentResults.get(COORDINATOR_ID)?.output ?? "";
      const synthesisDelta = missingOutput(view.synthesis, synthesis);
      if (synthesisDelta) emit({ type: "synthesis-delta", text: synthesisDelta });
      const synthesisResult = result.agentResults.get(COORDINATOR_ID);
      if (synthesisResult && !synthesisResult.success && !controller?.signal.aborted) {
        const error =
          providerErrorByAgent.get(COORDINATOR_ID) ?? (synthesisResult as AgentRunResult & { error?: unknown }).error;
        emit({
          type: "error",
          scope: "synthesis",
          message: describeError(error ?? synthesisResult.errorInfo ?? synthesisResult.output),
        });
        return true;
      }
      return false;
    }

    let acceptedTraceRecords = 0;
    const pendingSpanUpdates: Extract<RunEvent, { type: "span-batch" }>["updates"] = [];
    let traceFlushScheduled = false;
    const flushTraceBatch = (): void => {
      traceFlushScheduled = false;
      if (pendingSpanUpdates.length === 0) return;
      emit({ type: "span-batch", updates: pendingSpanUpdates.splice(0, MAX_RUN_SPAN_BATCH) });
      if (pendingSpanUpdates.length > 0) queueMicrotask(flushTraceBatch);
    };
    const enqueueSpan = (event: Extract<RunEvent, { type: "span-open" | "span-close" }>): void => {
      pendingSpanUpdates.push({ type: event.type === "span-open" ? "open" : "close", span: event.span });
      if (pendingSpanUpdates.length >= MAX_RUN_SPAN_BATCH) {
        flushTraceBatch();
      } else if (!traceFlushScheduled) {
        traceFlushScheduled = true;
        queueMicrotask(flushTraceBatch);
      }
    };
    const traceFlushResult = () => ({
      status: "ok" as const,
      accepted: acceptedTraceRecords,
      exported: acceptedTraceRecords,
      dropped: 0,
      failed: 0,
    });
    const traceSink: TraceSink = {
      emit(record) {
        acceptedTraceRecords += 1;
        for (const event of spanToRunEvents(record, {
          resolveProvider,
          estimateCost: (usage, context) =>
            context.model
              ? costRegistry.estimate(resolveProvider(context) ?? "", usage, { model: context.model })
              : undefined,
        })) {
          if (event.type === "span-open" || event.type === "span-close") enqueueSpan(event);
          else emit(event);
        }
      },
      forceFlush: () => {
        flushTraceBatch();
        return Promise.resolve(traceFlushResult());
      },
      shutdown: () => {
        flushTraceBatch();
        return Promise.resolve(traceFlushResult());
      },
    };

    async function drive(signal: AbortSignal): Promise<void> {
      try {
        emit({ type: "phase-changed", phase: "planning" });

        const oma = new OpenMultiAgent({
          defaultCwd: null,
          maxConcurrency: DEFAULT_RUN_MAX_CONCURRENCY,
          maxTokenBudget: settings.budget.maxTokens,
          estimateCost: estimateOmaCost,
          observability: { sinks: [traceSink] },
          // OMA 1.12.1 only threads taskId into ToolUseContext when its legacy trace bridge is present. Modern
          // telemetry uses the observability sink; this no-op exists only so the permission gate stays task-scoped.
          onTrace: () => undefined,
          onPlanReady: async (tasks) => {
            const invalidDependency = tasks.find((task) => task.status === "failed");
            if (invalidDependency) {
              emit({
                type: "error",
                scope: "plan",
                message: `Task ${invalidDependency.id} has an invalid dependency.`,
              });
              return false;
            }
            return requestPlan(tasks.map(projectTask));
          },
          onProgress,
        });
        const team = oma.createTeam(`team-run-${options.runId}`, {
          name: `team-run-${options.runId}`,
          agents,
        });
        const result = await oma.runTeam(team, forceOmaCoordinator(options.goal), {
          abortSignal: signal,
          coordinator: {
            adapter: coordinatorAdapter,
            model: coordinatorResolved.model,
            cwd: null,
          },
          revealCoordinator: true,
        });
        if (signal.aborted) {
          emit({ type: "run-stopped" });
          return;
        }
        if (view.phase === "error") return;
        if (reconcile(result)) return;
        if (planRejected) {
          emit({ type: "run-complete", finishReason: "plan-rejected" });
          return;
        }
        emit({
          type: "run-complete",
          finishReason:
            result.totalTokenUsage.input_tokens + result.totalTokenUsage.output_tokens >= settings.budget.maxTokens
              ? "budget"
              : "stop",
        });
      } catch (error) {
        if (signal.aborted) emit({ type: "run-stopped" });
        else emit({ type: "error", scope: "run", message: describeError(error) });
      }
    }

    return {
      async start() {
        if (launched) return { accepted: true, runId: options.runId, phase: view.phase };
        launched = true;
        const runController = new AbortController();
        controller = runController;
        void drive(runController.signal)
          .catch((error) => options.logger?.error("OMA team run failed", error))
          .finally(() => {
            if (controller === runController) controller = null;
          });
        return { accepted: true, runId: options.runId, phase: view.phase };
      },
      async resolvePlan(decision) {
        if (!resolvePlanDecision) return { accepted: false, phase: view.phase };
        resolvePlanDecision(decision);
        return { accepted: true, phase: view.phase };
      },
      async resolveToolApproval(approvalId, decision) {
        return { accepted: toolGate.resolveApproval(approvalId, decision), phase: view.phase };
      },
      async cancel() {
        if (["idle", "done", "stopped", "error"].includes(view.phase)) return;
        emit({ type: "phase-changed", phase: "cancelling" });
        controller?.abort();
        resolvePlanDecision?.("reject");
        toolGate.rejectPending();
      },
      snapshot() {
        return view;
      },
      async dispose() {
        controller?.abort();
        resolvePlanDecision?.("reject");
        toolGate.rejectPending();
      },
    };
  };
}

export const createOmaTeamRun: CreateTeamRun = makeCreateOmaTeamRun((context) =>
  createOmaAdapter({ ...context.resolved, model: context.model }, context.providerFetch, {
    agentName: context.agentName,
    onToken: context.onToken,
  }),
);
