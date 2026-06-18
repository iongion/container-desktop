// components/EngineCell.tsx — per-row engine marker for the always-merged resource lists. Shows the
// owning engine as a colored dot (its standalone --engine-accent-* token, independent of the active
// `unified` chrome) plus the engine name; the title carries the connection name so multiple connections
// of the same engine (e.g. two Podman remotes) stay distinguishable. Pairs with the row-left accent
// border (tr[data-engine-row]) and the sortable/filterable Engine column. Engine vocabulary is the
// 2-value ContainerEngine ("podman" | "docker").

import "./EngineCell.css";

export interface EngineCellProps {
  engine: string;
  connectionName?: string;
}

const ENGINE_LABELS: Record<string, string> = {
  podman: "Podman",
  docker: "Docker",
};

export function engineLabel(engine: string): string {
  return ENGINE_LABELS[engine] ?? (engine || "—");
}

export function EngineCell({ engine, connectionName }: EngineCellProps) {
  const label = engineLabel(engine);
  // Icon-only marker; the engine name (and connection, to disambiguate same-engine connections) is the tooltip.
  const title = connectionName && connectionName !== label ? `${label} — ${connectionName}` : label;
  return (
    <span className="EngineCell" data-engine-marker={engine || "unknown"} role="img" title={title} aria-label={title}>
      <span className="EngineCellIcon" aria-hidden="true" />
    </span>
  );
}

// Trailing Engine column for the merged resource tables. Centralized so its placement/appearance is changed
// once, not per screen: render <EngineColumnHeader unified={unified}/> as the LAST <th> and
// <EngineColumnCell unified={unified} engine connectionName/> as the LAST <td> of each row. Both collapse to
// nothing outside unified mode (single connection), and the header is intentionally unlabeled — the marker
// speaks for itself. Width is pinned to the minimum via [data-column="engine"] in EngineCell.css.
export function EngineColumnHeader({ unified }: { unified: boolean }) {
  if (!unified) {
    return null;
  }
  return <th data-column="engine">&nbsp;</th>;
}

export function EngineColumnCell({
  unified,
  engine,
  connectionName,
}: {
  unified: boolean;
  engine: string;
  connectionName?: string;
}) {
  if (!unified) {
    return null;
  }
  return (
    <td data-column="engine">
      <EngineCell engine={engine} connectionName={connectionName} />
    </td>
  );
}
