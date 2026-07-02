import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { analyzeCache } from "@/container-client/builder/analyzeCache";
import { orderBuildSteps } from "@/container-client/builder/orderSteps";
import type { BuildRun, ContainerfileAst } from "@/container-client/builder/types";

export interface BuildTimelineProps {
  run?: BuildRun;
  ast?: ContainerfileAst;
}

export const BuildTimeline: React.FC<BuildTimelineProps> = ({ run, ast }) => {
  const { t } = useTranslation();
  // Order by execution start — buildx emits steps in DAG order (target-first), so the raw list reads
  // [5/5]…[1/5]. Ordering here fixes both the timeline display and the order-dependent cache analysis.
  const steps = useMemo(() => orderBuildSteps(run?.steps ?? []), [run?.steps]);
  const cache = useMemo(() => analyzeCache(steps, ast), [steps, ast]);
  const cascade = new Set(cache.cascadeKeys);
  const breakerKey = cache.breaker?.stepKey;

  // Follow the stream: keep the newest step in view as rows arrive. A new row only appears when steps.length
  // grows, so that (plus the run id, to reset on a fresh build) is the right trigger — no per-keystroke churn.
  const scrollRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any step arrival (deps are the triggers)
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [steps.length, run?.id]);

  const badgeFor = (cached: boolean, key: string) => {
    if (cached) {
      return { cls: "hit", label: t("CACHED") };
    }
    if (key === breakerKey) {
      return { cls: "miss", label: t("CACHE MISS") };
    }
    return { cls: "rebuilt", label: t("rebuilt") };
  };

  return (
    <>
      {steps.length > 0 ? (
        <div className="cache-strip">
          <span className="zap">⚡ {t("Cache")}</span>
          <span>
            {cache.cachedCount} {t("hit")}
          </span>
          <span>
            · {cache.rebuiltCount} {t("rebuilt")}
          </span>
          {cache.breaker ? (
            <span>
              — {t("broke at")} <strong>{cache.breaker.name}</strong>
            </span>
          ) : null}
          {cache.breaker ? <span className="fix">{cache.breaker.fixHint}</span> : null}
        </div>
      ) : null}

      <div className={`run-scroll${steps.length === 0 ? " centered" : ""}`} ref={scrollRef}>
        {steps.length === 0 ? (
          <span className="muted">{t("No steps yet — start a build to see the timeline.")}</span>
        ) : (
          steps.map((step) => {
            const badge = badgeFor(step.cached, step.key);
            const dot = step.cached ? "hit" : step.key === breakerKey ? "miss" : "";
            return (
              <div className={`step${cascade.has(step.key) && !step.cached ? " cascade" : ""}`} key={step.key}>
                <span className={`st ${dot}`} />
                <span className="name">{step.name}</span>
                <span className={`cbadge ${badge.cls}`}>{badge.label}</span>
                {step.durationMs ? <span className="dur">{(step.durationMs / 1000).toFixed(1)}s</span> : null}
              </div>
            );
          })
        )}
      </div>

      <div className="panel-footer">
        {t(
          "Structured timeline from buildx --progress=rawjson. Podman/Apple show a step list parsed from plain output.",
        )}
      </div>
    </>
  );
};
