import type { Container, ContainerState } from "@/container-client/types/container";
import { t } from "@/i18n";
import { StatePill } from "@/web-app/components/StatePill";
import { StatusDot } from "@/web-app/components/StatusDot";

import { statusTone } from "./health";
import "./ContainerStatusPill.css";

export interface ContainerStatusPillProps {
  container: Pick<Container, "Computed" | "State" | "Status">;
  className?: string;
}

// A two-cell status badge for a container: `[ ● health | run-state ]`, a rounded rectangle whose left cell is
// the healthcheck (a tone-colored dot + label, reusing StatusDot; "—" when the container declares no
// healthcheck) and whose right cell is the run state (reusing StatePill's data-state palette). It derives from
// the same helpers as the Inspect Summary rows (health.ts / StatePill), so the header badge and the Summary
// never disagree. Reusable anywhere a container's at-a-glance status belongs — currently the detail header.
export function ContainerStatusPill({ container, className }: ContainerStatusPillProps) {
  const state =
    container.Computed?.DecodedState ??
    (typeof container.State === "string" ? container.State : (container.State as ContainerState)?.Status) ??
    "unknown";
  const health = container.Computed?.Health;
  return (
    <span className={`ContainerStatusPill ${className ?? ""}`.trim()}>
      <StatusDot tone={health ? statusTone(container) : "muted"} label={health ? t(health) : "—"} />
      <StatePill state={state} />
    </span>
  );
}
