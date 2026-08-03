import { createProviderFetch } from "@/ai-system/adapters/providerFetch";
import { sha256Text } from "@/ai-system/adapters/sha256";
import { AI_CHANNELS } from "@/ai-system/core/channels";
import { DEFAULT_RUN_TOKEN_BUDGET, MAX_ACTIVE_RUNS, MAX_RUN_TASKS } from "@/ai-system/core/limits";
import type { PermissionsStoreLike } from "@/ai-system/core/permissions";
import type {
  AgentExecutionDeps,
  ExecutionSelectorFactory,
  KnowledgeBankLike,
  ResolvedExecution,
  SandboxRunner,
} from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import { redactText } from "@/ai-system/core/redact";
import type {
  ResolveRunPlanRequest,
  ResolveRunPlanResult,
  ResolveRunToolRequest,
  RunEventEnvelope,
  RunView,
  StartRunRequest,
  StartRunResult,
} from "@/ai-system/core/runEvents";
import type {
  AISettings,
  CreateTeamRun,
  DiagnosticsBundle,
  EngineOps,
  ProviderTransport,
  ResolvedWorker,
  TeamRunPort,
} from "@/ai-system/core/types";
import { executionTargetKey, workerAllowedTools } from "@/ai-system/core/workers";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import type { WorkerHost } from "./workerHost";

interface RunRecord<TEvent> {
  runId: string;
  run: TeamRunPort;
  observers: Map<number | string, TEvent>;
  // Distinct per-target execution backends resolved for this run's roster; disposed (once each) when the run is.
  executions?: ResolvedExecution[];
}

export interface RunHostDeps<TEvent> {
  senderId: (event: TEvent) => number | string;
  send: (event: TEvent, channel: typeof AI_CHANNELS.runEvent, payload: RunEventEnvelope) => void;
  getAISettings: () => Promise<AISettings> | AISettings;
  resolveProviderAccess: (providerId?: string) => Promise<ResolvedProvider>;
  providerTransport: ProviderTransport;
  buildAgentPrompt: (bundle?: DiagnosticsBundle) => string;
  createTeamRun?: CreateTeamRun;
  runSandboxed?: SandboxRunner;
  engineOps?: EngineOps;
  workspaceAccess?: IWorkspaceAccess;
  // Run-scoped factory that resolves each worker's execution backend from its target. Absent ⇒ every worker uses
  // the run-level engineOps/workspaceAccess (host), the pre-Runs-on behaviour.
  createExecutionSelector?: ExecutionSelectorFactory;
  permissionsStore?: PermissionsStoreLike;
  knowledgeBank?: KnowledgeBankLike;
  webSearcher?: (query: string) => Promise<{ text: string }>;
  workerHost?: WorkerHost;
  // Runs the host should already hold at creation — CONTAINER_DESKTOP_MOCK only, so the Runs list has content
  // across every phase on a cold start. They are ordinary records: the same stop/approve/snapshot path applies.
  seedRuns?: TeamRunPort[];
  reportError: (message: string, id: string | undefined, error: unknown) => void;
  logger?: { error: (...args: unknown[]) => void };
}

