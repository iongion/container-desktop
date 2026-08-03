import type { WorkerExecutionTarget } from "@/ai-system/core/workers";

type Translate = (key: string) => string;

export interface NamedConnection {
  id: string;
  name: string;
}

// A short, human label for where a worker runs, for the list + cards. Falls back to the raw connection id when the
// connection is unknown (e.g. removed since the worker was saved). Only the fixed words are translated; connection
// names, container ids and image references are data.
export function executionTargetLabel(
  target: WorkerExecutionTarget | undefined,
  connections: readonly NamedConnection[],
  t: Translate,
): string {
  if (!target || target.kind === "host") return t("Host");
  const name = connections.find((c) => c.id === target.connectionId)?.name ?? target.connectionId;
  switch (target.kind) {
    case "remote":
      return `${name} (SSH)`;
    case "container":
      return `${target.containerId.slice(0, 12)} @ ${name}`;
    case "sandbox":
      return `${t("Sandbox")}: ${target.image}`;
  }
}
