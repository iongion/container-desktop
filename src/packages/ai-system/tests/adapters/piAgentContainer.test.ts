import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import {
  agentRunArgv,
  egressNetworkName,
  gatewayRunArgv,
  gatewayUpstreamUrl,
  hostAliasArgv,
  networkCreateArgv,
  pluginVolumeMount,
  reapOrphanPiAgentSessions,
  startPiAgentSession,
  stopPiAgentSession,
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
  providerKind: "openai-compatible",
  upstreamAuth: { scheme: "bearer" },
  modelId: "some/model",
  egress: true,
  hostAlias: "host.containers.internal",
  userMapping: { kind: "keep-id" },
};

const localSpec: PiAgentSessionSpec = { ...spec, upstreamBaseUrl: "http://127.0.0.1:1234/v1" };

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

function commandsOf(host: unknown): unknown[][] {
  return (host as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock.calls;
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

  // `--internal` restricts a NETWORK. Passing it to `run` is rejected outright ("unknown flag: --internal", on
  // podman and docker alike), so every no-egress session start failed until it moved to `network create`.
  it("never hands the agent's run a network-create flag", () => {
    expect(agentRunArgv({ ...spec, egress: false }, "/w", "/tmp/env")).not.toContain("--internal");
  });
});

describe("networkCreateArgv", () => {
  it("creates a plain network when egress is allowed", () => {
    expect(networkCreateArgv(spec)).toEqual(["network", "create", "cd-agent-net-1"]);
  });

  // An internal bridge is built with no gateway address, so a container on it resolves and reaches its siblings
  // by name and has no route anywhere else — which is what "only the gateway is reachable" means.
  it("makes the agent's own network internal when egress is off", () => {
    expect(networkCreateArgv({ ...spec, egress: false })).toEqual([
      "network",
      "create",
      "--internal",
      "cd-agent-net-1",
    ]);
  });
});

