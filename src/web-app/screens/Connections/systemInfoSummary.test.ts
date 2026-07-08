import { describe, expect, it } from "vitest";

import { ContainerEngine } from "@/env/Types";

import { buildSystemInfoSummary } from "./systemInfoSummary";

const byKey = (rows: ReturnType<typeof buildSystemInfoSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildSystemInfoSummary", () => {
  it("reads the Podman (libpod) nested host/store/version shape", () => {
    const info = {
      host: {
        arch: "amd64",
        cpus: 32,
        kernel: "6.0.0-generic",
        memTotal: 33_554_432_000,
        os: "linux",
        distribution: { distribution: "ubuntu", version: "24.04" },
      },
      store: { graphDriverName: "overlay", containerStore: { number: 7 }, imageStore: { number: 12 } },
      version: { Version: "5.7.0", APIVersion: "5.7.0" },
    };
    const rows = byKey(buildSystemInfoSummary(info, ContainerEngine.PODMAN));
    expect(rows.engineVersion.value).toBe("5.7.0");
    expect(rows.osKernel.label).toBe("OS / Kernel");
    expect(rows.osKernel.value).toBe("ubuntu 24.04 · 6.0.0-generic");
    expect(rows.os).toBeUndefined();
    expect(rows.kernel).toBeUndefined();
    expect(rows.arch.value).toBe("amd64");
    expect(rows.cpus.value).toBe("32");
    expect(String(rows.memory.value)).toContain("GB");
    expect(rows.containers.value).toBe("7");
    expect(rows.images.value).toBe("12");
    expect(rows.storage.value).toBe("overlay");
  });

  it("reads the flat Docker/Apple /info shape", () => {
    const info = {
      ServerVersion: "29.6.1",
      OperatingSystem: "Docker Desktop",
      KernelVersion: "6.10.0-linuxkit",
      Architecture: "x86_64",
      NCPU: 8,
      MemTotal: 16_777_216_000,
      Containers: 15,
      Images: 19,
      Driver: "overlayfs",
    };
    for (const engine of [ContainerEngine.DOCKER, ContainerEngine.APPLE]) {
      const rows = byKey(buildSystemInfoSummary(info, engine));
      expect(rows.engineVersion.value).toBe("29.6.1");
      expect(rows.osKernel.label).toBe("OS / Kernel");
      expect(rows.osKernel.value).toBe("Docker Desktop · 6.10.0-linuxkit");
      expect(rows.os).toBeUndefined();
      expect(rows.kernel).toBeUndefined();
      expect(rows.arch.value).toBe("x86_64");
      expect(rows.cpus.value).toBe("8");
      expect(String(rows.memory.value)).toContain("GB");
      expect(rows.containers.value).toBe("15");
      expect(rows.images.value).toBe("19");
      expect(rows.storage.value).toBe("overlayfs");
    }
  });

  it("returns nothing for empty info", () => {
    expect(buildSystemInfoSummary(null, ContainerEngine.PODMAN)).toEqual([]);
    expect(buildSystemInfoSummary(undefined, ContainerEngine.DOCKER)).toEqual([]);
  });
});
