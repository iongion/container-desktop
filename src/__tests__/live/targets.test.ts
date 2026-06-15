import { describe, expect, it } from "vitest";
import { ContainerEngineHost, OperatingSystem } from "@/env/Types";
import { isConfigured, parseTestTargets, selectTargets } from "./targets";

const ENV: Record<string, string> = {
  CDT_TARGET_LINUXVM_ENABLED: "true",
  CDT_TARGET_LINUXVM_OS: "Linux",
  CDT_TARGET_LINUXVM_HOSTS: "podman.native, docker.native, podman.remote",
  CDT_TARGET_LINUXVM_SSH_HOST: "192.168.1.20",
  CDT_TARGET_LINUXVM_SSH_PORT: "2222",
  CDT_TARGET_LINUXVM_SSH_USER: "ion",
  CDT_TARGET_LINUXVM_SSH_KEY: "~/.ssh/id_ed25519",
  CDT_TARGET_LINUXVM_PODMAN_SOCKET: "/run/user/1000/podman/podman.sock",
  CDT_TARGET_WINVM_ENABLED: "false",
  CDT_TARGET_WINVM_OS: "Windows_NT",
  CDT_TARGET_WINVM_HOSTS: "docker.virtualized.vendor,podman.virtualized.wsl",
  CDT_TARGET_WINVM_WSL_DISTRO: "Ubuntu",
  IGNORED_KEY: "x",
};

describe("parseTestTargets", () => {
  it("parses targets keyed by id, ignoring non-CDT_TARGET_ keys", () => {
    expect(parseTestTargets(ENV).map((t) => t.id)).toEqual(["linuxvm", "winvm"]);
    expect(parseTestTargets({ IGNORED_KEY: "x" })).toEqual([]);
  });

  it("maps every field including ssh, sockets, hosts and enabled", () => {
    const t = parseTestTargets(ENV).find((x) => x.id === "linuxvm")!;
    expect(t.enabled).toBe(true);
    expect(t.os).toBe(OperatingSystem.Linux);
    expect(t.hosts).toEqual([
      ContainerEngineHost.PODMAN_NATIVE,
      ContainerEngineHost.DOCKER_NATIVE,
      ContainerEngineHost.PODMAN_REMOTE,
    ]);
    expect(t.ssh).toEqual({ host: "192.168.1.20", port: 2222, user: "ion", keyPath: "~/.ssh/id_ed25519" });
    expect(t.sockets?.podman).toBe("/run/user/1000/podman/podman.sock");
  });

  it("parses the disabled windows target with its wsl distro and Windows OS value", () => {
    const t = parseTestTargets(ENV).find((x) => x.id === "winvm")!;
    expect(t.enabled).toBe(false);
    expect(t.os).toBe(OperatingSystem.Windows);
    expect(t.wslDistro).toBe("Ubuntu");
  });

  it("rejects an unknown host type", () => {
    expect(() => parseTestTargets({ CDT_TARGET_X_OS: "Linux", CDT_TARGET_X_HOSTS: "podman.bogus" })).toThrow(/host/i);
  });

  it("rejects an unknown OS", () => {
    expect(() => parseTestTargets({ CDT_TARGET_X_OS: "Solaris", CDT_TARGET_X_HOSTS: "podman.native" })).toThrow(/OS/i);
  });
});

describe("selectTargets", () => {
  it("returns only enabled targets when no selection is given", () => {
    expect(selectTargets(parseTestTargets(ENV)).map((t) => t.id)).toEqual(["linuxvm"]);
  });

  it("returns an explicitly selected target by id even if disabled (case-insensitive)", () => {
    expect(selectTargets(parseTestTargets(ENV), "WINVM").map((t) => t.id)).toEqual(["winvm"]);
  });
});

describe("isConfigured", () => {
  it("is true only for a host the enabled target declares", () => {
    const linux = parseTestTargets(ENV).find((t) => t.id === "linuxvm")!;
    expect(isConfigured(linux, ContainerEngineHost.PODMAN_NATIVE)).toBe(true);
    expect(isConfigured(linux, ContainerEngineHost.DOCKER_VIRTUALIZED_WSL)).toBe(false);
  });
});