describe("egressNetworkName", () => {
  it("derives the gateway's second network from the session's own", () => {
    expect(egressNetworkName(spec)).toBe("cd-agent-net-1-egress");
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

  // Without the mapping the alias does not resolve inside the container, so a local model server is
  // unreachable and every turn fails on connect.
  it("maps the host alias when the provider runs on this machine", () => {
    expect(gatewayRunArgv(localSpec, "/tmp/env").join(" ")).toContain(
      "--add-host host.containers.internal:host-gateway",
    );
  });

  it("maps nothing for a provider that is already routable", () => {
    expect(gatewayRunArgv(spec, "/tmp/env")).not.toContain("--add-host");
  });
});

// The gateway dials the provider from INSIDE a container, where 127.0.0.1 is the container itself.
describe("gatewayUpstreamUrl", () => {
  it("rewrites a loopback provider to the engine's host alias", () => {
    expect(gatewayUpstreamUrl(localSpec)).toBe("http://host.containers.internal:1234/v1");
  });

  it("rewrites localhost and IPv6 loopback too", () => {
    expect(gatewayUpstreamUrl({ ...spec, upstreamBaseUrl: "http://localhost:8080/v1" })).toBe(
      "http://host.containers.internal:8080/v1",
    );
    expect(gatewayUpstreamUrl({ ...spec, upstreamBaseUrl: "http://[::1]:8080/v1" })).toBe(
      "http://host.containers.internal:8080/v1",
    );
  });

  it("leaves a routable provider alone", () => {
    expect(gatewayUpstreamUrl(spec)).toBe("https://openrouter.ai/api/v1");
    expect(hostAliasArgv(spec)).toEqual([]);
  });

  it("leaves an unparseable URL alone rather than inventing one", () => {
    expect(gatewayUpstreamUrl({ ...spec, upstreamBaseUrl: "not a url" })).toBe("not a url");
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

  // The session spec carries NO credential at all, so this path cannot compose one even by mistake. A gateway that
  // needs a key is given a file the HOST wrote (see below); this fallback exists for a keyless local server, where an
  // empty value is the correct one.
  it("composes a keyless gateway env when the host wrote none, and never a key in the agent's", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), spec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).toContain("CD_UPSTREAM_API_KEY=\n");
    expect(written[1]).not.toContain("CD_UPSTREAM_API_KEY");
    expect(written[1]).toContain("CD_BRIDGE_TOKEN=tok");
  });

  // The only route a real credential takes: the host reads it from the OS keychain and writes the file itself, so the
  // renderer never holds one and this adapter never composes one.
  it("uses the file the host wrote instead of composing its own", async () => {
    const written: string[] = [];
    await startPiAgentSession(
      fakeHost(),
      spec,
      async (contents) => {
        written.push(contents);
        return "/tmp/env";
      },
      { gatewayEnvFile: async () => "/run/secrets/gateway.env" },
    );
    // Only the AGENT's env file was composed here; the gateway's came from the host.
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("CD_BRIDGE_TOKEN=tok");
    expect(written[0]).not.toContain("CD_UPSTREAM_API_KEY");
  });

  // pi speaks whatever shape the UPSTREAM speaks: the gateway proxies bytes, so an OpenAI-completions request
  // can never reach Anthropic's /v1/messages. The Anthropic SDK also builds its own /v1, so its gateway base
  // must be the origin — otherwise the path arrives doubled and the rewrite lands on /v1/v1/messages.
  it("tells the agent the upstream's wire shape and the base that shape expects", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), { ...spec, providerKind: "anthropic" }, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[1]).toContain("CD_MODEL_API=anthropic-messages");
    expect(written[1]).toContain("CD_GATEWAY_URL=http://cd-gateway-1:8788\n");
  });

  it("keeps the version segment on the gateway base for an OpenAI-shaped upstream", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), spec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[1]).toContain("CD_MODEL_API=openai-completions");
    expect(written[1]).toContain("CD_GATEWAY_URL=http://cd-gateway-1:8788/v1");
  });

  // pi's compat detection reads the model's base URL, which is our gateway — so every upstream looks like plain
  // OpenAI to it. The agent is told where the bytes really go, and it is NOT told the key that opens it.
  it("tells the agent which upstream is behind the gateway, and still no credential", async () => {
    const written: string[] = [];
    await startPiAgentSession(
      fakeHost(),
      { ...spec, upstreamBaseUrl: "https://api.deepseek.com/v1" },
      async (contents) => {
        written.push(contents);
        return "/tmp/env";
      },
    );
    expect(written[1]).toContain("CD_UPSTREAM_BASE_URL=https://api.deepseek.com/v1");
    expect(written[1]).not.toContain("CD_UPSTREAM_API_KEY");
  });

  // Only the app can ask a provider whether a model reasons, and the container is born on its model before anything
  // has dialled the bridge — so the answer travels in the agent's env file or not at all.
  it("tells the agent what the provider published about the model's reasoning", async () => {
    const written: string[] = [];
    await startPiAgentSession(
      fakeHost(),
      { ...spec, reasoning: { levels: ["low", "high", "xhigh"], mandatory: true } },
      async (contents) => {
        written.push(contents);
        return "/tmp/env";
      },
    );
    expect(written[1]).toContain("CD_MODEL_REASONING=1");
    expect(written[1]).toContain("CD_MODEL_REASONING_LEVELS=low,high,xhigh");
    expect(written[1]).toContain("CD_MODEL_REASONING_MANDATORY=1");
  });

  // Silence is the honest answer for a model nobody published a capability for: pi then registers it with its own
  // `reasoning: false` and the session offers no thinking level at all.
  it("says nothing about reasoning when no provider published any", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), spec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[1]).not.toContain("CD_MODEL_REASONING");
  });

  it("tells the gateway how the upstream authenticates, not just its key", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), { ...spec, providerKind: "anthropic" }, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).toContain("CD_UPSTREAM_KIND=anthropic");
    expect(written[0]).toContain("CD_UPSTREAM_AUTH_SCHEME=bearer");
  });

  it("writes the container-reachable upstream URL, not the loopback one the app sees", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), localSpec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).toContain("CD_UPSTREAM_BASE_URL=http://host.containers.internal:1234/v1");
    expect(written[0]).not.toContain("127.0.0.1:1234");
  });

  // The provider key lives in the OS keychain, so the host writes the gateway's env file. When it has, the
  // renderer must not compose a second one — that copy would carry an empty key.
  it("uses the gateway env file the host wrote instead of composing one", async () => {
    const written: string[] = [];
    const host = fakeHost();
    await startPiAgentSession(
      host,
      spec,
      async (contents) => {
        written.push(contents);
        return "/tmp/agent.env";
      },
      { gatewayEnvFile: async () => "/run/secrets/gateway.env" },
    );
    expect(written.length).toBe(1);
    expect(written[0]).toContain("CD_BRIDGE_TOKEN=tok");
    expect(written[0]).not.toContain("sk-real-secret");
    const commands = (host as unknown as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock
      .calls;
    expect((commands[1][1] as string[]).join(" ")).toContain("/run/secrets/gateway.env");
  });

  it("asks for no second network when egress is allowed", async () => {
    const host = fakeHost();
    await startPiAgentSession(host, spec, async () => "/tmp/env");
    const argvs = commandsOf(host).map((call) => (call[1] as string[]).join(" "));
    expect(argvs.some((argv) => argv.includes("--internal"))).toBe(false);
    expect(argvs.some((argv) => argv.includes("-egress"))).toBe(false);
    expect(argvs.some((argv) => argv.startsWith("network connect"))).toBe(false);
  });

  // The agent's network cannot be the one the gateway reaches the provider through — an internal bridge has no
  // route out at all. So the gateway gets a second, routable one, and the agent is never attached to it.
  it("gives only the gateway a routable network when egress is off", async () => {
    const host = fakeHost();
    await startPiAgentSession(host, { ...spec, egress: false }, async () => "/tmp/env");
    const argvs = commandsOf(host).map((call) => (call[1] as string[]).join(" "));
    expect(argvs).toEqual([
      "network create --internal cd-agent-net-1",
      "network create cd-agent-net-1-egress",
      expect.stringContaining("--name cd-gateway-1"),
      "network connect cd-agent-net-1-egress cd-gateway-1",
      expect.stringContaining("--name cd-agent-1"),
    ]);
    // The agent's run names only its own network, and the gateway's run starts on it so the agent can still
    // resolve the gateway by name after the second network is attached.
    expect(argvs[2]).toContain("--network cd-agent-net-1 ");
    expect(argvs[4]).toContain("--network cd-agent-net-1 ");
    expect(argvs[4]).not.toContain("-egress");
  });

  // Without egress the gateway has no other way to the provider, so a failed attach must not be swallowed the way
  // a pre-existing network is: a session that starts anyway fails later, on the first turn, with a connect error.
  it("fails the start when the gateway cannot be given its routable network", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) =>
        args[1] === "connect"
          ? { pid: 1, code: 125, success: false, stdout: "", stderr: "network not found" }
          : { pid: 1, code: 0, success: true, stdout: "id\n", stderr: "" },
      ),
    });
    await expect(startPiAgentSession(host, { ...spec, egress: false }, async () => "/tmp/env")).rejects.toThrow(
      "network not found",
    );
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

