// web-app/stores/provisioningStore.ts — client-only state for the full-screen provisioning wizard.
// Independent of appStore so it never touches the bootstrap critical path. Pure logic is delegated to
// the container-provisioning package (step reducer, first-run gate); this store is just the UI brain.

import { create } from "zustand";

import { buildPlan } from "@/container-provisioning/planBuilder";
import { initRunState, reduce } from "@/container-provisioning/stepReducer";
import type {
  DetectionReport,
  ProvisionPlan,
  ProvisionRunState,
  ProvisionTarget,
  StepEvent,
  WizardSettings,
} from "@/container-provisioning/types";
import { shouldShowAtStartup } from "@/container-provisioning/wizardSettings";

// The full-screen wizard's UI steps (distinct from a plan's execution steps).
export const WIZARD_STEPS = ["system-check", "engine", "resources", "volumes", "review", "execute", "ready"] as const;

type WizardSource = "first-run" | "manual";

interface ProvisioningState {
  isOpen: boolean;
  source: WizardSource | null;
  stepIndex: number;
  shownThisSession: boolean;
  detection?: DetectionReport;
  target?: ProvisionTarget;
  plan?: ProvisionPlan;
  run?: ProvisionRunState;
  canceled: boolean;
  openWizard: (source: WizardSource) => void;
  closeWizard: () => void;
  next: () => void;
  back: () => void;
  goToStep: (index: number) => void;
  setDetection: (detection: DetectionReport) => void;
  setTarget: (target: ProvisionTarget) => void;
  patchTarget: (partial: Partial<ProvisionTarget>) => void;
  preparePlan: () => void;
  setPlan: (plan: ProvisionPlan) => void;
  applyEvent: (event: StepEvent) => void;
  markCanceled: () => void;
  maybeShowAtStartup: (wizard: WizardSettings | undefined, isReady: boolean) => boolean;
  reset: () => void;
}

const clampStep = (index: number) => Math.max(0, Math.min(WIZARD_STEPS.length - 1, index));

const INITIAL = {
  isOpen: false,
  source: null as WizardSource | null,
  stepIndex: 0,
  shownThisSession: false,
  detection: undefined as DetectionReport | undefined,
  target: undefined as ProvisionTarget | undefined,
  plan: undefined as ProvisionPlan | undefined,
  run: undefined as ProvisionRunState | undefined,
  canceled: false,
};

export const useProvisioningStore = create<ProvisioningState>((set, get) => ({
  ...INITIAL,
  openWizard: (source) => set({ isOpen: true, source, stepIndex: 0, shownThisSession: true }),
  closeWizard: () => set({ isOpen: false, source: null }),
  next: () => set((s) => ({ stepIndex: clampStep(s.stepIndex + 1) })),
  back: () => set((s) => ({ stepIndex: clampStep(s.stepIndex - 1) })),
  goToStep: (index) => set({ stepIndex: clampStep(index) }),
  setDetection: (detection) => set({ detection }),
  setTarget: (target) => set({ target }),
  patchTarget: (partial) => set((s) => (s.target ? { target: { ...s.target, ...partial } } : {})),
  // Build the deterministic plan from the detected environment + chosen target (both required). The
  // review step calls this once the engine/resources/volumes choices are settled; execute runs it.
  preparePlan: () =>
    set((s) => {
      if (!s.detection || !s.target) {
        return {};
      }
      const plan = buildPlan(s.detection, s.target);
      return { plan, run: initRunState(plan.steps.map((step) => step.id)), canceled: false };
    }),
  setPlan: (plan) => set({ plan, run: initRunState(plan.steps.map((step) => step.id)), canceled: false }),
  applyEvent: (event) => set((s) => (s.run ? { run: reduce(s.run, event) } : {})),
  markCanceled: () => set({ canceled: true }),
  maybeShowAtStartup: (wizard, isReady) => {
    if (!shouldShowAtStartup(wizard, isReady, get().shownThisSession)) {
      return false;
    }
    get().openWizard("first-run");
    return true;
  },
  reset: () => set({ ...INITIAL }),
}));
