import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { DEFAULT_RUN_TOKEN_BUDGET, MAX_ACTIVE_GOAL_RUNS, MAX_RUN_TASKS } from "@/ai-system/core/limits";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type { AgentExecutionDeps, KnowledgeBankLike, SandboxRunner } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import type {
  ResolveGoalPlanRequest,
  ResolveGoalPlanResult,
  ResolveGoalToolRequest,
  RunEventEnvelope,
  RunView,
  StartGoalRequest,
  StartGoalResult,
} from "@/ai-system/core/runEvents";
import type {
  AISettings,
  CreateGoalRun,
  DiagnosticsBundle,
  EngineOps,
  GoalRunPort,
  ProviderTransport,
  ResolvedWorker,
} from "@/ai-system/core/types";
import { workerAllowedTools } from "@/ai-system/core/workers";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { WorkerHost } from "./workerHost";

interface RunRecord<TEvent> {
  runId: string;
  run: GoalRunPort;
  observers: Map<number | string, TEvent>;
}

export interface GoalHostDeps<TEvent> {
  senderId: (event: TEvent) => number | string;
  send: (event: TEvent, channel: typeof AI_CHANNELS.goalEvent, payload: RunEventEnvelope) => void;
  getAISettings: () => Promise<AISettings> | AISettings;
  resolveProviderAccess: (providerId?: string) => Promise<ResolvedProvider>;
  providerTransport: ProviderTransport;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  createGoalRun?: CreateGoalRun;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  workerHost?: WorkerHost;
  // Runs the host should already hold at creation — CONTAINER_DESKTOP_MOCK only, so the Goals list has content
  // across every phase on a cold start. They are ordinary records: the same stop/approve/snapshot path applies.
  seedRuns?: GoalRunPort[];
  reportError: (message: string, id: string | undefined, error: unknown) => void;
  logger?: { error: (...args: unknown[]) => void };
}

