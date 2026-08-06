import { afterEach, describe, expect, it, vi } from "vitest";
import type { PiAgentSessionSpec } from "@/ai-system/adapters/piAgentContainer";
import {
  agentRunArgv,
  attachedPiAgentSessionFrom,
  attachPiAgentSession,
  defaultSessionFrom,
  defaultSessionNames,
  engineSharesAppFilesystem,
  envVolumeCreateArgv,
  envWriteArgv,
  findDefaultSession,
  networkCreateArgv,
  pluginVolumeMount,
  startPiAgentSession,
  stopPiAgentSession,
  userMappingArgv,
} from "@/ai-system/adapters/piAgentContainer";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { AGENT_ENV_FILE_IN_IMAGE, SESSIONS_DIR_IN_IMAGE } from "@/pi-bridge/image";

const spec: PiAgentSessionSpec = {
  imageTag: "container-desktop/pi-agent:6.1.0",
  workspacePath: "/home/me/project",
  hostPort: 43117,
  bridgeToken: "tok",
  networkName: "cd-agent-net-1",
  agentContainerName: "cd-agent-1",
  pluginVolumeName: "cd-agent-plugins",
  upstreamBaseUrl: "https://openrouter.ai/api/v1",
  providerKind: "openai-compatible",
  upstreamAuth: { scheme: "bearer" },
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

  // Conversations are the user's, not a container's: pi's default puts them under the agent dir, which IS the plugin
  // volume, so history that a stopped pair — or an unavailable engine — takes with it. Mounted like the workspace and
  // through the same translation, they live wherever the workspace comes from instead. It also completes the split the
  // owner asked for: with conversations elsewhere, the plugin volume holds only setup.
  const unmapped: PiAgentSessionSpec = { ...spec, userMapping: { kind: "none" } };

  it("mounts a sessions directory when one is given, outside the plugin volume", () => {
    const sessions = "/home/me/.local/share/container-desktop/sessions";
    expect(agentRunArgv(unmapped, "/home/me/project", "/tmp/env", sessions)).toContain(
      `${sessions}:${SESSIONS_DIR_IN_IMAGE}`,
    );
    // Nested inside the agent dir it would be back inside the volume, which is the thing being undone.
    expect(SESSIONS_DIR_IN_IMAGE.startsWith("/home/agent/.pi/agent")).toBe(false);
  });

  it("takes the translated guest path for sessions, exactly as it does for the workspace", () => {
    const argv = agentRunArgv(unmapped, "/mnt/c/Users/me/project", "/tmp/env", "/mnt/c/Users/me/sessions");
    expect(argv).toContain(`/mnt/c/Users/me/sessions:${SESSIONS_DIR_IN_IMAGE}`);
  });

  it("adds nothing when no sessions directory is given, so today's behaviour is untouched", () => {
    expect(agentRunArgv(spec, "/home/me/project", "/tmp/env").join(" ")).not.toContain(SESSIONS_DIR_IN_IMAGE);
  });

  // The OTHER way to the same directory, for an engine that cannot see this filesystem: the pair publishes a socket
  // and the app answers pi's session reads and writes over it. A second published port, never a second mount.
  it("publishes the conversation store's port on loopback when the pair is to be served", () => {
    const served: PiAgentSessionSpec = { ...spec, storageHostPort: 43900 };
    expect(agentRunArgv(served, "/home/me/project", "/tmp/env")).toContain("127.0.0.1:43900:8789");
  });

  it("publishes nothing extra for a pair that mounts its conversations", () => {
    const sessions = "/home/me/.local/share/container-desktop/sessions";
    expect(agentRunArgv(unmapped, "/home/me/project", "/tmp/env", sessions).join(" ")).not.toContain(":8789");
  });

  // An engine inside a machine publishes on the MACHINE's loopback, which is a realm of its own: measured on a real
  // WSL machine, nothing published there answers on the host running it, at either bind address. Its own address does,
  // so that is what both sockets are bound to — a NARROWER bind than the loopback one, since the machine's own
  // loopback then stops answering too (also measured).
  const inMachine: PiAgentSessionSpec = { ...spec, machineAddress: "172.24.186.248", storageHostPort: 43900 };

  it("binds both sockets to the machine's own address when the engine runs inside one", () => {
    const argv = agentRunArgv(inMachine, "C:\\Users\\me\\project", "/tmp/env");
    expect(argv).toContain("172.24.186.248:43117:8787");
    expect(argv).toContain("172.24.186.248:43900:8789");
    expect(argv.join(" ")).not.toContain("127.0.0.1:");
  });

  // `--env-file` is read by the engine's CLIENT. For an engine on another machine that path is this app's, on a
  // filesystem it has never seen: measured, a remote session died at `parsing file … The system cannot find the path
  // specified` before any container existed. The same contents are carried into a session volume instead.
  const carried: PiAgentSessionSpec = { ...spec, envVolumeName: "container-desktop-env-1a2b" };

  it("takes its environment from the session volume when the engine cannot be handed a file", () => {
    const argv = agentRunArgv(carried, "/home/me/project", "/tmp/env");
    expect(argv).toContain("container-desktop-env-1a2b:/cd-env:ro");
    expect(argv).toContain(`CD_ENV_FILE=${AGENT_ENV_FILE_IN_IMAGE}`);
    // The local file is not named at all: it does not exist over there, and naming it is what the engine refused.
    expect(argv).not.toContain("--env-file");
    expect(argv.join(" ")).not.toContain("/tmp/env");
  });

  it("keeps the env file for an engine that can be handed one", () => {
    const argv = agentRunArgv(spec, "/home/me/project", "/tmp/env");
    expect(argv).toContain("--env-file");
    expect(argv.join(" ")).not.toContain("CD_ENV_FILE");
  });

  // Every argument of a remote engine's command is re-split by ITS shell, so a space anywhere in this argv is a
  // command that means something else over there. The two values the app cannot vouch for — the workspace path and
  // the env file path — are the user's and this machine's; everything the app composes itself is checked here.
  it("composes the carried-environment arguments so a remote shell cannot re-split them", () => {
    for (const argument of agentRunArgv(carried, "/home/me/project", "/tmp/env")) {
      expect(argument).not.toMatch(/\s/u);
    }
  });
});

