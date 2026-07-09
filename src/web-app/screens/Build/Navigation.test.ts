import { describe, expect, it } from "vitest";
import { ContainerEngineHost } from "@/env/Types";
import { getBuildCrumbs, isBuildSupported, isRemoteBuildHost } from "./Navigation";

describe("isBuildSupported", () => {
  it("is true across native, scoped, and remote transports", () => {
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.DOCKER_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.APPLE_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_REMOTE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.APPLE_REMOTE })).toBe(true);
  });
});

describe("isRemoteBuildHost", () => {
  it("is true only for SSH remotes (no shared filesystem)", () => {
    expect(isRemoteBuildHost(ContainerEngineHost.PODMAN_REMOTE)).toBe(true);
    expect(isRemoteBuildHost(ContainerEngineHost.DOCKER_REMOTE)).toBe(true);
    expect(isRemoteBuildHost(ContainerEngineHost.APPLE_REMOTE)).toBe(true);
    expect(isRemoteBuildHost(ContainerEngineHost.PODMAN_VIRTUALIZED_WSL)).toBe(false);
    expect(isRemoteBuildHost(ContainerEngineHost.DOCKER_NATIVE)).toBe(false);
  });
});

describe("build trail", () => {
  it("leads with the owning connection, then hangs Build off the Images root", () => {
    const trail = getBuildCrumbs("conn-1");
    expect(trail[0].connectionId).toBe("conn-1");
    expect(trail[1].textKey).toBe("Images");
    expect(trail[trail.length - 1]).toMatchObject({ textKey: "Build", current: true });
  });
});