// Goal runs are deliberately EPHEMERAL: unlike conversations there is no durable record, so a reload loses an
// in-flight run. That keeps the trust boundary small (no run transcript on disk) and matches goal mode being an
// explicit, bounded action rather than a resumable thread.
export function createGoalHost<TEvent>(deps: GoalHostDeps<TEvent>) {
  const runs = new Map<string, RunRecord<TEvent>>();
  for (const run of deps.seedRuns ?? []) {
    const runId = run.snapshot().runId;
    runs.set(runId, { runId, run, observers: new Map<number | string, TEvent>() });
  }

  const observe = (record: RunRecord<TEvent>, event: TEvent): void => {
    record.observers.set(deps.senderId(event), event);
  };

  const requireRun = (event: TEvent, runId: string): RunRecord<TEvent> => {
    const record = runs.get(runId);
    if (!record) throw new Error("AI: goal run not found");
    observe(record, event);
    return record;
  };

  const broadcast = (record: RunRecord<TEvent>, envelope: RunEventEnvelope): void => {
    for (const [senderId, event] of record.observers) {
      try {
        deps.send(event, AI_CHANNELS.goalEvent, envelope);
      } catch (error) {
        record.observers.delete(senderId);
        deps.reportError("AI: goal observer delivery failed", record.runId, error);
      }
    }
  };

  const disposeRun = (record: RunRecord<TEvent>): void => {
    void record.run.dispose().catch((error) => deps.reportError("AI: goal run disposal failed", record.runId, error));
  };

  const ensureCapacity = (): void => {
    if (runs.size < MAX_ACTIVE_GOAL_RUNS) return;
    for (const [runId, record] of runs) {
      if (["done", "stopped", "error", "idle"].includes(record.run.snapshot().phase)) {
        runs.delete(runId);
        disposeRun(record);
        return;
      }
    }
    throw new Error("AI: too many active goal runs");
  };

  return {
    async start(event: TEvent, request: StartGoalRequest): Promise<StartGoalResult> {
      const { createGoalRun, runSandboxed, knowledgeBank } = deps;
      if (!createGoalRun || !runSandboxed || !knowledgeBank) throw new Error("AI: goal mode is not available");
      const existing = runs.get(request.runId);
      if (existing) {
        observe(existing, event);
        return existing.run.start();
      }
      ensureCapacity();

      const settings = await deps.getAISettings();
      const resolved = await deps.resolveProviderAccess(request.providerId);
      const selectedModel = request.model?.trim();
      if (selectedModel) resolved.model = selectedModel;
      const permissions = deps.permissionsStore ? await deps.permissionsStore.load() : undefined;
      const permissionsUnreadable = permissions?.status === "error";
      const permissionMode = permissionsUnreadable ? "ask" : (settings.permissionMode ?? "ask");
      if (permissionsUnreadable) deps.logger?.error("AI: permissions cache unreadable — forcing 'ask'");

      // Resolve the requested roster HOST-side. Each worker gets its own provider access and its own bound fetch,
      // so two workers on two providers never share a credential. Provider lookups are cached per id because
      // resolveProviderAccess reads the keychain.
      const requestedWorkers = deps.workerHost?.resolveIds(request.workerIds ?? []) ?? [];
      const providerCache = new Map<string, ResolvedProvider>();
      const workers: ResolvedWorker[] = [];
      for (const definition of requestedWorkers) {
        const cacheKey = definition.providerId ?? "";
        let access = cacheKey ? providerCache.get(cacheKey) : resolved;
        if (!access) {
          access = await deps.resolveProviderAccess(definition.providerId);
          providerCache.set(cacheKey, access);
        }
        const workerResolved: ResolvedProvider = { ...access, model: definition.model?.trim() || access.model };
        workers.push({
          id: definition.id,
          name: definition.name,
          specialty: definition.specialty,
          system: `${deps.buildAgentPrompt()}\n\n${definition.systemPrompt}`,
          resolved: workerResolved,
          providerFetch: createProviderFetch(deps.providerTransport, workerResolved),
          policy: definition.toolPolicy.mode,
          allowedTools: workerAllowedTools(definition),
        });
      }

      const execution: AgentExecutionDeps = {
        runSandboxed,
        searchKnowledge: (query) => knowledgeBank.search(query),
        webSearch: settings.webSearch && deps.webSearcher ? deps.webSearcher : undefined,
        engineOps: deps.engineOps,
        workspaceAccess: deps.workspaceAccess,
      };

      const record: RunRecord<TEvent> = {
        runId: request.runId,
        observers: new Map<number | string, TEvent>(),
      } as RunRecord<TEvent>;
      observe(record, event);
      record.run = createGoalRun({
        runId: request.runId,
        goal: redactText(request.goal.trim()),
        taskSettings: {
          resolved,
          providerFetch: createProviderFetch(deps.providerTransport, resolved),
          coordinatorModel: request.coordinatorModel?.trim() || undefined,
          system: deps.buildAgentPrompt(),
          permissionMode,
          permissions,
          execution,
          workers,
          budget: {
            maxTokens: request.maxTokens ?? DEFAULT_RUN_TOKEN_BUDGET,
            maxTasks: request.maxTasks ?? MAX_RUN_TASKS,
          },
        },
        permissionsStore: deps.permissionsStore,
        emit: (envelope) => broadcast(record, envelope),
        logger: deps.logger,
      });
      runs.set(request.runId, record);
      return record.run.start();
    },
    resolvePlan(event: TEvent, request: ResolveGoalPlanRequest): Promise<ResolveGoalPlanResult> {
      return requireRun(event, request.runId).run.resolvePlan(request.decision);
    },
    resolveTool(event: TEvent, request: ResolveGoalToolRequest): Promise<ResolveGoalPlanResult> {
      return requireRun(event, request.runId).run.resolveToolApproval(request.approvalId, request.decision);
    },
    async cancel(event: TEvent, runId: string): Promise<{ ok: true }> {
      await requireRun(event, runId).run.cancel();
      return { ok: true };
    },
    async snapshot(event: TEvent, runId: string): Promise<RunView | null> {
      const record = runs.get(runId);
      if (!record) return null;
      observe(record, event);
      return record.run.snapshot();
    },
    // Every run the host still holds, registering the caller as an observer of each. This is how a renderer
    // reload re-attaches: on Electron the AI system lives in main, so runs survive it; on Tauri/Wails the host
    // dies with the webview and this is simply empty.
    list(event: TEvent): RunView[] {
      const views: RunView[] = [];
      for (const record of runs.values()) {
        observe(record, event);
        views.push(record.run.snapshot());
      }
      return views;
    },
    disposeForSender(senderId: number | string): void {
      for (const record of runs.values()) record.observers.delete(senderId);
    },
    dispose(): void {
      for (const record of runs.values()) disposeRun(record);
      runs.clear();
    },
  };
}
