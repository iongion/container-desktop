import type { RunPlanTask, RunTaskStatus } from "@/ai-system/core/runEvents";

// Pure plan handling for goal mode: turn the coordinator's reply into a validated task DAG, and answer the two
// scheduling questions the driver asks each round. Dependency-free by design (no OMA, no adapter, no host port)
// so the interesting logic — tolerant parsing, cycle rejection, cascading skips — is unit-testable on its own.

export type PlanParseResult = { ok: true; tasks: RunPlanTask[] } | { ok: false; error: string };

const MAX_ID_CHARS = 64;
const MAX_TITLE_CHARS = 120;

// Scan for the outermost balanced JSON object, ignoring braces inside strings. Models wrap the plan in prose or
// ```json fences despite being told not to, and a decomposition turn is too expensive to discard over formatting.
function extractJsonObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function dependentsByTask(tasks: RunPlanTask[]): Map<string, string[]> {
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), task.id]);
    }
  }
  return dependents;
}

// Kahn's algorithm: if any task never reaches indegree zero the graph has a cycle. A self-dependency is just the
// degenerate case, and is caught the same way.
function hasCycle(tasks: RunPlanTask[]): boolean {
  const indegree = new Map(tasks.map((task) => [task.id, task.dependsOn.length]));
  const dependents = dependentsByTask(tasks);
  const queue = tasks.filter((task) => task.dependsOn.length === 0).map((task) => task.id);
  let settled = 0;
  while (queue.length > 0) {
    const id = queue.shift() as string;
    settled += 1;
    for (const dependent of dependents.get(id) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  return settled !== tasks.length;
}

// Just enough of a worker to bind and label a task. The parser must stay dependency-free, so it takes this
// rather than the full WorkerDefinition.
export interface PlanWorkerRef {
  id: string;
  name: string;
}

// `roster` absent or empty ⇒ `workerId` is ignored and dropped, exactly as any unknown field is, which is the
// pre-workers behaviour. With a roster, every task MUST resolve to one of its workers.
export function parsePlan(text: string, maxTasks: number, roster?: readonly PlanWorkerRef[]): PlanParseResult {
  const start = text.indexOf("{");
  if (start < 0) return { ok: false, error: "The coordinator returned no plan." };
  const json = extractJsonObject(text, start);
  if (!json) return { ok: false, error: "The coordinator's plan was not valid JSON." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "The coordinator's plan was not valid JSON." };
  }

  const raw = (parsed as { tasks?: unknown } | null)?.tasks;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "The coordinator's plan contained no tasks." };
  }
  if (raw.length > maxTasks) {
    return { ok: false, error: `The coordinator's plan has too many tasks (${raw.length} > ${maxTasks}).` };
  }

  const tasks: RunPlanTask[] = [];
  const ids = new Set<string>();
  for (const entry of raw) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, MAX_ID_CHARS) : "";
    const title = typeof record.title === "string" ? record.title.trim().slice(0, MAX_TITLE_CHARS) : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!id || !title || !description) {
      return { ok: false, error: "A task in the plan is missing an id, title or description." };
    }
    if (ids.has(id)) return { ok: false, error: `The plan has a duplicate task id: ${id}.` };
    ids.add(id);
    // Deduplicated so a repeated edge cannot inflate the indegree and read as a false cycle.
    const dependsOn = Array.isArray(record.dependsOn)
      ? [
          ...new Set(
            record.dependsOn.filter((value): value is string => typeof value === "string").map((v) => v.trim()),
          ),
        ]
      : [];
    const agent =
      typeof record.agent === "string" && record.agent.trim() ? record.agent.trim().slice(0, MAX_TITLE_CHARS) : "agent";

    if (roster && roster.length > 0) {
      const named = typeof record.workerId === "string" ? record.workerId.trim().slice(0, MAX_ID_CHARS) : "";
      // A single-worker roster is unambiguous, so an omitted assignment binds to it rather than failing: weak
      // local models routinely drop optional fields, and there is nothing here to choose wrongly between.
      const bound = named ? roster.find((worker) => worker.id === named) : roster.length === 1 ? roster[0] : undefined;
      if (!bound) {
        return named
          ? { ok: false, error: `Task ${id} names an unknown worker: ${named}.` }
          : { ok: false, error: `Task ${id} was not assigned to a worker.` };
      }
      // The worker's name becomes the display agent, so every existing render site shows it with no UI change.
      tasks.push({ id, title, description, dependsOn, agent: bound.name, workerId: bound.id });
      continue;
    }
    tasks.push({ id, title, description, dependsOn, agent });
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) {
        return { ok: false, error: `Task ${task.id} depends on an unknown task: ${dependency}.` };
      }
    }
  }
  if (hasCycle(tasks)) return { ok: false, error: "The plan's task dependencies form a cycle." };
  return { ok: true, tasks };
}

// The tasks the scheduler may dispatch right now: still pending, with every dependency completed. A failed or
// skipped dependency never unlocks its dependents — those are cascaded to "skipped" instead.
export function readyTaskIds(tasks: RunPlanTask[], statuses: Record<string, RunTaskStatus>): string[] {
  return tasks
    .filter((task) => statuses[task.id] === "pending" && task.dependsOn.every((dep) => statuses[dep] === "complete"))
    .map((task) => task.id);
}

// Everything downstream of a task that failed, so no worker is ever dispatched against missing input. Traversal
// stops at a task that already settled: it keeps its own outcome, and its own dependents stay viable through it.
export function dependentsToSkip(
  tasks: RunPlanTask[],
  failedId: string,
  statuses: Record<string, RunTaskStatus>,
): string[] {
  const dependents = dependentsByTask(tasks);
  const skipped = new Set<string>();
  const queue = [...(dependents.get(failedId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (skipped.has(id) || statuses[id] !== "pending") continue;
    skipped.add(id);
    queue.push(...(dependents.get(id) ?? []));
  }
  return [...skipped];
}
