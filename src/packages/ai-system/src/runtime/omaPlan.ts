import type { RunPlanTask } from "@/ai-system/core/runEvents";
import { runEvent } from "@/ai-system/core/schemas";

function hasCycle(tasks: readonly RunPlanTask[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return tasks.some((task) => visit(task.id));
}

export function validateOmaPlan(
  tasks: readonly RunPlanTask[],
  maxTasks: number,
  workerIds: ReadonlySet<string>,
): string | null {
  if (tasks.length === 0) return "The coordinator returned no tasks.";
  if (tasks.length > maxTasks) return `The coordinator's plan has too many tasks (${tasks.length} > ${maxTasks}).`;
  const ids = new Set<string>();
  const titles = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) return `The plan has a duplicate task id: ${task.id}.`;
    ids.add(task.id);
    const title = task.title.trim().toLowerCase();
    if (titles.has(title)) return `The plan has a duplicate task title: ${task.title}.`;
    titles.add(title);
    if (workerIds.size > 0 && (!task.workerId || !workerIds.has(task.workerId))) {
      return `Task ${task.id} names an unknown or missing worker.`;
    }
  }
  for (const task of tasks) {
    const unknown = task.dependsOn.find((dependency) => !ids.has(dependency));
    if (unknown) return `Task ${task.id} depends on an unknown task: ${unknown}.`;
  }
  if (hasCycle(tasks)) return "The plan's task dependencies form a cycle.";
  const parsed = runEvent.safeParse({ type: "plan-ready", tasks });
  return parsed.success ? null : parsed.error.issues[0]?.message || "The coordinator returned an invalid plan.";
}
