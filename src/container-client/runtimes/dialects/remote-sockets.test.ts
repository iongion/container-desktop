import { describe, expect, it, vi } from "vitest";
import { type CommandExecutionResult, ContainerEngineHost, type EngineConnectorSettings } from "@/env/Types";
import type { HostContext } from "../composition";
import { dockerDialect } from "./docker";
import { podmanDialect } from "./podman";
import { normalizeUnixSocketPath } from "./shared";

function settings(program = "podman"): EngineConnectorSettings {
  return {
    api: { baseURL: "http://d", connection: { uri: "/tmp/local.sock", relay: "" } },
    program: { name: program, path: program },
    controller: { name: "ssh", path: "ssh", version: "current", scope: "mac" },
    rootfull: false,
    mode: "mode.automatic",
  };
}

function commandResult(overrides: Partial<CommandExecutionResult>): CommandExecutionResult {
  return { pid: 1, code: 0, success: true, stdout: "", stderr: "", ...overrides };
}

function hostFor(
  host: ContainerEngineHost,
  runScopeCommand: HostContext["runScopeCommand"],
  extra: Partial<HostContext> = {},
): HostContext {
  return {
    HOST: host,
    PROGRAM: host === ContainerEngineHost.DOCKER_REMOTE ? "docker" : "podman",
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    isScoped: () => true,
    runScopeCommand,
    ...extra,
  } as unknown as HostContext;
}

