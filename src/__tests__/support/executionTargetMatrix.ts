// Shared worker-execution-target scenario matrix. This is the ONE matrix the user asked for: the same scenarios
// run in a hermetic MOCK implementation (VirtualEngineHost) and a REAL implementation (live podman/docker CLI),
// differing only in the injected ConnectionExecHost. Both drive the REAL createRunHost → real
// createExecutionSelector → real createExecWorkspaceAccess, so a worker genuinely resolves its "Runs on" target,
// writes and reads a file WHERE IT RUNS, and its sandbox is torn down when the run ends.
//
// The mock impl proves the LOGIC (roundtrip through the real selector/workspace); the real impl proves the
// TRANSPORT (the engine actually forwards stdin and starts/removes a container). Same scenarios, two lenses.

import type { ConnectionExecHost } from "@/ai-system/core/ports";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { RunPhase, RunView } from "@/ai-system/core/runEvents";
import type {
  AISettings,
  CreateTeamRun,
  DiagnosticsBundle,
  EngineConnectionRef,
  EngineOps,
  ProviderTransport,
  TeamRunPort,
} from "@/ai-system/core/types";
import type { WorkerDefinition, WorkerExecutionTarget } from "@/ai-system/core/workers";
import { createRunHost } from "@/ai-system/host/runHost";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { createExecutionSelector } from "@/platform/capabilities/executionSelector";

// What a caller supplies to run the matrix against one execution-host implementation.
export interface ExecutionMatrixContext {
  // Connection id the off-host targets live on (any string the ConnectionExecHost understands).
  connectionId: string;
  connectionExec: ConnectionExecHost;
  // The host target's workspace (real node dir for the live impl; a virtual one for mock).
  localWorkspace: IWorkspaceAccess;
  // Sandbox image (e.g. alpine:3 / docker.io/library/alpine:3).
  image: string;
  // Whether the remote (SSH) target should be exercised — false when no SSH host is configured.
  supportsRemote: boolean;
  // Whether a container engine daemon is reachable here — false gates OUT the sandbox + existing-container
  // targets (e.g. a Windows remote reachable over WSL but with Docker Desktop not running). Default true.
  supportsEngine?: boolean;
  // Id of a pre-created, long-lived, UNLABELED container for the existing-container target (undefined ⇒ skip).
  existingContainerId?: string;
  // How many AI sandbox containers this run still has alive — polled to 0 after disposal proves teardown.
  pendingSandboxes(): Promise<number> | number;
  cleanup?(): Promise<void> | void;
}

const RUN_ID_PREFIX = "runs-on-matrix";

// engineOps that echoes back the connectionId it was called with as a container id, so a scenario can read which
// connection the worker's (selector-scoped) engineOps defaulted to. Shared by both implementations — pure.
function recordingEngineOps(): EngineOps {
  const notImplemented = () => Promise.reject(new Error("not used in the matrix"));
  return {
    listConnections: () => [],
    listContainers: (opts?: EngineConnectionRef) => Promise.resolve([{ Id: opts?.connectionId ?? "none" }]),
    inspectContainer: notImplemented,
    getContainerLogs: notImplemented,
    getContainerStats: notImplemented,
    startContainer: notImplemented,
    stopContainer: notImplemented,
    restartContainer: notImplemented,
    pauseContainer: notImplemented,
    unpauseContainer: notImplemented,
    removeContainer: notImplemented,
    listImages: () => Promise.resolve([]),
    inspectImage: notImplemented,
    pullImage: notImplemented,
    removeImage: notImplemented,
    listNetworks: () => Promise.resolve([]),
    inspectNetwork: notImplemented,
    removeNetwork: notImplemented,
    listVolumes: () => Promise.resolve([]),
    inspectVolume: notImplemented,
    removeVolume: notImplemented,
  };
}

const stubProvider: ResolvedProvider = {
  id: "test",
  kind: "openai-compatible",
  baseURL: "http://127.0.0.1:0/v1",
  model: "test-model",
  isCloud: false,
  requiresKey: false,
  auth: { scheme: "none" },
  discovery: "manual",
};

const stubTransport: ProviderTransport = {
  request: () => Promise.reject(new Error("no model call in the matrix")),
  dispose: () => undefined,
};

const stubSettings: AISettings = {
  defaultProvider: "test",
  webSearch: false,
  providers: {},
  permissionMode: "ask",
};

function worker(id: string, execution: WorkerExecutionTarget): WorkerDefinition {
  return {
    id,
    name: id,
    specialty: `does ${id} work`,
    systemPrompt: "",
    toolPolicy: { mode: "all", allowed: [] },
    execution,
    createdAt: 0,
    updatedAt: 0,
  };
}

// The observable outcome the scenario driver records per worker.
interface WorkerOutcome {
  floorScope: string | undefined;
  workspaceRoot: string | undefined;
  read: string;
  editedTo: string;
  listNames: string[];
  statKind: string;
  statSize: number;
  globHit: boolean;
  grepText: string | undefined;
  execStdout: string;
  execCode: number | null;
  engineConnectionId: string;
}

