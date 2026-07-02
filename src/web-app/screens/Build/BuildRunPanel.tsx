import { Icon, Intent, Tag } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { BuildRun, BuildRunStatus, ContainerfileAst } from "@/container-client/builder/types";

import { BuildRawLog } from "./BuildRawLog";
import { BuildTimeline } from "./BuildTimeline";

type RunTab = "timeline" | "layers" | "log";

// Colour the run status by outcome so a failed run never reads like a successful one.
const STATUS_INTENT: Record<BuildRunStatus, Intent> = {
  idle: Intent.NONE,
  running: Intent.PRIMARY,
  succeeded: Intent.SUCCESS,
  failed: Intent.DANGER,
  canceled: Intent.WARNING,
};

export interface BuildRunPanelProps {
  run?: BuildRun;
  ast?: ContainerfileAst;
  layers?: React.ReactNode;
}

export const BuildRunPanel: React.FC<BuildRunPanelProps> = ({ run, ast, layers }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<RunTab>("timeline");

  const statusLabel = run ? (run.status === "running" ? t("running…") : t(run.status)) : t("idle");

  return (
    <section className="panel run-panel" data-region="run">
      <header>
        <Icon icon={IconNames.BUILD} />
        {t("Build run")}
        {run ? (
          <Tag minimal round intent={STATUS_INTENT[run.status]}>
            {statusLabel}
          </Tag>
        ) : (
          <span className="sub">· {statusLabel}</span>
        )}
        <div className="tabs">
          <button type="button" className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>
            {t("Timeline")}
          </button>
          <button type="button" className={tab === "layers" ? "active" : ""} onClick={() => setTab("layers")}>
            {t("Layers")}
          </button>
          <button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
            {t("Log")}
          </button>
        </div>
      </header>
      <div className="body">
        {tab === "timeline" ? <BuildTimeline run={run} ast={ast} /> : null}
        {tab === "layers" ? (
          <>
            <div className={`run-scroll${layers ? "" : " centered"}`}>
              {layers ?? <span className="muted">{t("Layers appear after a successful build.")}</span>}
            </div>
            <div className="panel-footer">{t("Per-layer size + waterfall from the built image's history.")}</div>
          </>
        ) : null}
        {tab === "log" ? <BuildRawLog run={run} /> : null}
      </div>
    </section>
  );
};
