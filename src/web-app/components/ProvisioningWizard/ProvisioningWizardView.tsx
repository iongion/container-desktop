import { Button, ButtonGroup, Icon, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

import { useProvisioningStore, WIZARD_STEPS } from "@/web-app/stores/provisioningStore";

import { EngineStep } from "./steps/EngineStep";
import { ExecuteStep } from "./steps/ExecuteStep";
import { ReadyStep } from "./steps/ReadyStep";
import { ResourcesStep } from "./steps/ResourcesStep";
import { ReviewStep } from "./steps/ReviewStep";
import { SystemCheckStep } from "./steps/SystemCheckStep";
import { VolumesStep } from "./steps/VolumesStep";

import "./ProvisioningWizard.css";

const STEP_LABELS: Record<(typeof WIZARD_STEPS)[number], string> = {
  "system-check": "System check",
  engine: "Choose engine",
  resources: "Resources",
  volumes: "Folders & permissions",
  review: "Review",
  execute: "Provision",
  ready: "Ready",
};

const STEP_COMPONENTS: Record<(typeof WIZARD_STEPS)[number], React.FC> = {
  "system-check": SystemCheckStep,
  engine: EngineStep,
  resources: ResourcesStep,
  volumes: VolumesStep,
  review: ReviewStep,
  execute: ExecuteStep,
  ready: ReadyStep,
};

const STEP_SUBTITLES: Record<(typeof WIZARD_STEPS)[number], string> = {
  "system-check": "We'll look at what's already installed.",
  engine: "Pick the container engine to set up.",
  resources: "Size the virtual machine.",
  volumes: "Share host folders with correct permissions — automatically.",
  review: "Here's exactly what will happen.",
  execute: "Setting things up.",
  ready: "You're ready to run containers.",
};

// Full-screen wizard body: themed step rail + content stage + footer (Skip in the rail, equal-width
// Back/Continue group). The wizard auto-opens only once, on first run (ProvisioningWizardHost owns that gate +
// marker); closing here just dismisses the non-blocking takeover — it's reopened from the header Provision button.
export function ProvisioningWizardView() {
  const { t } = useTranslation();
  const stepIndex = useProvisioningStore((s) => s.stepIndex);
  const goToStep = useProvisioningStore((s) => s.goToStep);
  const next = useProvisioningStore((s) => s.next);
  const back = useProvisioningStore((s) => s.back);
  const closeWizard = useProvisioningStore((s) => s.closeWizard);

  const isLast = stepIndex === WIZARD_STEPS.length - 1;
  const currentStep = WIZARD_STEPS[stepIndex];
  const StepBody = STEP_COMPONENTS[currentStep];

  return (
    <div className="PWizOverlay" data-testid="provisioning-wizard">
      <nav className="PWizRail">
        <div className="PWizBrand">
          <div className="PWizBrandMark">◧</div>
          <div className="PWizBrandText">
            {t("Get ready for containers")}
            <small>{t("Container Desktop setup")}</small>
          </div>
        </div>
        {WIZARD_STEPS.map((step, i) => {
          const classes = ["PWizStep", i < stepIndex ? "is-done" : "", i === stepIndex ? "is-active" : ""];
          return (
            <button type="button" key={step} className={classes.join(" ")} onClick={() => goToStep(i)}>
              <span className="PWizStepNum">{i < stepIndex ? <Icon icon={IconNames.TICK} size={11} /> : i + 1}</span>
              <span>{t(STEP_LABELS[step])}</span>
            </button>
          );
        })}
        <div className="PWizRailGrow" />
      </nav>

      <div className="PWizStage">
        <h1>{t(STEP_LABELS[currentStep])}</h1>
        <p className="PWizSub">{t(STEP_SUBTITLES[currentStep])}</p>
        <StepBody />
      </div>

      <div className="PWizFoot">
        <Button variant="minimal" text={t("Skip — I'll set this up myself")} onClick={closeWizard} />
        <span className="PWizFootSpacer" />
        <ButtonGroup>
          <Button text={t("Back")} disabled={stepIndex === 0} onClick={back} />
          <Button
            intent={Intent.PRIMARY}
            text={isLast ? t("Finish") : t("Continue")}
            onClick={isLast ? closeWizard : next}
          />
        </ButtonGroup>
      </div>
    </div>
  );
}