// Exercise one worker's resolved backend end-to-end: write → read → edit → list → stat → glob → grep → exec, plus
// an engineOps probe. Returns everything the assertions check.
async function driveWorker(
  ws: IWorkspaceAccess,
  engineOps: EngineOps | undefined,
  marker: string,
  floorScope: string | undefined,
): Promise<WorkerOutcome> {
  await ws.write("greeting.txt", `hello ${marker}\n`);
  const read = await ws.read("greeting.txt");
  const edit = await ws.edit("greeting.txt", "hello", "HELLO");
  const listNames = (await ws.list(".")).map((e) => e.name);
  const stat = await ws.stat("greeting.txt");
  const glob = await ws.glob("*.txt");
  const grep = await ws.grep("HELLO");
  const exec = await ws.exec("echo", [marker]);
  const probe = engineOps ? await engineOps.listContainers({}) : [];
  return {
    floorScope,
    workspaceRoot: await ws.root(),
    read,
    editedTo: edit.after,
    listNames,
    statKind: stat.kind,
    statSize: stat.size,
    globHit: glob.includes("greeting.txt"),
    grepText: grep[0]?.text,
    execStdout: exec.stdout,
    execCode: exec.code,
    engineConnectionId: probe[0]?.Id ?? "none",
  };
}

// A TeamRun engine that runs NO model — it drives each resolved Worker through driveWorker and records the
// outcome, so the matrix proves the run host resolved and wired each target correctly.
function scenarioTeamRun(outcomes: Map<string, WorkerOutcome>): CreateTeamRun {
  return (options) => {
    let phase: RunPhase = "idle";
    const view = (): RunView => ({
      runId: options.runId,
      goal: options.goal,
      phase,
      lastSeq: 0,
      tasks: [],
      spans: [],
      approvals: [],
      synthesis: "",
      usage: { inputTokens: 0, outputTokens: 0 },
      planPending: false,
    });
    const port: TeamRunPort = {
      async start() {
        phase = "running";
        for (const w of options.taskSettings.workers ?? []) {
          const ws = w.execution?.workspaceAccess ?? options.taskSettings.execution.workspaceAccess;
          const engineOps = w.execution?.engineOps ?? options.taskSettings.execution.engineOps;
          if (!ws) throw new Error(`worker ${w.id} has no workspace access`);
          outcomes.set(w.id, await driveWorker(ws, engineOps, w.id, w.floorScope));
        }
        phase = "done";
        return { accepted: true, runId: options.runId, phase };
      },
      async resolvePlan() {
        return { accepted: true, phase };
      },
      async resolveToolApproval() {
        return { accepted: true, phase };
      },
      async cancel() {
        phase = "stopped";
      },
      snapshot: view,
      async dispose() {
        return undefined;
      },
    };
    return port;
  };
}

