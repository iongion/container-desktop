import { describe, expect, it } from "vitest";

import { ContainerEngine, OperatingSystem } from "@/env/Types";

import { resolveMountDecision } from "./decisionTable";

describe("resolveMountDecision", () => {
  it("macOS + Podman → virtiofs, keep-id + :U, warns about the UID mismatch", () => {
    const d = resolveMountDecision(OperatingSystem.MacOS, ContainerEngine.PODMAN);
    expect(d).toMatchObject({ mountType: "virtiofs", idStrategy: "keep-id+U", defaultShare: "~" });
    expect(d.warn).toMatch(/keep-id/i);
  });

  it("macOS + Docker → virtiofs, ownership handled by the file-sharing layer (no id remap)", () => {
    expect(resolveMountDecision(OperatingSystem.MacOS, ContainerEngine.DOCKER)).toMatchObject({
      mountType: "virtiofs",
      idStrategy: "none",
    });
  });

  it("macOS + Apple Container → native, manages its own mounts", () => {
    expect(resolveMountDecision(OperatingSystem.MacOS, ContainerEngine.APPLE)).toMatchObject({
      mountType: "apple.native",
      idStrategy: "none",
    });
  });

  it("Windows + Podman (WSL2) → native ext4, keep-id, warns against /mnt/c", () => {
    const d = resolveMountDecision(OperatingSystem.Windows, ContainerEngine.PODMAN);
    expect(d.mountType).toBe("native.ext4");
    expect(d.idStrategy).toBe("keep-id");
    expect(d.warn).toMatch(/mnt\/c/);
  });

  it("Windows + Docker (WSL2) → native ext4, run as host user", () => {
    const d = resolveMountDecision(OperatingSystem.Windows, ContainerEngine.DOCKER);
    expect(d.mountType).toBe("native.ext4");
    expect(d.idStrategy).toBe("run-as-user");
  });

  it("Linux + rootless Podman → native bind, keep-id + :U", () => {
    expect(resolveMountDecision(OperatingSystem.Linux, ContainerEngine.PODMAN)).toMatchObject({
      mountType: "native.bind",
      idStrategy: "keep-id+U",
    });
  });

  it("Linux + Docker → native bind, run as host user", () => {
    expect(resolveMountDecision(OperatingSystem.Linux, ContainerEngine.DOCKER)).toMatchObject({
      mountType: "native.bind",
      idStrategy: "run-as-user",
    });
  });

  it("Apple Container is macOS-only — resolving it off macOS throws", () => {
    expect(() => resolveMountDecision(OperatingSystem.Linux, ContainerEngine.APPLE)).toThrow(/mac/i);
  });
});
