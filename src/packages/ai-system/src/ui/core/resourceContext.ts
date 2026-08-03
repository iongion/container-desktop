// A compact, model-facing summary of the LIVE environment the renderer already knows.
// The Assistant attaches this as chat context so the model can answer "how many containers across my
// connections?" from real data — no tool call, no command execution. Kept pure (takes plain per-connection
// summaries the screen reads from the resource/app stores) so the formatting is unit-tested without React.
// The broker redacts it before egress like any other context.

export interface ConnectionResourceSummary {
  name: string;
  engine?: string;
  connected: boolean;
  containers: number;
  running: number;
  images: number;
  pods: number;
  volumes: number;
  networks: number;
  secrets: number;
}

type CountKey = "containers" | "running" | "images" | "pods" | "volumes" | "networks" | "secrets";
const COUNT_KEYS: CountKey[] = ["containers", "running", "images", "pods", "volumes", "networks", "secrets"];

function counts(c: Pick<ConnectionResourceSummary, CountKey>): string {
  // "containers=5 running=2 images=12 …" — for containers, `running` reads as a sub-count of the total.
  return COUNT_KEYS.map((k) => `${k}=${c[k]}`).join(" ");
}

export function buildResourceContext(connections: ConnectionResourceSummary[]): string {
  if (connections.length === 0) {
    return "No container connections are currently open.";
  }
  const lines = connections.map(
    (c) => `- "${c.name}" [${c.engine ?? "unknown"}, ${c.connected ? "connected" : "disconnected"}] ${counts(c)}`,
  );
  const totals = Object.fromEntries(
    COUNT_KEYS.map((k) => [k, connections.reduce((sum, c) => sum + c[k], 0)]),
  ) as Record<CountKey, number>;
  return [`Open container connections (${connections.length}):`, ...lines, `Totals: ${counts(totals)}`].join("\n");
}
