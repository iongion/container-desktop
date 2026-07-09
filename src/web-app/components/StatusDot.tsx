import type { ReactNode } from "react";

import type { StatusTone } from "@/web-app/screens/Container/health";

import "./StatusVisuals.css";

export interface StatusDotProps {
  // Semantic tone — reuses the containers' statusTone() output (success/warning/danger/muted).
  tone: StatusTone;
  // Optional trailing label (e.g. the healthcheck text "unhealthy"); inherits the tone color.
  label?: ReactNode;
  className?: string;
}

// A small colored status ball with an optional label, colored by tone. Reuses the exact palette of the
// containers table's .ContainerStatus dot (StatusVisuals.css), unscoped so Inspect panels can use it — e.g.
// the Health row of a container Summary.
export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span className={`StatusDotWrap ${className ?? ""}`.trim()} data-tone={tone}>
      <span className="StatusDot" />
      {label != null ? <span className="StatusDotLabel">{label}</span> : null}
    </span>
  );
}
