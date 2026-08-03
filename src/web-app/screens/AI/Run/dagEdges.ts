// Pure dependency-edge derivation for the Run DAG. Kept out of the screen (like runBoard.ts) so the mapping
// from tasks to the edges the connector overlay draws is unit-testable without rendering.

import type { RunTaskView } from "@/ai-system/core/runEvents";

export interface RunGraphEdge {
  // Upstream task the arrow starts from.
  from: string;
  // Dependent task the arrow points to.
  to: string;
}

// One edge per (task, dependency) where the dependency is a task actually in the plan. A dependency on an id the
// plan does not contain is dropped (it would have no node to attach to), and duplicate edges are collapsed — the
// same defensiveness runTaskWaves applies when it lays the graph out.
export function runGraphEdges(tasks: readonly RunTaskView[]): RunGraphEdge[] {
  const known = new Set(tasks.map((task) => task.id));
  const edges: RunGraphEdge[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    for (const from of task.dependsOn) {
      if (!known.has(from) || from === task.id) continue;
      const key = `${from}\u0000${task.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to: task.id });
    }
  }
  return edges;
}
