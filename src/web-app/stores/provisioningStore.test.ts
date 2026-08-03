import { beforeEach, describe, expect, it } from "vitest";
import { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import type { DetectionReport, ProvisionPlan, ProvisionTarget } from "@/container-provisioning/types";

import { useProvisioningStore, WIZARD_STEPS } from "./provisioningStore";

const store = () => useProvisioningStore.getState();

const samplePlan: ProvisionPlan = {
  target: { engine: ContainerEngine.PODMAN, host: ContainerEngineHost.PODMAN_NATIVE, strategy: "native.install" },
  steps: [
    { id: "install-engine", kind: "install-engine", title: "Install", longRunning: true },
    { id: "verify", kind: "verify", title: "Verify", longRunning: false },
  ],
  reusesExisting: false,
};

describe("provisioningStore", () => {
  beforeEach(() => store().reset());

  it("starts closed at step 0, not shown this session", () => {
    expect(store().isOpen).toBe(false);
    expect(store().stepIndex).toBe(0);
    expect(store().shownThisSession).toBe(false);
  });

  it("openWizard shows the wizard, records the source, marks shown-this-session", () => {
    store().openWizard("manual");
    expect(store().isOpen).toBe(true);
    expect(store().source).toBe("manual");
    expect(store().shownThisSession).toBe(true);
  });

  it("next/back clamp within the step range", () => {
    store().openWizard("manual");
    store().back();
    expect(store().stepIndex).toBe(0);
    for (let i = 0; i < WIZARD_STEPS.length + 3; i++) store().next();
    expect(store().stepIndex).toBe(WIZARD_STEPS.length - 1);
  });

  it("goToStep clamps out-of-range indices", () => {
    store().goToStep(999);
    expect(store().stepIndex).toBe(WIZARD_STEPS.length - 1);
    store().goToStep(-5);
    expect(store().stepIndex).toBe(0);
  });

  it("closeWizard hides the wizard", () => {
    store().openWizard("first-run");
    store().closeWizard();
    expect(store().isOpen).toBe(false);
    expect(store().source).toBeNull();
  });

  it("maybeShowAtStartup opens once on a fresh loaded config, then never again this session", () => {
    expect(store().maybeShowAtStartup({ skipAtStartup: false }, true)).toBe(true);
    expect(store().isOpen).toBe(true);
    expect(store().source).toBe("first-run");
    store().closeWizard();
    expect(store().maybeShowAtStartup({ skipAtStartup: false }, true)).toBe(false);
    expect(store().isOpen).toBe(false);
  });

  it("maybeShowAtStartup does not open while settings are still loading (undefined wizard)", () => {
    expect(store().maybeShowAtStartup(undefined, true)).toBe(false);
    expect(store().isOpen).toBe(false);
  });

  it("maybeShowAtStartup does not re-open once the first run has been handled", () => {
    expect(store().maybeShowAtStartup({ skipAtStartup: false, firstRunHandledAt: "2026-07-03T00:00:00Z" }, true)).toBe(
      false,
    );
    expect(store().isOpen).toBe(false);
  });

  it("setPlan initializes run state (all pending); applyEvent folds progress via the reducer", () => {
    store().setPlan(samplePlan);
    expect(store().run?.steps.map((s) => s.status)).toEqual(["pending", "pending"]);
    store().applyEvent({ type: "step.start", id: "install-engine" });
    expect(store().run?.steps[0].status).toBe("running");
    expect(store().run?.overall).toBe("running");
  });

  const detection: DetectionReport = { osType: OperatingSystem.Linux, programs: [], scopes: [] };
  const target: ProvisionTarget = {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_NATIVE,
    strategy: "native.install",
  };

  it("setDetection + setTarget + preparePlan builds and stores the plan for the chosen target", () => {
    store().setDetection(detection);
    store().setTarget(target);
    store().preparePlan();
    expect(store().plan?.target).toEqual(target);
    expect(store().plan?.steps.some((s) => s.kind === "install-engine")).toBe(true);
    expect(store().run?.steps).toHaveLength(store().plan?.steps.length ?? 0);
  });

  it("preparePlan is a no-op until both detection and target are set", () => {
    store().setDetection(detection);
    store().preparePlan();
    expect(store().plan).toBeUndefined();
  });

  it("patchTarget merges resource/volume choices into the chosen target", () => {
    store().setTarget({ ...target, host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA, strategy: "colima.lima" });
    store().patchTarget({ volumes: [{ hostPath: "/home/me", guestPath: "/home/me", mode: "rw" }] });
    expect(store().target?.volumes).toHaveLength(1);
    expect(store().target?.strategy).toBe("colima.lima");
  });

  it("reset clears detection, target and plan", () => {
    store().setDetection(detection);
    store().setTarget(target);
    store().preparePlan();
    store().reset();
    expect(store().detection).toBeUndefined();
    expect(store().target).toBeUndefined();
    expect(store().plan).toBeUndefined();
  });
});
