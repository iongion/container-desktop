import { describe, expect, it } from "vitest";
import { ContainerEngineHost } from "@/env/Types";
import { Screen } from "./ManageScreen";
import { BUILD_ROUTE, getBuildCrumbs, isBuildSupported } from "./Navigation";

describe("isBuildSupported", () => {
  it("is true for native hosts and false for scoped/remote", () => {
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.DOCKER_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.APPLE_NATIVE })).toBe(true);
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL })).toBe(false);
    expect(isBuildSupported({ host: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA })).toBe(false);
    expect(isBuildSupported({ host: ContainerEngineHost.PODMAN_REMOTE })).toBe(false);
    expect(isBuildSupported({ host: ContainerEngineHost.APPLE_REMOTE })).toBe(false);
  });
});

describe("build trail", () => {
  it("hangs Build off the Images root", () => {
    const trail = getBuildCrumbs("conn-1");
    expect(trail[0].textKey).toBe("Images");
    expect(trail[trail.length - 1]).toMatchObject({ textKey: "Build", current: true });
  });
});

describe("Build Screen registration", () => {
  it("is a route that is excluded from the sidebar", () => {
    expect(Screen.Route.Path).toBe(BUILD_ROUTE);
    expect(Screen.Route.Path).toBe("/screens/build");
    expect(Screen.Metadata?.ExcludeFromSidebar).toBe(true);
  });
});