// Runs are deliberately EPHEMERAL: unlike threads there is no durable record, so a reload loses an
// in-flight run. That keeps the trust boundary small and matches a Run being an
// explicit, bounded action rather than a resumable thread.
export function createRunHost<TEvent>(deps: RunHostDeps<TEvent>) {
  const runs = new Map<string, RunRecord<TEvent>>();

  const observe = (record: RunRecord<TEvent>, event: TEvent): void => {
    record.observers.set(deps.senderId(event), event);
  };

  const requireRun = (event: TEvent, runId: string): RunRecord<TEvent> => {
    const record = runs.get(runId);
    if (!record) throw new Error("AI: run not found");
    observe(record, event);
    return record;
  };

  const broadcast = (record: RunRecord<TEvent>, envelope: RunEventEnvelope): void => {
    for (const [senderId, event] of record.observers) {
      try {
        deps.send(event, AI_CHANNELS.runEvent, envelope);
      } catch (error) {
        record.observers.delete(senderId);
        deps.reportError("AI: run observer delivery failed", record.runId, error);
      }
    }
  };

  // Seed runs the host should already hold (mock only). A seed run MAY expose attachEmit — a hook to stream its
  // own state changes back to observers — so a baked run reacts to gate actions in the live UI, not just host-side.
  for (const run of deps.seedRuns ?? []) {
    const runId = run.snapshot().runId;
    const record: RunRecord<TEvent> = { runId, run, observers: new Map<number | string, TEvent>() };
    runs.set(runId, record);
    (run as TeamRunPort & { attachEmit?: (emit: (envelope: RunEventEnvelope) => void) => void }).attachEmit?.(
      (envelope) => broadcast(record, envelope),
    );
  }

  const disposeRun = (record: RunRecord<TEvent>): void => {
    void record.run.dispose().catch((error) => deps.reportError("AI: run disposal failed", record.runId, error));
    // Tear down the run's execution backends (removes any sandbox container). dispose() is idempotent per backend.
    for (const execution of record.executions ?? []) {
      void execution
        .dispose()
        .catch((error) => deps.reportError("AI: worker sandbox teardown failed", record.runId, error));
    }
  };

  const ensureCapacity = (): void => {
    if (runs.size < MAX_ACTIVE_RUNS) return;
    for (const [runId, record] of runs) {
      if (["done", "stopped", "error", "idle"].includes(record.run.snapshot().phase)) {
        runs.delete(runId);
        disposeRun(record);
        return;
      }
    }
    throw new Error("AI: too many active runs");
  };

  return {
    async start(event: TEvent, request: StartRunRequest): Promise<StartRunResult> {
      const { createTeamRun, runSandboxed, knowledgeBank } = deps;
      if (!createTeamRun || !runSandboxed || !knowledgeBank) throw new Error("AI: team runs are not available");
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
      // Execution capabilities shared by every task in the run (target-specific engineOps/workspaceAccess are
      // layered on per worker below). The coordinator + any host worker use the run-level engineOps/workspaceAccess.
      const searchKnowledge = (query: string) => knowledgeBank.search(query);
      const webSearch = settings.webSearch && deps.webSearcher ? deps.webSearcher : undefined;

      // One selector for this run: a worker's "Runs on" target resolves to its own backend (a sandbox is created
      // here and disposed when the run ends). Absent factory ⇒ every worker keeps the run-level host backend.
      const selector = deps.createExecutionSelector?.(request.runId);
      const executions = new Set<ResolvedExecution>();

      const requestedWorkers = deps.workerHost?.resolveIds(request.workerIds ?? []) ?? [];
      const permissionContext = async (
        targetId: string,
        subject: { kind: "access-profile" | "worker"; id: string },
        workspace?: IWorkspaceAccess,
      ) => {
        let root = settings.workspaceRoot?.trim() || "unconfigured";
        try {
          root = (await workspace?.root()) || root;
        } catch {
          // Missing target workspace keeps a distinct fail-closed identity instead of borrowing the host root.
          root = `unavailable:${targetId}`;
        }
        return {
          workspaceId: await sha256Text(`workspace:${root}`),
          targetId,
          subject,
          contentTrustEpoch: "application",
        };
      };
      const providerCache = new Map<string, ResolvedProvider>();
      const workers: ResolvedWorker[] = [];
      try {
        for (const definition of requestedWorkers) {
          const cacheKey = definition.providerId ?? "";
          let access = cacheKey ? providerCache.get(cacheKey) : resolved;
          if (!access) {
            access = await deps.resolveProviderAccess(definition.providerId);
            providerCache.set(cacheKey, access);
          }
          const workerResolved: ResolvedProvider = { ...access, model: definition.model?.trim() || access.model };

          // Resolve the worker's execution target (host reuses the run defaults). Selection can create a sandbox or
          // reach a connection; a failure (e.g. an offline connection) rejects the run start with a clear message
          // rather than silently falling back to the host.
          const resolvedExec = selector ? await selector.select(definition.execution) : undefined;
          if (resolvedExec) executions.add(resolvedExec);
          const workerExecution: AgentExecutionDeps | undefined = resolvedExec
            ? {
                runSandboxed,
                searchKnowledge,
                webSearch,
                engineOps: resolvedExec.engineOps,
                workspaceAccess: resolvedExec.workspaceAccess,
              }
            : undefined;

          workers.push({
            id: definition.id,
            name: definition.name,
            specialty: definition.specialty,
            system: `${deps.buildAgentPrompt()}\n\n${definition.systemPrompt}`,
            resolved: workerResolved,
            providerFetch: createProviderFetch(deps.providerTransport, workerResolved),
            policy: definition.toolPolicy.mode,
            permissionContext: await permissionContext(
              executionTargetKey(definition.execution),
              { kind: "worker", id: definition.id },
              resolvedExec?.workspaceAccess,
            ),
            allowedTools: workerAllowedTools(definition),
            floorScope: resolvedExec?.floorScope,
            execution: workerExecution,
          });
        }
      } catch (error) {
        // A target failed to resolve — tear down any sandboxes already created for this roster before failing.
        for (const execution of executions) {
          void execution.dispose().catch(() => undefined);
        }
        throw error;
      }

      const execution: AgentExecutionDeps = {
        runSandboxed,
        searchKnowledge,
        webSearch,
        engineOps: deps.engineOps,
        workspaceAccess: deps.workspaceAccess,
      };

      const record: RunRecord<TEvent> = {
        runId: request.runId,
        observers: new Map<number | string, TEvent>(),
        executions: [...executions],
      } as RunRecord<TEvent>;
      observe(record, event);
      record.run = createTeamRun({
        runId: request.runId,
        goal: redactText(request.goal.trim()),
        taskSettings: {
          resolved,
          providerFetch: createProviderFetch(deps.providerTransport, resolved),
          coordinatorModel: request.coordinatorModel?.trim() || undefined,
          system: deps.buildAgentPrompt(),
          permissionMode,
          permissions,
          permissionContext: await permissionContext(
            "host",
            { kind: "access-profile", id: "operator" },
            deps.workspaceAccess,
          ),
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
    resolvePlan(event: TEvent, request: ResolveRunPlanRequest): Promise<ResolveRunPlanResult> {
      return requireRun(event, request.runId).run.resolvePlan(request.decision);
    },
    resolveTool(event: TEvent, request: ResolveRunToolRequest): Promise<ResolveRunPlanResult> {
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
    // reload re-attaches: on Tauri/Wails the host
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
