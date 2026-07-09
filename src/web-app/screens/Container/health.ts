// Status tone for a container's leading ball / header badge. It is an at-a-glance combination of run state
// and healthcheck: while RUNNING the healthcheck wins (a running-but-unhealthy container reads red); when
// stopped the tone reflects HOW it stopped — a clean exit (0) or a deliberate stop signal (SIGINT/SIGKILL/
// SIGTERM) is neutral "off" grey, while any other non-zero exit is a crash/failure and reads red. Created/
// paused are amber; unknown is grey. This is what makes "not running because it crashed" stand out.

import { type Container, ContainerStateList } from "@/env/Types";

export type StatusTone = "success" | "warning" | "danger" | "muted";

const TONE_RANK: Record<StatusTone, number> = { muted: 0, success: 1, warning: 2, danger: 3 };

// Exit codes that mean a deliberate/clean stop rather than a crash: 0 (ok), 130 (SIGINT), 137 (SIGKILL),
// 143 (SIGTERM). Anything else non-zero is treated as a failure.
const CLEAN_EXIT_CODES = new Set([0, 130, 137, 143]);

type StatusInput = Pick<Container, "Computed" | "Status">;

// Exit code parsed from the list Status string ("Exited (137) 2 hours ago" on the docker-compat API).
function exitCodeFromStatus(status: string | undefined): number | undefined {
  const match = /exited \((-?\d+)\)/i.exec(status ?? "");
  return match ? Number(match[1]) : undefined;
}

export function statusTone(container: StatusInput): StatusTone {
  const state = container.Computed?.DecodedState;
  // Health only matters while RUNNING — a stopped container carries a stale last-health that we must ignore.
  if (state === ContainerStateList.RUNNING) {
    const health = container.Computed?.Health;
    if (health === "unhealthy") {
      return "danger";
    }
    if (health === "starting") {
      return "warning";
    }
    return "success"; // running + healthy, or running with no healthcheck
  }
  switch (state) {
    case ContainerStateList.CREATED:
    case ContainerStateList.PAUSED:
      return "warning";
    case ContainerStateList.ERROR:
    case ContainerStateList.DEGRADED:
      return "danger";
    case ContainerStateList.EXITED:
    case ContainerStateList.STOPPED: {
      const code = exitCodeFromStatus(container.Status);
      return code !== undefined && !CLEAN_EXIT_CODES.has(code) ? "danger" : "muted";
    }
    default:
      return "muted";
  }
}

// The run state with the exit code for stopped containers, e.g. "exited (1)" — for the status badge.
export function stateLabel(container: StatusInput): string {
  const state = container.Computed?.DecodedState ?? "";
  const code = exitCodeFromStatus(container.Status);
  return code !== undefined ? `${state} (${code})` : state;
}

// The healthcheck label, or undefined when the container declares no healthcheck — for the health badge.
export function healthLabel(container: StatusInput): string | undefined {
  return container.Computed?.Health;
}

// The ball's tooltip. Mirrors statusTone's "health only while RUNNING" rule: a stopped container's last
// health is stale, so the label falls back to the run state (with exit code). This keeps the tooltip from
// ever contradicting the dot — e.g. a neutral "off" dot that claims "unhealthy".
export function statusLabel(container: StatusInput): string {
  const health = container.Computed?.Health;
  if (health && container.Computed?.DecodedState === ContainerStateList.RUNNING) {
    return health;
  }
  return stateLabel(container);
}

// A group's single ball: the worst member's tone (danger > warning > success > muted) + its status label.
// The first member seeds the result, so an all-off group still gets a representative label (never a blank
// tooltip); any strictly-worse member then takes over. An empty group is muted with no label.
export function aggregateStatus(containers: StatusInput[]): { tone: StatusTone; label: string } {
  let worst: { tone: StatusTone; label: string } | undefined;
  for (const container of containers) {
    const tone = statusTone(container);
    if (!worst || TONE_RANK[tone] > TONE_RANK[worst.tone]) {
      worst = { tone, label: statusLabel(container) };
    }
  }
  return worst ?? { tone: "muted", label: "" };
}
