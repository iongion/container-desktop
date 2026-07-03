import { Button, Icon, ProgressBar, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { runLog, runProgress } from "@/container-provisioning/runView";
import type { StepStatus } from "@/container-provisioning/types";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

import { cancelRun, runPlan } from "../useProvisioning";

function StepStatusIcon({ status }: { status: StepStatus }) {
  if (status === "running") {
    return <Spinner size={14} />;
  }
  if (status === "ok") {
    return <Icon icon={IconNames.TICK_CIRCLE} color="var(--app-intent-success-rest)" />;
  }
  if (status === "failed") {
    return <Icon icon={IconNames.ERROR} color="var(--app-intent-danger-rest, #db3737)" />;
  }
  if (status === "skipped") {
    return <Icon icon={IconNames.MINUS} color="var(--app-text-muted)" />;
  }
  return <Icon icon={IconNames.CIRCLE} color="var(--app-text-muted)" />;
}

// Step 6 — run the prepared plan, streaming each step's output. Auto-starts once on entry (idle run) and
// folds progress live via the store; halts + shows the failure if a step errors.
export function ExecuteStep() {
  const { t } = useTranslation();
  const plan = useProvisioningStore((s) => s.plan);
  const run = useProvisioningStore((s) => s.run);
  const canceled = useProvisioningStore((s) => s.canceled);
  const started = useRef(false);

  // Auto-start once. Ensure a plan exists (in case the user jumped straight here via the rail), then run it
  // only if the run hasn't started yet — remounting after a finished run must not re-provision.
  useEffect(() => {
    if (started.current) {
      return;
    }
    const state = useProvisioningStore.getState();
    if (!state.target) {
      return;
    }
    if (!state.plan) {
      state.preparePlan();
    }
    if (useProvisioningStore.getState().run?.overall === "idle") {
      started.current = true;
      void runPlan();
    }
  }, []);

  if (!plan || !run) {
    return <p className="PWizSub">{t("Review the plan first.")}</p>;
  }

  const { fraction } = runProgress(run);
  const log = runLog(run);
  const running = run.overall === "running";
  const intent = canceled || run.overall === "failed" ? "danger" : run.overall === "done" ? "success" : "primary";

  return (
    <div className="PWizExecute">
      <ProgressBar value={run.overall === "done" ? 1 : fraction} intent={intent} stripes={running} animate={running} />
      {running ? (
        <div className="PWizRunActions">
          <Button variant="minimal" intent="danger" icon={IconNames.CROSS} text={t("Cancel")} onClick={cancelRun} />
        </div>
      ) : null}
      {canceled ? <p className="PWizSub">{t("Provisioning was canceled — you can go back and try again.")}</p> : null}
      <ul className="PWizRunSteps">
        {run.steps.map((step, index) => (
          <li key={step.id} className={`PWizRunStep is-${step.status}`}>
            <StepStatusIcon status={step.status} />
            <span className="PWizRunStepTitle">{t(plan.steps[index]?.title ?? step.id)}</span>
            {step.status === "failed" && step.error ? <span className="PWizRunStepError">{step.error}</span> : null}
          </li>
        ))}
      </ul>
      {log.length > 0 ? <pre className="PWizLog">{log.join("\n")}</pre> : null}
    </div>
  );
}