// Getting that environment INTO the volume, with no shell and no file on either machine: the contents travel as
// stdin, which the exec seam forwards to the remote command without them ever appearing in argv. Argv is what the
// bridge token must stay out of — it authorises the socket AND the proxy a turn's inference is signed through.
describe("the carried environment's own commands", () => {
  const carried: PiAgentSessionSpec = { ...spec, envVolumeName: "container-desktop-env-1a2b" };

  it("creates the volume it will be carried in", () => {
    expect(envVolumeCreateArgv(carried)).toEqual(["volume", "create", "container-desktop-env-1a2b"]);
  });

  it("writes it with stdin alone — no shell, no redirect, nothing with a space in it", () => {
    const argv = envWriteArgv(carried);
    expect(argv.slice(0, 2)).toEqual(["run", "--rm"]);
    // Without `--interactive` the engine gives the container no stdin at all and `tee` writes an empty file.
    expect(argv).toContain("--interactive");
    expect(argv).toContain("container-desktop-env-1a2b:/cd-env");
    // `tee` rather than `sh -c "cat > …"`: a redirect inside an argument is executed by the REMOTE shell, which would
    // write the engine's own output to a file on that machine instead.
    expect(argv).toContain("--entrypoint");
    expect(argv).toContain("tee");
    expect(argv.at(-1)).toBe(AGENT_ENV_FILE_IN_IMAGE);
    for (const argument of argv) expect(argument).not.toMatch(/\s/u);
  });

  // A fresh volume belongs to root, and the image runs as `agent`. The writer is the one container that needs to be
  // root; what it leaves behind is world-readable inside a volume only this session's own container mounts.
  it("writes as the user that owns a new volume", () => {
    expect(envWriteArgv(carried).join(" ")).toContain("--user 0");
  });

  // The plugin volume's `:U` does NOT belong here. It exists for a named volume left owned by an earlier mapping; this
  // is a directory the app creates under the user's own uid, and keep-id already maps that uid to the container's agent
  // user. Measured against the real image: with keep-id the container reads a host file as 1001 and its writes land
  // back owned by the user with or without the flag — so `:U` would only make podman chown the user's whole history on
  // every start. The workspace mount, the same kind of mount under the same mapping, has never carried it either.
  it("mounts the conversations like the workspace, with no ownership rewrite of the user's own directory", () => {
    const kept: PiAgentSessionSpec = { ...spec, userMapping: { kind: "keep-id" } };
    const argv = agentRunArgv(kept, "/home/me/project", "/tmp/env", "/home/me/sessions");
    expect(argv).toContain(`/home/me/sessions:${SESSIONS_DIR_IN_IMAGE}`);
    expect(argv.join(" ")).not.toContain(`${SESSIONS_DIR_IN_IMAGE}:U`);
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

// Whether a directory this machine made can be mounted by the engine at all. It decides whether the conversations are
// mounted from here or left where pi puts them, and getting it wrong is not harmless: an engine asked to bind-mount a
// path its own machine has never seen CREATES it, as root, and pi then fails with EACCES on the first turn.
describe("engineSharesAppFilesystem", () => {
  it("says no for a remote host, which shares no filesystem with this app", () => {
    // `resolveGuestPath` returns a local path unchanged for these, deliberately: over SSH the workspace path is one
    // the REMOTE machine already has. A path the app invented here is not.
    expect(engineSharesAppFilesystem(ContainerEngineHost.PODMAN_REMOTE)).toBe(false);
    expect(engineSharesAppFilesystem(ContainerEngineHost.DOCKER_REMOTE)).toBe(false);
    expect(engineSharesAppFilesystem(ContainerEngineHost.APPLE_REMOTE)).toBe(false);
  });

  it("says yes for this machine and for a guest that mounts it", () => {
    // A scoped guest (WSL, Lima, a machine) runs the engine inside a VM that mounts the host filesystem, and the path
    // is translated for it — which is exactly how the workspace already gets there.
    expect(engineSharesAppFilesystem(ContainerEngineHost.PODMAN_NATIVE)).toBe(true);
    expect(engineSharesAppFilesystem(ContainerEngineHost.DOCKER_NATIVE)).toBe(true);
    expect(engineSharesAppFilesystem(ContainerEngineHost.PODMAN_VIRTUALIZED_WSL)).toBe(true);
    expect(engineSharesAppFilesystem(ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA)).toBe(true);
    expect(engineSharesAppFilesystem(ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR)).toBe(true);
  });

  // A facade composed before the field existed, or a fixture that names no host, keeps the behaviour every connection
  // had: the local mount. Only a host KNOWN to be remote withholds it.
  it("says yes for a host it was told nothing about", () => {
    expect(engineSharesAppFilesystem(undefined)).toBe(true);
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

describe("startPiAgentSession", () => {
  it("creates the network, then the one container, and returns its id", async () => {
    const host = fakeHost();
    const result = await startPiAgentSession(host, spec, async () => "/tmp/env");
    const commands = (host as unknown as { runHostCommand: { mock: { calls: unknown[][] } } }).runHostCommand.mock
      .calls;
    // The name is asked about first — nothing is holding it here — and only then is anything created.
    expect((commands[0][1] as string[])[0]).toBe("inspect");
    expect((commands[1][1] as string[])[0]).toBe("network");
    expect((commands[2][1] as string[]).join(" ")).toContain(spec.agentContainerName);
    expect(result.agentContainerId).toBe("container-id-abc");
  });

  // A reusable session's name is deterministic, so a container the user stopped still holds it, and `run` answers a
  // taken name with a conflict instead of reusing it. That conflict IS what a click on Resume used to report.
  it("frees the name a stopped container still holds before rebuilding under it", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) => ({
        pid: 1,
        code: 0,
        success: true,
        stdout: args[0] === "inspect" ? "false\n" : args[0] === "run" ? "container-id-abc\n" : "",
        stderr: "",
      })),
    });
    await startPiAgentSession(host, spec, async () => "/tmp/env");
    expect(
      commandsOf(host)
        .map((call) => (call[1] as string[]).join(" "))
        .slice(0, 2),
    ).toEqual(["inspect cd-agent-1 --format {{.State.Running}}", "rm --force cd-agent-1"]);
  });

  // Rebuilding a RUNNING container would take the user's live session away to make room for a new one. Continuing it
  // is attachPiAgentSession's job, so this refuses and says so.
  it("refuses to take the name of a container that is still running", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async (_program: string, args: string[]) => ({
        pid: 1,
        code: 0,
        success: true,
        stdout: args[0] === "inspect" ? "true\n" : "",
        stderr: "",
      })),
    });
    await expect(startPiAgentSession(host, spec, async () => "/tmp/env")).rejects.toThrow(/already running/);
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).not.toContain("rm --force cd-agent-1");
  });

  it("removes nothing when the name is free", async () => {
    const host = fakeHost();
    await startPiAgentSession(host, spec, async () => "/tmp/env");
    expect(commandsOf(host).filter((call) => (call[1] as string[])[0] === "rm")).toEqual([]);
  });

  // pi speaks whatever shape the UPSTREAM speaks: the app forwards bytes, so an OpenAI-completions request can never
  // reach Anthropic's /v1/messages. The base URL pi is registered against follows from this shape and is composed
  // inside the container (`providerProxyBaseUrl`) — the app has no use for a port it never dials.
  it("tells the agent the upstream's wire shape", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), { ...spec, providerKind: "anthropic" }, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).toContain("CD_MODEL_API=anthropic-messages");
    expect(written[0]).not.toContain("CD_GATEWAY_URL");
  });

  // pi's compat detection reads the model's base URL, which is our own loopback proxy — so every upstream looks like
  // plain OpenAI to it. The agent is told where the bytes really go, and it is NOT told the key that opens them.
  it("tells the agent which upstream the app will reach, and still no credential", async () => {
    const written: string[] = [];
    await startPiAgentSession(
      fakeHost(),
      { ...spec, upstreamBaseUrl: "https://api.deepseek.com/v1" },
      async (contents) => {
        written.push(contents);
        return "/tmp/env";
      },
    );
    expect(written[0]).toContain("CD_UPSTREAM_BASE_URL=https://api.deepseek.com/v1");
    expect(written[0]).not.toContain("CD_UPSTREAM_API_KEY");
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
    expect(written[0]).toContain("CD_MODEL_REASONING=1");
    expect(written[0]).toContain("CD_MODEL_REASONING_LEVELS=low,high,xhigh");
    expect(written[0]).toContain("CD_MODEL_REASONING_MANDATORY=1");
  });

  // Silence is the honest answer for a model nobody published a capability for: pi then registers it with its own
  // `reasoning: false` and the session offers no thinking level at all.
  it("says nothing about reasoning when no provider published any", async () => {
    const written: string[] = [];
    await startPiAgentSession(fakeHost(), spec, async (contents) => {
      written.push(contents);
      return "/tmp/env";
    });
    expect(written[0]).not.toContain("CD_MODEL_REASONING");
  });

  it("builds one plain network and attaches nothing else when egress is allowed", async () => {
    const host = fakeHost();
    await startPiAgentSession(host, spec, async () => "/tmp/env");
    const argvs = commandsOf(host).map((call) => (call[1] as string[]).join(" "));
    expect(argvs.some((argv) => argv.includes("--internal"))).toBe(false);
    expect(argvs.some((argv) => argv.startsWith("network connect"))).toBe(false);
  });

  // Total isolation, not an asymmetry between two containers: an internal bridge has no route to the internet OR to
  // this machine, and inference is unaffected because it arrives on the PUBLISHED bridge port the app dials inwards.
  it("gives the container no route out at all when egress is off", async () => {
    const host = fakeHost();
    await startPiAgentSession(host, { ...spec, egress: false }, async () => "/tmp/env");
    const argvs = commandsOf(host).map((call) => (call[1] as string[]).join(" "));
    expect(argvs).toEqual([
      "inspect cd-agent-1 --format {{.State.Running}}",
      "network create --internal cd-agent-net-1",
      expect.stringContaining("--name cd-agent-1"),
    ]);
    expect(argvs[2]).toContain("--network cd-agent-net-1 ");
    expect(argvs[2]).toContain("--publish 127.0.0.1:43117:8787");
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

// The default session is the one the app reuses forever, so it cannot be named after a random suffix the next boot
// has no way to recognise. Its name IS its identity: derived from the connection, stable across restarts, and — by
// not being eight hex characters — invisible to the reaper that clears ephemeral sessions.
describe("defaultSessionNames", () => {
  it("names the default session after its connection", () => {
    expect(defaultSessionNames("podman-1")).toEqual({
      agentContainerName: "container-desktop-agent-default-podman-1",
      networkName: "container-desktop-net-default-podman-1",
    });
  });

  // The whole point: the next boot has to arrive at the same names without being told them.
  it("answers the same names every time", () => {
    expect(defaultSessionNames("docker-2")).toEqual(defaultSessionNames("docker-2"));
  });

  // A connection id is free text; a container name is not. Anything the engine would refuse has to be folded out
  // WITHOUT two different connections ever arriving at one name.
  it("keeps a connection id the engine would refuse out of the name", () => {
    const names = defaultSessionNames("Podman Machine #1");
    expect(names.agentContainerName).toMatch(/^container-desktop-agent-default-[a-z0-9][a-z0-9_.-]*$/);
  });

  it("still tells apart two ids that would clean up to the same slug", () => {
    expect(defaultSessionNames("Podman 1").agentContainerName).not.toEqual(
      defaultSessionNames("podman 1").agentContainerName,
    );
  });
});

describe("labelled run arguments", () => {
  const identified: PiAgentSessionSpec = { ...spec, connectionId: "podman-1", sessionKind: "default" };

  it("labels the agent it creates", () => {
    const argv = agentRunArgv(identified, "/home/me/project", "/tmp/env").join(" ");
    expect(argv).toContain("container-desktop.ai.role=agent");
    expect(argv).toContain("container-desktop.ai.connection=podman-1");
  });

  // A session started before this scheme existed has no labels, and its containers must still be creatable: the
  // reaper's name matching is what covers those, so the argv simply carries no label.
  it("labels nothing when the session has no identity to record", () => {
    expect(agentRunArgv(spec, "/home/me/project", "/tmp/env").join(" ")).not.toContain("container-desktop.ai.");
  });
});

// What a boot needs to know before it can decide anything: is this connection's reusable session standing, and is it
// running? Read off the engine's own listing, because the containers are the only durable record — the app's memory
// of them died with the process that had it.
describe("defaultSessionFrom", () => {
  const rows = (...names: [string, string][]) => names.map(([name, state]) => ({ name, state }));

  it("reports a session that is standing and running", () => {
    expect(defaultSessionFrom("podman-1", rows(["container-desktop-agent-default-podman-1", "running"]))).toEqual({
      connectionId: "podman-1",
      running: true,
    });
  });

  // Stopped is the case the resume offer exists for: the container is there, holding the session.
  it("reports a stopped session as standing but not running", () => {
    expect(defaultSessionFrom("podman-1", rows(["container-desktop-agent-default-podman-1", "exited"]))).toEqual({
      connectionId: "podman-1",
      running: false,
    });
  });

  // Absent is not the same as broken: it means this connection has nothing to adopt, which is what sends the boot
  // down the create-or-ask path rather than the resume one.
  it("says nothing about a connection with no default containers", () => {
    expect(defaultSessionFrom("podman-1", rows(["cd-agent-1a2b3c4d", "running"], ["web", "running"]))).toBeUndefined();
  });

  it("does not mistake another connection's default for this one's", () => {
    expect(
      defaultSessionFrom("podman-1", rows(["container-desktop-agent-default-docker-1", "running"])),
    ).toBeUndefined();
  });

  // Engines disagree about this field: podman and docker answer `running`/`exited` for {{.State}}, and a dialect that
  // fills it with a status line says `Up 3 minutes`. Both have to read as running.
  it("reads a status-style line as running too", () => {
    expect(
      defaultSessionFrom(
        "podman-1",
        rows(
          ["container-desktop-agent-default-podman-1", "Up 3 minutes"],
          ["container-desktop-gateway-default-podman-1", "Up 3 minutes"],
        ),
      ),
    ).toMatchObject({ running: true });
  });
});

describe("findDefaultSession", () => {
  function listingHost(stdout: string) {
    return fakeHost({
      runHostCommand: vi.fn(async () => ({ pid: 1, code: 0, success: true, stdout, stderr: "" })),
    });
  }

  it("asks the engine for its containers and maps the answer", async () => {
    const host = listingHost("container-desktop-agent-default-podman-1=running\nweb=running\n");
    expect(await findDefaultSession(host, "podman-1")).toEqual({
      connectionId: "podman-1",
      running: true,
    });
    expect((commandsOf(host)[0][1] as string[]).slice(0, 2)).toEqual(["ps", "--all"]);
  });

  // The separator is what it is because of the SSH hop: this template used to carry a TAB, and a remote engine then
  // answered an EMPTY listing with exit 0 — the argv split at the tab, so `{{.State}}` arrived as a container name
  // filter that matched nothing. Every connection with a running session read as having nothing to adopt.
  it("asks with a template that survives being re-split by a remote shell", async () => {
    const host = listingHost("");
    await findDefaultSession(host, "podman-1");
    for (const argument of commandsOf(host)[0][1] as string[]) {
      expect(argument).not.toMatch(/\s/u);
    }
  });

  // Discovery runs at boot against an engine that may be unreachable. Nothing it cannot answer becomes a startup
  // failure — an engine that refuses simply has no session to adopt.
  it("reports nothing when the engine refuses", async () => {
    const host = fakeHost({ runHostCommand: vi.fn(async () => Promise.reject(new Error("no such host"))) });
    expect(await findDefaultSession(host, "podman-1")).toBeUndefined();
  });
});

// Continuing a session whose pair is already running means DIALLING it: the names are taken, and taking them back
// would mean removing the user's containers. Everything needed to dial is in the engine's own inspection.
describe("attachedPiAgentSessionFrom", () => {
  // The engine's OWN `inspect` output — an array of one, with the two keys podman and docker both carry. Read whole
  // rather than through a `--format` template, because a template needs a space (`{{json .X}}`) and an argv element
  // with a space does not survive the SSH hop to a remote engine: measured, podman answers
  // `bad character U+007B` there, and a listing template with a TAB answers nothing at all with exit 0.
  const inspection = (overrides: Record<string, unknown> = {}) => {
    const { ports, env, ...rest } = overrides as { ports?: unknown; env?: unknown };
    return JSON.stringify([
      {
        NetworkSettings: {
          Ports: ports === undefined ? { "8787/tcp": [{ HostIp: "127.0.0.1", HostPort: "43521" }] } : ports,
        },
        Config: {
          Env: env === undefined ? ["CD_BRIDGE_TOKEN=tok-abc", "CD_MODEL_ID=qwen/qwen3-4b", "PATH=/usr/bin"] : env,
        },
        ...rest,
      },
    ]);
  };

  it("reads the published port, the bridge token and the model the pair is running", () => {
    expect(attachedPiAgentSessionFrom(inspection())).toEqual({
      hostPort: 43521,
      bridgeToken: "tok-abc",
      modelId: "qwen/qwen3-4b",
    });
  });

  // A pair BUILT to ask for its conversations has to be answered again after an attach, or its next turn blocks on a
  // storage call nobody is listening for.
  it("reports the conversation store's port when the pair both declares and publishes one", () => {
    const served = attachedPiAgentSessionFrom(
      inspection({
        ports: {
          "8787/tcp": [{ HostIp: "127.0.0.1", HostPort: "43521" }],
          "8789/tcp": [{ HostIp: "127.0.0.1", HostPort: "43900" }],
        },
        env: ["CD_BRIDGE_TOKEN=tok-abc", "CD_SESSION_STORAGE_PORT=8789"],
      }),
    );
    expect(served).toMatchObject({ storageHostPort: 43900 });
  });

  it("reports no store when the port is no longer published, whatever the environment claims", () => {
    // Read off the MAPPING and not the env var: the env only says the container listens, while what the app has to
    // dial is what the engine actually published.
    const served = attachedPiAgentSessionFrom(
      inspection({ env: ["CD_BRIDGE_TOKEN=tok-abc", "CD_SESSION_STORAGE_PORT=8789"] }),
    );
    expect(served).not.toHaveProperty("storageHostPort");
  });

  it("reports no store for a pair that never asked for one", () => {
    expect(attachedPiAgentSessionFrom(inspection())).not.toHaveProperty("storageHostPort");
  });

  // Whether the pair's conversations are mounted from the host is not something the app may assume about a container
  // it did not build in this run: `CD_SESSION_DIR` and the `--volume` are emitted together from the same field, so the
  // env is the proof. A pair built before the mount existed reports nothing, and nothing is what it has.
  it("reports the conversations directory the pair was built with", () => {
    const payload = inspection({
      env: ["CD_BRIDGE_TOKEN=tok-abc", `CD_SESSION_DIR=${SESSIONS_DIR_IN_IMAGE}`],
    });
    expect(attachedPiAgentSessionFrom(payload)?.sessionsDir).toBe(SESSIONS_DIR_IN_IMAGE);
  });

  it("reports no conversations directory for a pair whose history is still in the volume", () => {
    expect(attachedPiAgentSessionFrom(inspection())).not.toHaveProperty("sessionsDir");
  });

  // A token is opaque and may carry the separator itself; splitting on every "=" would truncate it silently.
  it("keeps an env value that contains its own separator", () => {
    const payload = inspection({ env: ["CD_BRIDGE_TOKEN=a=b=c"] });
    expect(attachedPiAgentSessionFrom(payload)?.bridgeToken).toBe("a=b=c");
  });

  it("has nothing to dial when the bridge port is not published", () => {
    expect(attachedPiAgentSessionFrom(inspection({ ports: {} }))).toBeUndefined();
    expect(attachedPiAgentSessionFrom(inspection({ ports: null }))).toBeUndefined();
  });

  // Without the token the socket refuses the connection, so an attach that "succeeded" would fail one step later
  // with an authorisation error nobody could act on.
  it("has nothing to dial without the token that authorises the socket", () => {
    expect(attachedPiAgentSessionFrom(inspection({ env: ["PATH=/usr/bin"] }))).toBeUndefined();
  });

  it("treats an answer it cannot parse as nothing to adopt", () => {
    expect(attachedPiAgentSessionFrom("")).toBeUndefined();
    expect(attachedPiAgentSessionFrom("no such object: cd-agent-1")).toBeUndefined();
  });
});

describe("attachPiAgentSession", () => {
  it("asks the engine to inspect the agent container alone", async () => {
    const host = fakeHost({
      runHostCommand: vi.fn(async () => ({
        pid: 1,
        code: 0,
        success: true,
        stdout: JSON.stringify([
          {
            NetworkSettings: { Ports: { "8787/tcp": [{ HostPort: "43000" }] } },
            Config: { Env: ["CD_BRIDGE_TOKEN=tok"] },
          },
        ]),
        stderr: "",
      })),
    });
    expect(await attachPiAgentSession(host, "cd-agent-1")).toEqual({ hostPort: 43000, bridgeToken: "tok" });
    const argv = commandsOf(host)[0][1] as string[];
    expect(argv.slice(0, 2)).toEqual(["inspect", "cd-agent-1"]);
    // No `--format`: its template needs a space, and a spaced argv element is re-split by a remote shell — which made
    // adopting a session on a remote engine fail with podman's own `bad character U+007B`.
    for (const argument of argv) expect(argument).not.toMatch(/\s/u);
  });

  // The pair may have been removed between the listing and the click. That is "nothing to adopt", not a crash.
  it("reports nothing when the engine has no such container", async () => {
    const host = fakeHost({ runHostCommand: vi.fn(async () => Promise.reject(new Error("no such object"))) });
    expect(await attachPiAgentSession(host, "cd-agent-1")).toBeUndefined();
  });
});

describe("stopPiAgentSession", () => {
  // The network holds a /24 out of the engine's pool for as long as it exists, so leaving it behind is how an orderly
  // stop still leaks.
  it("removes the container and the session's network", async () => {
    const host = fakeHost();
    await stopPiAgentSession(host, spec);
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toEqual([
      "rm --force cd-agent-1",
      "network rm cd-agent-net-1",
    ]);
  });

  it("removes the same one whether or not egress was allowed", async () => {
    const host = fakeHost();
    await stopPiAgentSession(host, { ...spec, egress: false });
    expect(commandsOf(host).map((call) => (call[1] as string[]).join(" "))).toEqual([
      "rm --force cd-agent-1",
      "network rm cd-agent-net-1",
    ]);
  });
});