// A published port cannot be reserved: anything on the machine may take it between the pick and the run, and this
// range holds real servers (LM Studio's own listener sits inside it). The engine is the only oracle, so the run
// re-picks and tries again rather than failing the session on a lottery.
describe("startPiAgentSession port collisions", () => {
  function portRefusingHost(failures: number) {
    let seen = 0;
    return fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) => {
        if (args[0] === "run" && args.join(" ").includes("cd-agent-1") && seen++ < failures) {
          return {
            pid: 1,
            code: 126,
            success: false,
            stdout: "",
            stderr: "rootlessport listen tcp 127.0.0.1:43078: bind: address already in use",
          };
        }
        return { pid: 1, code: 0, success: true, stdout: "container-id-abc\n", stderr: "" };
      }),
    });
  }

  it("re-picks the port and reports the one it settled on", async () => {
    const host = portRefusingHost(1);
    const result = await startPiAgentSession(host, spec, async () => "/tmp/env");
    const agentRuns = commandsOf(host)
      .map((call) => (call[1] as string[]).join(" "))
      .filter((argv) => argv.startsWith("run") && argv.includes("cd-agent-1"));
    expect(agentRuns).toHaveLength(2);
    expect(agentRuns[0]).toContain(`127.0.0.1:${spec.hostPort}:8787`);
    expect(agentRuns[1]).not.toContain(`127.0.0.1:${spec.hostPort}:8787`);
    // The caller dials this port, so a retry that kept the original in the spec would connect to nothing.
    expect(result.hostPort).not.toBe(spec.hostPort);
    expect(agentRuns[1]).toContain(`127.0.0.1:${result.hostPort}:8787`);
  });

  // The engine may leave the container behind when only its port mapping failed, and the name goes with it.
  it("clears the half-created container before trying another port", async () => {
    const host = portRefusingHost(1);
    await startPiAgentSession(host, spec, async () => "/tmp/env");
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toContain("rm --force cd-agent-1");
  });

  it("gives up with the engine's own words rather than retrying forever", async () => {
    await expect(startPiAgentSession(portRefusingHost(99), spec, async () => "/tmp/env")).rejects.toThrow(
      "address already in use",
    );
  });

  // Only a port conflict is worth another port. Anything else is a real failure and must surface at once.
  it("does not retry a failure that has nothing to do with the port", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) =>
        args.join(" ").includes("cd-agent-1")
          ? { pid: 1, code: 125, success: false, stdout: "", stderr: "no such image" }
          : { pid: 1, code: 0, success: true, stdout: "id\n", stderr: "" },
      ),
    });
    await expect(startPiAgentSession(host, spec, async () => "/tmp/env")).rejects.toThrow("no such image");
    expect(
      commandsOf(host)
        .map((call) => (call[1] as string[]).join(" "))
        .filter((argv) => argv.startsWith("run") && argv.includes("cd-agent-1")),
    ).toHaveLength(1);
  });
});

