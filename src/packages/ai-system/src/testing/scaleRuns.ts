// Synthetic Run seeds for exercising the Runs UI AT SCALE in the mock app (never production; testing/ is
// DCE'd). Two independent stressors, both schema-valid RunViews so they survive the client-bridge push validation:
//   - one planPending run with up to MAX_RUN_TASKS tasks (the product's real per-run ceiling — a bigger run is
//     rejected by runView validation, so 32 is the honest worst case for the plan list + task-graph waves), and
//   - N finished/running Runs for the Runs LIST (no per-list cap → hundreds are realistic in a dev project).
// Gated by CONTAINER_DESKTOP_MOCK_SCALE="runs:300,tasks:32"; parsing is pure so it is unit-tested without env.

import { MAX_RUN_TASKS } from "@/ai-system/core/limits";
import type { RunApprovalView, RunTaskStatus, RunTaskView, RunView } from "@/ai-system/core/runEvents";

export interface ScaleSpec {
  runs: number;
  tasks: number;
}

// Parse "runs:300,tasks:32" (either key optional, order-free). Returns null when nothing scalable is requested.
export function parseScaleSpec(raw: string | undefined | null): ScaleSpec | null {
  if (!raw) return null;
  const spec: ScaleSpec = { runs: 0, tasks: 0 };
  for (const part of raw.split(",")) {
    const [key, value] = part.split(":").map((piece) => piece.trim());
    const n = Number.parseInt(value ?? "", 10);
    if (!Number.isFinite(n) || n < 0) continue;
    if (key === "runs") spec.runs = n;
    else if (key === "tasks") spec.tasks = n;
  }
  return spec.runs > 0 || spec.tasks > 0 ? spec : null;
}

// Alternate two roles so the graph shows a realistic mix of workers/avatars.
function scaleTask(index: number, dependsOn: string[]): RunTaskView {
  const inspector = index % 2 === 1;
  return {
    id: `t${index}`,
    title: `Scale task ${index}`,
    description: `Synthetic task ${index} generated to exercise the run view at scale.`,
    dependsOn,
    agent: inspector ? "Inspector" : "Editor",
    workerId: inspector ? "mock-worker-inspector" : "mock-worker-editor",
    status: "pending",
    output: "",
  };
}

const TASKS_PER_WAVE = 8;

// One plan-pending run with `count` tasks (clamped to the product cap). Tasks fan into waves of TASKS_PER_WAVE:
// a wave's tasks are mutually independent (parallel), and each new wave depends on the previous wave's last task,
// so BOTH the plan `<ol>` and the task-graph waves are stressed to the real ceiling.
export function buildScaleRun(count: number): RunView {
  const n = Math.min(Math.max(count, 0), MAX_RUN_TASKS);
  const tasks: RunTaskView[] = [];
  for (let i = 1; i <= n; i++) {
    const wave = Math.floor((i - 1) / TASKS_PER_WAVE);
    const dependsOn = wave === 0 ? [] : [`t${wave * TASKS_PER_WAVE}`];
    tasks.push(scaleTask(i, dependsOn));
  }
  return {
    runId: "scale-plan",
    goal: `Scale run — ${n} tasks (product cap ${MAX_RUN_TASKS})`,
    phase: "awaiting-plan",
    lastSeq: 0,
    tasks,
    spans: [],
    approvals: [],
    synthesis: "",
    usage: { inputTokens: 1234, outputTokens: 5678 },
    planPending: true,
  };
}

// A running snapshot whose tasks span EVERY RunTaskStatus, so the task-graph cells render all their visual states
// (dot colour, left-border tint, state chip) and clicking a finished/failed node shows real transcript text.
// Each awaiting-approval task carries a matching pending approval, because a task blocks precisely BECAUSE a tool
// is waiting on a decision — that also exercises the ApprovalPrompt allow/reject branch at scale.
const GRAPH_STATUS_CYCLE: RunTaskStatus[] = [
  "complete",
  "complete",
  "running",
  "awaiting-approval",
  "failed",
  "skipped",
  "pending",
  "complete",
];

function graphTask(index: number, dependsOn: string[], status: RunTaskStatus): RunTaskView {
  const inspector = index % 2 === 1;
  const task: RunTaskView = {
    id: `t${index}`,
    title: `Scale task ${index}`,
    description: `Synthetic task ${index} in a mixed-state run.`,
    dependsOn,
    agent: inspector ? "Inspector" : "Editor",
    workerId: inspector ? "mock-worker-inspector" : "mock-worker-editor",
    status,
    output: "",
  };
  if (status === "complete") task.output = `Task ${index} finished — 3 files inspected, no blocking issues found.`;
  else if (status === "running") task.output = `Working on task ${index}… scanning container configuration.`;
  else if (status === "failed") task.error = `Task ${index} failed: command exited with code 1.`;
  else if (status === "skipped") task.error = "dependency failed";
  // A dispatched task ran on a model (two distinct families, mirroring the two workers) — a still-pending or
  // skipped task never started, so it carries none. Lets the run detail show `data-model` at scale.
  if (status !== "pending" && status !== "skipped") task.model = inspector ? "gpt-4o-mini" : "claude-sonnet-5";
  return task;
}