async function pollUntilZero(read: () => Promise<number> | number, timeoutMs = 15_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (value > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

// One roster entry: the worker plus what running it on its target must produce.
interface MatrixExpectation {
  id: string;
  want: { floor: string; root: string; conn: string };
  outcome?: WorkerOutcome;
}

export interface ExecutionMatrixObservations {
  accepted: boolean;
  runId: string;
  expectedRunId: string;
  entries: MatrixExpectation[];
  remainingSandboxes: number;
}

// Drive the matrix and RETURN what happened — no assertions, no test framework. Both arms share this: the
// hermetic Vitest arm (VirtualEngineHost) and the WebDriver arm that runs inside a shell against real engines.
export async function observeExecutionTargets(
  label: string,
  ctx: ExecutionMatrixContext,
): Promise<ExecutionMatrixObservations> {
  const runId = `${RUN_ID_PREFIX}-${label}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const offHostRoot = `/tmp/container-desktop-ai/${runId}`;
  const engineOps = recordingEngineOps();

  // Build the roster for exactly the targets this implementation supports.
  const definitions: { def: WorkerDefinition; want: MatrixExpectation["want"] }[] = [
    {
      def: worker("host-worker", { kind: "host" }),
      want: { floor: "strict", root: await ctx.localWorkspace.root(), conn: "none" },
    },
  ];
  if (ctx.supportsEngine !== false) {
    definitions.push({
      def: worker("sandbox-worker", { kind: "sandbox", connectionId: ctx.connectionId, image: ctx.image }),
      want: { floor: "sandbox", root: "/workspace", conn: ctx.connectionId },
    });
  }
  if (ctx.supportsRemote) {
    definitions.push({
      def: worker("remote-worker", { kind: "remote", connectionId: ctx.connectionId }),
      want: { floor: "strict", root: offHostRoot, conn: ctx.connectionId },
    });
  }
  if (ctx.existingContainerId) {
    definitions.push({
      def: worker("container-worker", {
        kind: "container",
        connectionId: ctx.connectionId,
        containerId: ctx.existingContainerId,
      }),
      want: { floor: "container", root: offHostRoot, conn: ctx.connectionId },
    });
  }

  const workerIndex = new Map(definitions.map((d) => [d.def.id, d.def]));
  const outcomes = new Map<string, WorkerOutcome>();

  const host = createRunHost<number>({
    senderId: (event) => event,
    send: () => undefined,
    getAISettings: () => stubSettings,
    resolveProviderAccess: () => Promise.resolve({ ...stubProvider }),
    providerTransport: stubTransport,
    buildAgentPrompt: (_bundle?: DiagnosticsBundle) => "system",
    createTeamRun: scenarioTeamRun(outcomes),
    runSandboxed: () =>
      Promise.resolve({ ok: true, tier: "ran", reason: "", code: 0, stdout: "", stderr: "", truncated: false }),
    engineOps,
    workspaceAccess: ctx.localWorkspace,
    createExecutionSelector: (id) =>
      createExecutionSelector({
        runId: id,
        engineOps,
        localWorkspace: ctx.localWorkspace,
        connectionExec: ctx.connectionExec,
      }),
    knowledgeBank: { search: () => Promise.resolve([]) },
    workerHost: {
      ready: () => Promise.resolve(),
      list: () => [...workerIndex.values()],
      save: () => Promise.resolve([...workerIndex.values()]),
      remove: () => Promise.resolve([...workerIndex.values()]),
      resolveIds: (ids) => ids.map((id) => workerIndex.get(id)).filter((d): d is WorkerDefinition => Boolean(d)),
    },
    reportError: () => undefined,
  });

  let started: { accepted?: boolean; runId?: string } | undefined;
  let startError: unknown;
  try {
    started = await host.start(1, {
      runId,
      goal: "exercise every execution target",
      workerIds: definitions.map((d) => d.def.id),
    });
  } catch (error) {
    startError = error;
  } finally {
    host.dispose();
  }
  // Always polled, even when the run failed to start — a leaked sandbox is worth reporting either way.
  const remainingSandboxes = await pollUntilZero(() => ctx.pendingSandboxes());
  await ctx.cleanup?.();
  if (startError) {
    throw startError;
  }

  return {
    accepted: started?.accepted === true,
    runId: `${started?.runId ?? ""}`,
    expectedRunId: runId,
    entries: definitions.map(({ def, want }) => ({ id: def.id, want, outcome: outcomes.get(def.id) })),
    remainingSandboxes,
  };
}

// The whole verification, framework-free: every check the matrix makes, as human-readable failures. An empty
// array means the matrix passed. Both arms report these in their own idiom, so neither can drift from the other.
export function verifyExecutionTargets(observations: ExecutionMatrixObservations): string[] {
  const failures: string[] = [];
  if (!observations.accepted || observations.runId !== observations.expectedRunId) {
    failures.push(
      `run was not accepted as ${observations.expectedRunId} (accepted=${observations.accepted}, runId=${observations.runId})`,
    );
  }

  for (const { id, want, outcome } of observations.entries) {
    if (!outcome) {
      failures.push(`worker ${id} did not run`);
      continue;
    }
    // Ran on the right target with the right floor + workspace root.
    if (outcome.floorScope !== want.floor) failures.push(`${id} floor: ${outcome.floorScope} !== ${want.floor}`);
    if (outcome.workspaceRoot !== want.root) failures.push(`${id} root: ${outcome.workspaceRoot} !== ${want.root}`);
    // The file write actually survived a read WHERE THE WORKER RUNS (catches the empty-file bug).
    if (outcome.read !== `hello ${id}\n`) failures.push(`${id} read: ${JSON.stringify(outcome.read)}`);
    if (!outcome.editedTo.startsWith("HELLO")) failures.push(`${id} edit: ${outcome.editedTo}`);
    if (!outcome.listNames.includes("greeting.txt")) failures.push(`${id} list: ${outcome.listNames.join(",")}`);
    if (outcome.statKind !== "file") failures.push(`${id} stat kind: ${outcome.statKind}`);
    if (!(outcome.statSize > 0)) failures.push(`${id} stat size: ${outcome.statSize}`);
    if (!outcome.globHit) failures.push(`${id} glob missed`);
    if (!`${outcome.grepText ?? ""}`.includes("HELLO")) failures.push(`${id} grep: ${outcome.grepText}`);
    if (outcome.execCode !== 0) failures.push(`${id} exec code: ${outcome.execCode}`);
    if (!outcome.execStdout.includes(id)) failures.push(`${id} exec stdout: ${outcome.execStdout}`);
    // engineOps defaulted to the worker's own connection (host = unscoped run default).
    if (outcome.engineConnectionId !== want.conn) {
      failures.push(`${id} engine conn: ${outcome.engineConnectionId} !== ${want.conn}`);
    }
  }

  if (observations.remainingSandboxes !== 0) {
    failures.push(`sandbox containers should be removed after the run, ${observations.remainingSandboxes} remain`);
  }
  return failures;
}
