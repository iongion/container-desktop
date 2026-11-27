import { Button, Collapse, Icon, ProgressBar, Spinner } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { runLog, runProgress } from "@/container-provisioning/runView";
import type { StepRunState, StepStatus } from "@/container-provisioning/types";
import { CopyButton } from "@/web-app/components/CopyButton";
import { useProvisioningStore } from "@/web-app/stores/provisioningStore";

import { cancelRun, retryRun, runPlan } from "../useProvisioning";

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

// A failed step: the plain sentence and its hint, Retry, and a collapsed Details section with the command (and its
// exit code) and the step's output, each copyable. The raw command never shows by default.
function StepFailurePanel({ step }: { step: StepRunState }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const output = step.lines.join("\n");
  const commandLabel = step.exitCode == null ? t("Command") : t("Command · exit {{code}}", { code: step.exitCode });
  return (
    <div className="PWizRunStepFailure">
      <div className="PWizRunStepMessage">{t(step.error ?? "The step failed.")}</div>
      {step.hint ? <div className="PWizRunStepHint">{t(step.hint)}</div> : null}
      <div className="PWizRunStepActions">
        <Button
          size="small"
          intent="primary"
          icon={IconNames.REFRESH}
          text={t("Retry")}
          data-action="provision.retry"
          onClick={() => void retryRun()}
        />
        {step.command || output ? (
          <Button
            size="small"
            variant="minimal"
            active={open}
            icon={open ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT}
            text={t("Details")}
            data-action="provision.details"
            onClick={() => setOpen((value) => !value)}
          />
        ) : null}
      </div>
      <Collapse isOpen={open}>
        <div className="PWizRunStepDetails">
          {step.command ? (
            <>
              <div className="PWizRunStepDetailsLabel">
                <span>{commandLabel}</span>
                <CopyButton text={step.command} />
              </div>
              <pre className="PWizLog">{step.command}</pre>
            </>
          ) : null}
          {output ? (
            <>
              <div className="PWizRunStepDetailsLabel">
                <span>{t("Output")}</span>
                <CopyButton text={output} />
              </div>
              <pre className="PWizLog">{output}</pre>
            </>
          ) : null}
        </div>
      </Collapse>
    </div>
  );
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
            <div className="PWizRunStepRow">
              <StepStatusIcon status={step.status} />
              <span className="PWizRunStepTitle">{t(plan.steps[index]?.title ?? step.id)}</span>
            </div>
            {step.status === "failed" ? <StepFailurePanel step={step} /> : null}
          </li>
        ))}
      </ul>
      {log.length > 0 && run.overall !== "failed" ? <pre className="PWizLog">{log.join("\n")}</pre> : null}
    </div>
  );
}
