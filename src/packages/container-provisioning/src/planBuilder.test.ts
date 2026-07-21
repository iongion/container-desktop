import { describe, expect, it } from "vitest";

import { ContainerEngine, ContainerEngineHost, Presence } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

import { buildPlan, chooseLadderStrategy, estimateMinutes } from "./planBuilder";
import type { DetectedScope, DetectionReport, ProvisionPlan, ProvisionStrategy, ProvisionTarget } from "./types";

function det(osType: OperatingSystem, programs: string[], scopes: DetectedScope[] = []): DetectionReport {
  return { osType, programs: programs.map((name) => ({ name, present: Presence.AVAILABLE })), scopes };
}
function target(strategy: ProvisionStrategy): ProvisionTarget {
  return { engine: ContainerEngine.PODMAN, host: ContainerEngineHost.PODMAN_NATIVE, strategy };
}
const kinds = (p: ProvisionPlan) => p.steps.map((s) => s.kind);

describe("chooseLadderStrategy", () => {
  it("Linux with nothing installed → native install", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.Linux, []))).toBe("native.install");
  });
  it("Linux with podman already installed → reuse installed", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.Linux, ["podman"]))).toBe("reuse.installed");
  });
  it("macOS with Apple container available → apple.container (favored)", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.MacOS, ["container"]))).toBe("apple.container");
  });
  it("macOS with docker installed but no Apple container → reuse installed", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.MacOS, ["docker"]))).toBe("reuse.installed");
  });
  it("macOS with nothing → colima last resort", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.MacOS, []))).toBe("colima.lima");
  });
  it("Windows with nothing → wsl import last resort", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.Windows, []))).toBe("wsl.import");
  });
  it("Windows with podman installed → reuse installed", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.Windows, ["podman"]))).toBe("reuse.installed");
  });
  it("Apple Container is only favored on macOS — a 'container' program on Linux is ignored", () => {
    expect(chooseLadderStrategy(det(OperatingSystem.Linux, ["container"]))).toBe("native.install");
  });
});

describe("buildPlan", () => {
  it("Linux native install omits any VM/resource step", () => {
    const p = buildPlan(det(OperatingSystem.Linux, []), target("native.install"));
    expect(kinds(p)).toEqual(["install-engine", "configure-volumes", "verify", "connect"]);
    expect(kinds(p)).not.toContain("create-vm");
    expect(p.reusesExisting).toBe(false);
  });
  it("reuse.installed just configures + verifies + connects", () => {
    const p = buildPlan(det(OperatingSystem.Linux, ["podman"]), target("reuse.installed"));
    expect(kinds(p)).toEqual(["configure-volumes", "verify", "connect"]);
  });
  it("colima.lima with no usable scope creates a VM", () => {
    const p = buildPlan(det(OperatingSystem.MacOS, []), target("colima.lima"));
    expect(kinds(p)).toEqual(["create-vm", "install-engine", "configure-volumes", "verify", "connect"]);
    expect(p.reusesExisting).toBe(false);
  });
  it("colima.lima reuses an existing usable VM instead of creating one", () => {
    const scopes: DetectedScope[] = [{ kind: "lima.instance", name: "default", usable: true }];
    const p = buildPlan(det(OperatingSystem.MacOS, ["lima"], scopes), target("colima.lima"));
    expect(kinds(p)).toContain("reuse-scope");
    expect(kinds(p)).not.toContain("create-vm");
    expect(p.reusesExisting).toBe(true);
  });
  it("wsl.import imports a distro when none is reusable", () => {
    const p = buildPlan(det(OperatingSystem.Windows, []), target("wsl.import"));
    expect(kinds(p)).toContain("import-distro");
    expect(p.reusesExisting).toBe(false);
  });
  it("every plan ends by verifying then connecting", () => {
    const p = buildPlan(det(OperatingSystem.Linux, []), target("native.install"));
    expect(kinds(p).slice(-2)).toEqual(["verify", "connect"]);
  });

  it("attaches a whole-number minute estimate dominated by the long-running steps", () => {
    const p = buildPlan(det(OperatingSystem.Linux, []), target("native.install"));
    expect(p.estimatedMinutes).toBeGreaterThanOrEqual(3);
    expect(Number.isInteger(p.estimatedMinutes)).toBe(true);
  });

  it("estimateMinutes never returns 0 (floored at 1)", () => {
    expect(estimateMinutes([{ id: "connect", kind: "connect", title: "Connect", longRunning: false }])).toBe(1);
  });
});
