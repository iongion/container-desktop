import { describe, expect, it } from "vitest";

import { ContainerEngine, OperatingSystem } from "@/env/Types";

import { capabilitiesFor, WIZARD_ENGINES } from "./platform";

describe("WIZARD_ENGINES", () => {
  it("is the full display set (Podman, Docker, Apple Container) shown on every OS", () => {
    expect(WIZARD_ENGINES).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER, ContainerEngine.APPLE]);
  });

  it("is a superset of every OS's selectable engines (so disabled cards still render)", () => {
    for (const os of [OperatingSystem.Linux, OperatingSystem.MacOS, OperatingSystem.Windows]) {
      for (const engine of capabilitiesFor(os).engines) {
        expect(WIZARD_ENGINES).toContain(engine);
      }
    }
  });
});

describe("capabilitiesFor", () => {
  it("Linux: only Podman + Docker; no Apple Container, Lima or WSL", () => {
    const caps = capabilitiesFor(OperatingSystem.Linux);
    expect(caps.engines).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER]);
    expect(caps.engines).not.toContain(ContainerEngine.APPLE);
    expect(caps.probes).toEqual(["podman", "docker", "ssh"]);
    expect(caps.probes).not.toContain("container");
    expect(caps.probes).not.toContain("wsl");
    expect(caps.probes).not.toContain("limactl");
  });

  it("macOS: adds Apple Container as an engine and probes container + limactl; no WSL", () => {
    const caps = capabilitiesFor(OperatingSystem.MacOS);
    expect(caps.engines).toContain(ContainerEngine.APPLE);
    expect(caps.probes).toContain("container");
    expect(caps.probes).toContain("limactl");
    expect(caps.probes).not.toContain("wsl");
  });

  it("Windows: Podman + Docker with a WSL probe; no Apple Container or Lima", () => {
    const caps = capabilitiesFor(OperatingSystem.Windows);
    expect(caps.engines).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER]);
    expect(caps.probes).toContain("wsl");
    expect(caps.probes).not.toContain("container");
    expect(caps.probes).not.toContain("limactl");
  });

  it("Unknown/unsupported platform: nothing to offer", () => {
    expect(capabilitiesFor(OperatingSystem.Unknown)).toEqual({ engines: [], probes: [] });
  });

  it("returns fresh arrays so callers can't mutate the shared table", () => {
    const a = capabilitiesFor(OperatingSystem.Linux);
    a.engines.push(ContainerEngine.APPLE);
    expect(capabilitiesFor(OperatingSystem.Linux).engines).toEqual([ContainerEngine.PODMAN, ContainerEngine.DOCKER]);
  });
});