// A crash or a force-quit leaves the pair and its networks behind — the app is the only thing that would have
// removed them, and enough leaked /24s make the engine refuse to create another network at all.
describe("reapOrphanPiAgentSessions", () => {
  function listingHost(containers: string[], networks: string[]) {
    return fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) => ({
        pid: 1,
        code: 0,
        success: true,
        stdout: args[0] === "ps" ? containers.join("\n") : args[1] === "ls" ? networks.join("\n") : "",
        stderr: "",
      })),
    });
  }

  it("removes both halves of a session pair and every network it held", async () => {
    const host = listingHost(
      ["cd-agent-1a2b3c4d", "cd-gateway-1a2b3c4d"],
      ["podman", "cd-agent-net-1a2b3c4d", "cd-agent-net-1a2b3c4d-egress"],
    );
    const reaped = await reapOrphanPiAgentSessions(host);
    expect(reaped).toEqual({
      containers: ["cd-agent-1a2b3c4d", "cd-gateway-1a2b3c4d"],
      networks: ["cd-agent-net-1a2b3c4d", "cd-agent-net-1a2b3c4d-egress"],
    });
    const argvs = commandsOf(host).map((call) => (call[1] as string[]).join(" "));
    expect(argvs).toContain("rm --force cd-agent-1a2b3c4d");
    expect(argvs).toContain("network rm cd-agent-net-1a2b3c4d-egress");
  });

  // The name is the only evidence available, so it has to be read strictly: the session suffix is 8 hex
  // characters, and anything else under a similar name belongs to the user.
  it("leaves the user's own containers and networks alone", async () => {
    const host = listingHost(
      ["cd-agent-mine", "my-cd-agent-1a2b3c4d", "cd-agentx-1a2b3c4d", "web", ""],
      ["podman", "bridge", "cd-agent-net", "my-cd-agent-net-1a2b3c4d"],
    );
    const reaped = await reapOrphanPiAgentSessions(host);
    expect(reaped).toEqual({ containers: [], networks: [] });
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toEqual(
      ["ps --all", "network ls"].map((argv) => expect.stringContaining(argv)),
    );
  });

  // The plugin volume is shared by every session and holds what the user installed. A reaper that took it would
  // silently uninstall their plugins.
  it("never touches the shared plugin volume", async () => {
    const host = listingHost(["cd-agent-1a2b3c4d"], ["cd-agent-net-1a2b3c4d"]);
    await reapOrphanPiAgentSessions(host);
    expect(
      commandsOf(host)
        .map((call) => (call[1] as string[]).join(" "))
        .join(" | "),
    ).not.toContain("volume");
  });

  // Reaping is housekeeping: it runs at boot, and a failure in it must never become a startup failure.
  it("reports what it managed to remove even when the engine refuses", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) =>
        args[0] === "ps"
          ? { pid: 1, code: 0, success: true, stdout: "cd-agent-1a2b3c4d\n", stderr: "" }
          : { pid: 1, code: 125, success: false, stdout: "", stderr: "permission denied" },
      ),
    });
    await expect(reapOrphanPiAgentSessions(host)).resolves.toEqual({ containers: [], networks: [] });
  });
});

describe("stopPiAgentSession", () => {
  it("removes both containers and the session's network", async () => {
    const host = fakeHost();
    await stopPiAgentSession(host, spec);
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toEqual([
      "rm --force cd-agent-1",
      "rm --force cd-gateway-1",
      "network rm cd-agent-net-1",
    ]);
  });

  // A no-egress session leaves TWO networks behind, each holding a /24 out of the engine's pool. Removing only the
  // one named in the spec is how an orderly stop still leaks.
  it("removes the gateway's second network too when egress was off", async () => {
    const host = fakeHost();
    await stopPiAgentSession(host, { ...spec, egress: false });
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toEqual([
      "rm --force cd-agent-1",
      "rm --force cd-gateway-1",
      "network rm cd-agent-net-1",
      "network rm cd-agent-net-1-egress",
    ]);
  });
});