describe("remote SSH host socket discovery", () => {
  it("Podman remote prefers the host-visible podman-machine socket over the VM socket", async () => {
    const runScopeCommand = vi.fn(async (program: string, args: string[]) => {
      if (program === "uname") {
        return commandResult({ stdout: "Darwin\n" });
      }
      if (args[0] === "machine" && args[1] === "inspect") {
        return commandResult({
          stdout: JSON.stringify([
            {
              Name: "podman-machine-default",
              State: "running",
              ConnectionInfo: {
                PodmanSocket: {
                  Path: "/var/folders/pd/T/podman/podman-machine-default-api.sock",
                },
              },
            },
          ]),
        });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.PODMAN_REMOTE, runScopeCommand, {
      getSystemInfo: vi.fn(async () => {
        throw new Error("VM socket fallback should not be used");
      }),
    });

    await expect(podmanDialect.readEngineSocket(host, settings("podman"))).resolves.toBe(
      "/var/folders/pd/T/podman/podman-machine-default-api.sock",
    );
    expect(runScopeCommand).toHaveBeenCalledWith("podman", ["machine", "inspect"], "mac", expect.anything());
  });

  it("Podman remote leaves Linux SSH on the normal remote socket path", async () => {
    const runScopeCommand = vi.fn(async (program: string) => {
      if (program === "uname") {
        return commandResult({ stdout: "Linux\n" });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.PODMAN_REMOTE, runScopeCommand, {
      getSystemInfo: vi.fn(async () => ({
        host: { remoteSocket: { exists: true, path: "/run/user/1000/podman/podman.sock" } },
        plugins: {},
        registries: {},
        store: {},
        version: {},
      })) as unknown as HostContext["getSystemInfo"],
    });

    await expect(podmanDialect.readEngineSocket(host, settings("podman"))).resolves.toBe(
      "/run/user/1000/podman/podman.sock",
    );
    expect(runScopeCommand).not.toHaveBeenCalledWith("podman", ["machine", "inspect"], "mac", expect.anything());
  });

  it("Docker remote keeps a concrete Colima context socket from docker context inspect", async () => {
    const runScopeCommand = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "context") {
        return commandResult({
          stdout: JSON.stringify([
            {
              Name: "colima",
              Endpoints: { docker: { Host: "unix:///Users/ion/.colima/default/docker.sock" } },
            },
          ]),
        });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.DOCKER_REMOTE, runScopeCommand);

    await expect(dockerDialect.readEngineSocket(host, settings("docker"))).resolves.toBe(
      "/Users/ion/.colima/default/docker.sock",
    );
    expect(runScopeCommand).not.toHaveBeenCalledWith("colima", expect.anything(), "mac", expect.anything());
  });

  it("Docker remote falls back to Colima's host socket on macOS when the context is generic", async () => {
    const runScopeCommand = vi.fn(async (program: string, args: string[]) => {
      if (program === "docker" && args[0] === "context") {
        return commandResult({
          stdout: JSON.stringify([
            {
              Name: "default",
              Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } },
            },
          ]),
        });
      }
      if (program === "uname") {
        return commandResult({ stdout: "Darwin\n" });
      }
      if (program === "colima") {
        return commandResult({ stdout: "docker socket: unix://$HOME/.colima/default/docker.sock\n" });
      }
      if (program === "printenv" && args[0] === "HOME") {
        return commandResult({ stdout: "/Users/ion\n" });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.DOCKER_REMOTE, runScopeCommand);

    await expect(dockerDialect.readEngineSocket(host, settings("docker"))).resolves.toBe(
      "/Users/ion/.colima/default/docker.sock",
    );
  });

  it("Docker remote leaves a generic Linux SSH socket alone", async () => {
    const runScopeCommand = vi.fn(async (program: string, args: string[]) => {
      if (program === "docker" && args[0] === "context") {
        return commandResult({
          stdout: JSON.stringify([
            {
              Name: "default",
              Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } },
            },
          ]),
        });
      }
      if (program === "uname") {
        return commandResult({ stdout: "Linux\n" });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.DOCKER_REMOTE, runScopeCommand);

    await expect(dockerDialect.readEngineSocket(host, settings("docker"))).resolves.toBe("/var/run/docker.sock");
    expect(runScopeCommand).not.toHaveBeenCalledWith("colima", expect.anything(), "mac", expect.anything());
  });

  it("Docker remote keeps a Windows named-pipe endpoint verbatim (for the dial-stdio data plane)", async () => {
    const runScopeCommand = vi.fn(async (_program: string, args: string[]) => {
      if (args[0] === "context") {
        return commandResult({
          stdout: JSON.stringify([
            {
              Name: "desktop-linux",
              Endpoints: { docker: { Host: "npipe:////./pipe/dockerDesktopLinuxEngine" } },
            },
          ]),
        });
      }
      return commandResult({ success: false, code: 1, stderr: "unexpected" });
    }) as HostContext["runScopeCommand"];
    const host = hostFor(ContainerEngineHost.DOCKER_REMOTE, runScopeCommand);

    // A Windows Docker Desktop remote exposes a named pipe, not a Unix socket — it must survive resolution so
    // the SSH transport can bridge it via `docker system dial-stdio` instead of dropping it to "".
    await expect(dockerDialect.readEngineSocket(host, settings("docker"))).resolves.toBe(
      "npipe:////./pipe/dockerDesktopLinuxEngine",
    );
  });
});

describe("normalizeUnixSocketPath", () => {
  it("strips the unix:// scheme", () => {
    expect(normalizeUnixSocketPath("unix:///var/run/docker.sock")).toBe("/var/run/docker.sock");
  });
  it("passes a bare path through", () => {
    expect(normalizeUnixSocketPath("/run/user/1000/podman/podman.sock")).toBe("/run/user/1000/podman/podman.sock");
  });
  it("keeps a Windows named pipe verbatim (bridged over SSH, not forwarded)", () => {
    expect(normalizeUnixSocketPath("npipe:////./pipe/dockerDesktopLinuxEngine")).toBe(
      "npipe:////./pipe/dockerDesktopLinuxEngine",
    );
  });
  it("still rejects other URI schemes", () => {
    expect(normalizeUnixSocketPath("tcp://127.0.0.1:2375")).toBe("");
    expect(normalizeUnixSocketPath("http://d")).toBe("");
  });
});
