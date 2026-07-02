import { NonIdealState } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import prettyBytes from "pretty-bytes";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { analyzeLayers } from "@/container-client/builder/analyzeLayers";
import type { ContainerImageHistory } from "@/env/Types";

import { toWaterfallRows } from "./LayerInspector.logic";

import "./LayerInspector.css";

export interface LayerInspectorProps {
  history: ContainerImageHistory[];
}

// Dive-style layer waterfall: a bar per layer (sized against the largest), a size column, and the waste
// findings from analyzeLayers. Self-contained + reusable — rendered both inside the Build run panel's Layers
// tab and as the body of the image LayersScreen. Few layers, so a plain list (no virtualization).
export const LayerInspector: React.FC<LayerInspectorProps> = ({ history }) => {
  const { t } = useTranslation();
  // `image history` (docker/podman) returns layers newest-first (the entrypoint/CMD layer first); analyzeLayers
  // wants them base-first for the natural base → final waterfall (matching the build timeline), so reverse a copy.
  const analysis = useMemo(() => analyzeLayers([...history].reverse()), [history]);
  const rows = useMemo(() => toWaterfallRows(analysis), [analysis]);

  if (rows.length === 0) {
    return <NonIdealState icon={IconNames.LAYERS} title={t("No layer history")} />;
  }

  return (
    <div className="LayerInspector">
      <div className="layer-header">
        <span className="summary">
          {t("{{count}} layers", { count: rows.length })} · {prettyBytes(analysis.totalSize)}
        </span>
        <span className="col-size">{t("Size")}</span>
      </div>
      <div className="waterfall">
        {rows.map((row) => (
          <div className="layer" key={row.index} data-layer={row.index}>
            <span className="createdBy">{row.createdBy || "—"}</span>
            <div className="bar-track">
              <div className={`bar${row.largest ? " largest" : ""}`} style={{ width: `${row.percent}%` }} />
            </div>
            <span className="size">{row.empty ? "—" : prettyBytes(row.size)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
