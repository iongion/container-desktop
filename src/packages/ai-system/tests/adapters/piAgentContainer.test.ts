import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import {
  agentRunArgv,
  gatewayRunArgv,
  pluginVolumeMount,
  startPiAgentSession,
  userMappingArgv,
} from "@/ai-system/adapters/piAgentContainer";

const spec: PiAgentSessionSpec = {
  imageTag: "container-desktop/pi-agent:6.1.0",
  workspacePath: "/home/me/project",
  hostPort: 43117,
  bridgeToken: "tok",
  networkName: "cd-agent-net-1",
  agentContainerName: "cd-agent-1",
  gatewayContainerName: "cd-gateway-1",
  pluginVolumeName: "cd-agent-plugins",
  upstreamBaseUrl: "https://openrouter.ai/api/v1",
  upstreamApiKey: "sk-real-secret",
  modelId: "some/model",
  egress: true,
  userMapping: { kind: "keep-id" },
};

function fakeHost(overrides: Record<string, unknown> = {}) {
  return {
    PROGRAM: "podman",
    isScoped: () => false,
    resolveGuestPath: vi.fn(async (localPath: string) => localPath),
    runHostCommand: vi.fn(async (_program: string, args: string[]) => ({
      pid: 1,
      code: 0,
      success: true,
      stdout: args[0] === "run" ? "container-id-abc\n" : "",
      stderr: "",
    })),
    runScopeCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout: "scoped-id\n", stderr: "" })),
    ...overrides,
  } as never;
}

afterEach(() => vi.restoreAllMocks());

describe("agentRunArgv", () => {
  it("publishes the bridge port on loopback only", () => {
    expect(agentRunArgv(spec, "/home/me/project", "/tmp/env")).toContain("127.0.0.1:43117:8787");
  });

  it("mounts the guest workspace path, not the host path", () => {
    const argv = agentRunArgv(spec, "/mnt/c/Users/me/project", "/tmp/env");
    expect(argv).toContain("/mnt/c/Users/me/project:/workspace");
    expect(argv.join(" ")).not.toContain("/home/me/project:/workspace");
  });

  it("mounts the plugin volume at the pi agent dir", () => {
    expect(agentRunArgv(spec, "/w", "/tmp/env")).toContain("cd-agent-plugins:/home/agent/.pi/agent:U");
  });

  it("passes secrets through an env file and never through argv", () => {
    const argv = agentRunArgv(spec, "/w", "/tmp/env");
    expect(argv).toContain("--env-file");
    expect(argv).toContain("/tmp/env");
    expect(argv.join(" ")).not.toContain("tok");
  });

  it("carries the user mapping so workspace writes reach the host", () => {
    expect(agentRunArgv(spec, "/w", "/tmp/env").join(" ")).toContain("keep-id:uid=1001,gid=1001");
  });

  it("drops networking except the gateway when egress is off", () => {
    expect(agentRunArgv({ ...spec, egress: false }, "/w", "/tmp/env")).toContain("--internal");
  });
});

describe("pluginVolumeMount", () => {
  it("chowns the volume under podman so a volume from a previous mapping still works", () => {
    expect(pluginVolumeMount(spec, "/home/agent/.pi/agent")).toBe("cd-agent-plugins:/home/agent/.pi/agent:U");
  });

  it("omits :U where the engine does not support it", () => {
    expect(pluginVolumeMount({ ...spec, userMapping: { kind: "none" } }, "/agent")).toBe("cd-agent-plugins:/agent");
  });
});

describe("userMappingArgv", () => {
  it("maps the host user onto the image's agent uid under rootless podman", () => {
    // Without this, rootless podman maps the host user to container root and the agent user (1001)
    // cannot write to the bind-mounted workspace — the mount is read-only in practice.
    expect(userMappingArgv({ kind: "keep-id" })).toEqual(["--userns", "keep-id:uid=1001,gid=1001"]);
  });

  it("passes an explicit user for engines without keep-id", () => {
    expect(userMappingArgv({ kind: "user", uid: 1000, gid: 1000 })).toEqual(["--user", "1000:1000"]);
  });

  it("adds nothing when no mapping is wanted", () => {
    expect(userMappingArgv({ kind: "none" })).toEqual([]);
  });
});

describe("gatewayRunArgv", () => {
  it("does not publish any host port", () => {
    expect(gatewayRunArgv(spec, "/tmp/env")).not.toContain("--publish");
  });

  it("never puts the provider key in argv", () => {
    expect(gatewayRunArgv(spec, "/tmp/env").join(" ")).not.toContain("sk-real-secret");
  });

  it("runs in gateway mode", () => {
    const argv = gatewayRunArgv(spec, "/tmp/env");
    expect(argv.slice(-3)).toEqual([spec.imageTag, "--mode", "gateway"]);
  });
});

describe("startPiAgentSession", () => {
  it("creates the network, starts the gateway, then the agent, and returns both ids", async () => {
    const host = fakeHost();
    const result = await startPiAgentSession(host, spec, async () => "/tmp/env");
    const commands = (host as unknown as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock
      .calls;
    expect((commands[0][1] as string[])[0]).toBe("network");
    expect((commands[1][1] as string[]).join(" ")).toContain(spec.gatewayContainerName);
    expect((commands[2][1] as string[]).join(" ")).toContain(spec.agentContainerName);
    expect(result.agentContainerId).toBe("container-id-abc");
  });

  it("writes the provider key into the gateway env file and never the agent's", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), spec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).toContain("sk-real-secret");
    expect(written[1]).not.toContain("sk-real-secret");
    expect(written[1]).toContain("CD_BRIDGE_TOKEN=tok");
  });

  it("throws with the engine's stderr when the agent fails to start", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) =>
        args.join(" ").includes("cd-agent-1")
          ? { pid: 1, code: 125, success: false, stdout: "", stderr: "port already allocated" }
          : { pid: 1, code: 0, success: true, stdout: "id\n", stderr: "" },
      ),
    });
    await expect(startPiAgentSession(host, spec, async () => "/tmp/env")).rejects.toThrow("port already allocated");
  });

  it("routes through the scope wrapper and the guest path on a scoped engine", async () => {
    const runScopeCommand = vi.fn(async (_program: string, _args: string[], _scope: string) => ({
      pid: 1,
      code: 0,
      success: true,
      stdout: "id\n",
      stderr: "",
    }));
    const host = fakeHost({
      isScoped: () => true,
      resolveGuestPath: vi.fn(async () => "/mnt/c/Users/me/project"),
      runScopeCommand,
    });
    await startPiAgentSession(host, { ...spec, scope: "podman-machine-default" }, async () => "/tmp/env");
    expect(runScopeCommand).toHaveBeenCalled();
    const lastArgs = runScopeCommand.mock.calls.at(-1)?.[1] as unknown as string[];
    expect(lastArgs.join(" ")).toContain("/mnt/c/Users/me/project:/workspace");
  });
});