// Companion to buildScaleRun: same wave shape, but the run is mid-flight so the graph shows the full status
// palette rather than a wall of PENDING.
export function buildScaleGraphRun(count: number): RunView {
  const n = Math.min(Math.max(count, 0), MAX_RUN_TASKS);
  const tasks: RunTaskView[] = [];
  const approvals: RunApprovalView[] = [];
  for (let i = 1; i <= n; i++) {
    const wave = Math.floor((i - 1) / TASKS_PER_WAVE);
    const dependsOn = wave === 0 ? [] : [`t${wave * TASKS_PER_WAVE}`];
    const status = GRAPH_STATUS_CYCLE[(i - 1) % GRAPH_STATUS_CYCLE.length];
    tasks.push(graphTask(i, dependsOn, status));
    if (status === "awaiting-approval") {
      approvals.push({
        approvalId: `ap${i}`,
        taskId: `t${i}`,
        toolCallId: `tc${i}`,
        tool: "run_command",
        title: `Run a shell command for task ${i}`,
        args: { command: `podman inspect scale-${i}` },
        reason: "This tool runs a command on your machine before the worker can continue.",
        status: "pending",
      });
    }
  }
  return {
    runId: "scale-graph",
    goal: `Scale graph — mixed task states (${n} tasks)`,
    phase: "running",
    lastSeq: n,
    tasks,
    spans: [],
    approvals,
    synthesis: "",
    usage: { inputTokens: 48_000, outputTokens: 16_000 },
    planPending: false,
  };
}

const LIST_PHASES = ["done", "running", "stopped"] as const;

// Per-phase task templates so each synthetic list run is PHASE-COHERENT — a state the real system can actually
// produce. A run past planning has a real plan and real token usage; `done` has every task settled plus a
// synthesis; `stopped` was interrupted after some work. (The old shape — a `done` run with zero tasks and zero
// tokens — is impossible, and made the card foot + run detail wrongly read "Planning… / breaking your goal into
// tasks.")
const LIST_PHASE_TASKS: Record<(typeof LIST_PHASES)[number], RunTaskStatus[]> = {
  done: ["complete", "complete", "complete"],
  running: ["complete", "running", "pending"],
  stopped: ["complete", "pending", "pending"],
};

function listTask(runId: string, index: number, status: RunTaskStatus): RunTaskView {
  const inspector = index % 2 === 1;
  const task: RunTaskView = {
    id: `${runId}-t${index}`,
    title: `Task ${index}`,
    description: `Synthetic task ${index} for ${runId}.`,
    dependsOn: index === 1 ? [] : [`${runId}-t${index - 1}`],
    agent: inspector ? "Inspector" : "Editor",
    workerId: inspector ? "mock-worker-inspector" : "mock-worker-editor",
    status,
    output: status === "complete" ? `Task ${index} finished — no blocking issues found.` : "",
  };
  if (status !== "pending") task.model = inspector ? "gpt-4o-mini" : "claude-sonnet-5";
  return task;
}

// `count` finished/active Runs for the Runs LIST — varied phases, each carrying a coherent little plan so the
// board/table (and a run's detail on click) render a real, believable run without any single run being huge.
export function buildScaleRunList(count: number): RunView[] {
  const runs: RunView[] = [];
  for (let i = 1; i <= count; i++) {
    const phase = LIST_PHASES[i % LIST_PHASES.length];
    const tasks = LIST_PHASE_TASKS[phase].map((status, index) => listTask(`sg${i}`, index + 1, status));
    const completed = tasks.filter((task) => task.status === "complete").length;
    runs.push({
      runId: `sg${i}`,
      goal: `Synthetic goal ${i} — exercise the Runs list at scale.`,
      phase,
      lastSeq: tasks.length,
      tasks,
      spans: [],
      approvals: [],
      synthesis: phase === "done" ? `Run ${i} completed: ${completed} tasks ran, no blocking issues found.` : "",
      usage: { inputTokens: 1200 * completed + 800, outputTokens: 600 * completed + 400 },
      planPending: false,
    });
  }
  return runs;
}

// The combined scale seed set from a spec: the plan-gate run and its mixed-state twin first, then the long list.
export function buildScaleRuns(spec: ScaleSpec): RunView[] {
  const runs: RunView[] = [];
  if (spec.tasks > 0) {
    runs.push(buildScaleRun(spec.tasks));
    runs.push(buildScaleGraphRun(spec.tasks));
  }
  if (spec.runs > 0) runs.push(...buildScaleRunList(spec.runs));
  return runs;
}

// Read the scale knob: process.env on the vitest (node) path, else a globalThis value the webview
// shell bridges expose (mirroring CONTAINER_DESKTOP_MOCK) — the Tauri/Wails renderer has no `process`, so without
// the fallback the Runs-at-scale seed would never seed in a webview. Guarded so importing this never throws.
export function readMockScaleSpec(): ScaleSpec | null {
  const fromProcess = typeof process !== "undefined" ? process.env?.CONTAINER_DESKTOP_MOCK_SCALE : undefined;
  const fromGlobal = (globalThis as { CONTAINER_DESKTOP_MOCK_SCALE?: string }).CONTAINER_DESKTOP_MOCK_SCALE;
  return parseScaleSpec(fromProcess ?? fromGlobal);
}
