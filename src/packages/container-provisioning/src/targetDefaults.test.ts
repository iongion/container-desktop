import { describe, expect, it } from "vitest";

import { ContainerEngine, ContainerEngineHost, Presence } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";

import { defaultResources, needsResources, preferredEngine, targetFor } from "./targetDefaults";
import type { DetectionReport } from "./types";

const detection = (osType: OperatingSystem, present: string[] = []): DetectionReport => ({
  osType,
  programs: present.map((name) => ({ name, present: Presence.AVAILABLE })),
  scopes: [],
});

describe("preferredEngine", () => {
  it("prefers Apple Container on macOS when its CLI is present", () => {
    expect(preferredEngine(detection(OperatingSystem.MacOS, ["container", "docker"]))).toBe(ContainerEngine.APPLE);
  });

  it("prefers an installed Podman over Docker", () => {
    expect(preferredEngine(detection(OperatingSystem.Linux, ["podman", "docker"]))).toBe(ContainerEngine.PODMAN);
  });

  it("falls back to Docker when only Docker is present", () => {
    expect(preferredEngine(detection(OperatingSystem.Linux, ["docker"]))).toBe(ContainerEngine.DOCKER);
  });

  it("defaults to Podman on a bare machine", () => {
    expect(preferredEngine(detection(OperatingSystem.Linux))).toBe(ContainerEngine.PODMAN);
  });
});

describe("targetFor", () => {
  it("reuses an installed Linux Podman as a native host", () => {
    const t = targetFor(ContainerEngine.PODMAN, detection(OperatingSystem.Linux, ["podman"]));
    expect(t.strategy).toBe("reuse.installed");
    expect(t.host).toBe(ContainerEngineHost.PODMAN_NATIVE);
  });

  it("installs Podman natively on a bare Linux machine", () => {
    const t = targetFor(ContainerEngine.PODMAN, detection(OperatingSystem.Linux));
    expect(t.strategy).toBe("native.install");
    expect(t.host).toBe(ContainerEngineHost.PODMAN_NATIVE);
  });

  it("uses Apple Container's native host on macOS", () => {
    const t = targetFor(ContainerEngine.APPLE, detection(OperatingSystem.MacOS, ["container"]));
    expect(t.strategy).toBe("apple.container");
    expect(t.host).toBe(ContainerEngineHost.APPLE_NATIVE);
  });

  it("creates a Lima VM for Podman on a bare macOS machine", () => {
    const t = targetFor(ContainerEngine.PODMAN, detection(OperatingSystem.MacOS));
    expect(t.strategy).toBe("colima.lima");
    expect(t.host).toBe(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA);
  });

  it("imports a WSL distro for Docker on a bare Windows machine", () => {
    const t = targetFor(ContainerEngine.DOCKER, detection(OperatingSystem.Windows));
    expect(t.strategy).toBe("wsl.import");
    expect(t.host).toBe(ContainerEngineHost.DOCKER_VIRTUALIZED_WSL);
  });
});

describe("needsResources", () => {
  it("is true for the VM-creating strategies", () => {
    expect(needsResources("colima.lima")).toBe(true);
    expect(needsResources("wsl.import")).toBe(true);
  });

  it("is false when there is no VM to size", () => {
    expect(needsResources("native.install")).toBe(false);
    expect(needsResources("reuse.installed")).toBe(false);
    expect(needsResources("apple.container")).toBe(false);
  });
});

describe("defaultResources", () => {
  it("returns sane machine defaults", () => {
    const r = defaultResources();
    expect(r.cpus).toBeGreaterThanOrEqual(1);
    expect(r.ramSize).toBeGreaterThan(0);
    expect(r.diskSize).toBeGreaterThan(0);
    expect(r.name).toBeTruthy();
  });
});
