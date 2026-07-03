import { Callout } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { engineLabel } from "@/web-app/components/EngineCell";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

// Step 5 — build + render the deterministic plan for the settled target. Purely a preview; nothing runs
// until the next step. Re-preparing on entry keeps the plan in sync if the user went back and changed a choice.
export function ReviewStep() {
  const { t } = useTranslation();
  const target = useProvisioningStore((s) => s.target);
  const plan = useProvisioningStore((s) => s.plan);
  const preparePlan = useProvisioningStore((s) => s.preparePlan);

  useEffect(() => {
    preparePlan();
  }, [preparePlan]);

  if (!target || !plan) {
    return null;
  }

  return (
    <div className="PWizReview">
      <div className="PWizReviewSummary">
        <span className="PWizEngineIcon is-small" data-engine-marker={target.engine} aria-hidden="true" />
        <div className="PWizReviewSummaryText">
          <strong>{engineLabel(target.engine)}</strong>
          <small>{target.host}</small>
        </div>
      </div>

      {plan.reusesExisting ? (
        <Callout intent="success" icon={IconNames.TICK} title={t("Reusing an existing runtime")}>
          {t("A usable machine was found — the wizard will reuse it instead of creating a new one.")}
        </Callout>
      ) : null}

      <ol className="PWizPlanSteps">
        {plan.steps.map((step) => (
          <li key={step.id} className="PWizPlanStep">
            <span className="PWizPlanStepTitle">{t(step.title)}</span>
            {step.longRunning ? <span className="PWizPlanStepBadge">{t("a few minutes")}</span> : null}
          </li>
        ))}
      </ol>
      {plan.estimatedMinutes ? (
        <p className="PWizSub">{t("Estimated time: about {{n}} minutes.", { n: plan.estimatedMinutes })}</p>
      ) : null}
    </div>
  );
}
