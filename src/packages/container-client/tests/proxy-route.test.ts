import { describe, expect, it } from "vitest";

import { engineIsRemote, getProxyRequestRoute } from "@/container-client/proxy-route";
import { ContainerEngineHost } from "@/container-client/types/engine";

// One set answers both questions, because they are the same question: an engine whose API has to be bridged over SSH
// is an engine whose filesystem, loopback and published ports are not this machine's. The assistant kept a second copy
// of that set, which is how a connection fact came to live in the AI subsystem.

describe("engineIsRemote", () => {
  it("names the engines that run on another machine", () => {
    expect(engineIsRemote(ContainerEngineHost.PODMAN_REMOTE)).toBe(true);
    expect(engineIsRemote(ContainerEngineHost.DOCKER_REMOTE)).toBe(true);
    expect(engineIsRemote(ContainerEngineHost.APPLE_REMOTE)).toBe(true);
  });

  // A machine VM on THIS host is not remote: its filesystem is reachable, its ports are relayed, and a path this app
  // makes is one that engine can mount.
  it("says nothing of the engines that run on this machine, machine VM or not", () => {
    expect(engineIsRemote(ContainerEngineHost.PODMAN_NATIVE)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.DOCKER_NATIVE)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.APPLE_NATIVE)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.PODMAN_VIRTUALIZED_WSL)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.DOCKER_VIRTUALIZED_WSL)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA)).toBe(false);
    expect(engineIsRemote(ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR)).toBe(false);
  });

  // A host nothing is known about is treated as this machine's, which is what every connection did before either
  // answer existed.
  it("treats an engine it knows nothing about as this machine's", () => {
    expect(engineIsRemote(undefined)).toBe(false);
  });

  // The same set, read the other way: whichever engine is remote is exactly the one whose API is bridged over SSH.
  it("agrees with the route the same engine's API takes", () => {
    for (const host of Object.values(ContainerEngineHost)) {
      expect(engineIsRemote(host)).toBe(getProxyRequestRoute(host) === "ssh");
    }
  });
});
