import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachedPiAgentSession } from "@/ai-system/adapters/piAgentContainer";
import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { SESSIONS_DIR_IN_IMAGE } from "@/pi-bridge/image";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

// Where a session's conversations come from. pi defaults them under its agent dir, which IS the mounted plugin
// volume — so a user's history lived and died with a container they did not think they were storing it in. The app
// mounts a directory of its own instead, and only the HOST can name it: this realm cannot know the app's data
// location, and a bind-mount whose source is missing is created by the engine as root.

const startPiAgentSession = vi.fn(async (..._args: unknown[]) => ({ hostPort: 45871 }));
const attachPiAgentSession = vi.fn(
  async (..._args: unknown[]): Promise<AttachedPiAgentSession | undefined> => ({
    hostPort: 45871,
    bridgeToken: "bridge-token-1",
    modelId: "qwen3-4b-instruct-2507",
  }),
);
const stopPiAgentSession = vi.fn(async (..._args: unknown[]) => {});
const createPiBridgeClient = vi.fn();

vi.mock("@/ai-system/adapters/piAgentContainer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai-system/adapters/piAgentContainer")>()),
  startPiAgentSession: (...args: unknown[]) => startPiAgentSession(...args),
  attachPiAgentSession: (...args: unknown[]) => attachPiAgentSession(...args),
  stopPiAgentSession: (...args: unknown[]) => stopPiAgentSession(...args),
}));
vi.mock("@/ai-system/adapters/piBridgeClient", () => ({
  createPiBridgeClient: (...args: unknown[]) => createPiBridgeClient(...args),
}));
// The connection the session starts on, swapped per test: whether a directory this machine made can be mounted at all
// depends on the engine host, and so does where a port it publishes answers.
//
// It answers the two questions the store asks of EVERY connection — which scope its engine commands run through, and
// which machines its engine has — because those are the connection's answers, not a caller's. A remote connection with
// no scope is one no forward could be aimed at, which is a session that cannot be started.
function connection(host: ContainerEngineHost, scope?: string) {
  return {
    PROGRAM: "podman",
    HOST: host,
    isScoped: () => !!scope,
    getSettings: async () => ({ controller: scope ? { scope } : undefined }),
    // None: this engine publishes where the app already dials. The machine hop is measured in the connection layer's
    // own tests; here the point is that it is ASKED.
    getPodmanMachines: async () => [],
  };
}
let engineHost: ReturnType<typeof connection> = connection(ContainerEngineHost.PODMAN_NATIVE);
vi.mock("@/web-app/domain/engineHost", () => ({
  resolveConnectionHost: async () => engineHost,
}));

const READY: BridgeEvent = {
  type: "ready",
  protocolVersion: 1,
  sessionId: "pi-session-1",
  cwd: "/workspace",
  model: "lmstudio/qwen3-4b-instruct-2507",
};

function fakeClient() {
  let listener: (event: BridgeEvent) => void = () => {};
  const client = {
    onEvent: (fn: (event: BridgeEvent) => void) => {
      listener = fn;
      return () => {};
    },
    connect: vi.fn(async () => {
      listener(READY);
    }),
    listResources: vi.fn(async () => ({ extensions: [], commands: [], skills: [], prompts: [], builtins: [] })),
    setTheme: vi.fn(async () => {}),
    setSystemContext: vi.fn(async () => {}),
    close: vi.fn(),
  };
  return client as unknown as PiBridgeClient;
}

// Keyless on purpose: a provider with a credential would pull a rotation into a test about a directory.
const START = {
  connectionId: "podman-1",
  workspacePath: "/work",
  modelId: "qwen3-4b-instruct-2507",
  upstreamBaseUrl: "http://127.0.0.1:1234/v1",
  appVersion: "6.0.0",
};

const HOST_SESSIONS_DIR = "/home/me/.local/share/container-desktop/assistant-sessions";

let askedForSessionsDir = vi.fn(async () => ({ path: HOST_SESSIONS_DIR }));
// Serving the conversations to a pair that cannot MOUNT them, and the stop that must follow.
let servedConversations = vi.fn(async (_request: { localPort: number; bridgeToken: string }) => ({ ok: true }));
let stoppedServingConversations = vi.fn(async () => ({ ok: true }));
// The `ssh -NL` child a remote session is reached through, and the kill that must follow it.
const killed = vi.fn();
const spawned = vi.fn(async (_launcher: string, _args: string[]) => ({ kill: killed, on: () => {} }));

function installBridge(overrides: Record<string, unknown> = {}) {
  askedForSessionsDir = vi.fn(async () => ({ path: HOST_SESSIONS_DIR }));
  servedConversations = vi.fn(async (_request: { localPort: number; bridgeToken: string }) => ({ ok: true }));
  stoppedServingConversations = vi.fn(async () => ({ ok: true }));
  // The exec seam the forward is spawned through, and the SSH config it is aimed at. Globals, because that is how the
  // shells expose them to the renderer.
  (globalThis as { Command?: unknown }).Command = { ExecuteStreaming: spawned };
  (globalThis as { Platform?: unknown }).Platform = {
    getSSHConfig: async () => [
      {
        Name: "win11",
        Host: "win11",
        HostName: "192.168.122.5",
        Port: 22,
        User: "me",
        IdentityFile: "",
        ConfigHost: "win11",
      },
    ],
  };
  (globalThis as { window?: unknown }).window = {
    AI: {
      modelWindow: vi.fn(async () => ({})),
      writeAgentEnvFile: vi.fn(async () => ({ path: "/protected/agent.env" })),
      agentSessionsDir: askedForSessionsDir,
      serveAgentSessions: servedConversations,
      stopServingAgentSessions: stoppedServingConversations,
      getProjectContext: vi.fn(async () => undefined),
      ...overrides,
    },
  };
}

function startedSpec() {
  return startPiAgentSession.mock.calls[0][1] as { sessionsPath?: string; storageHostPort?: number };
}

describe("useCodingAgentStore conversations directory", () => {
  beforeEach(() => {
    // A stray flag would send both paths through the scripted bridge, which mounts nothing.
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    engineHost = connection(ContainerEngineHost.PODMAN_NATIVE);
    createPiBridgeClient.mockReturnValue(fakeClient());
    installBridge();
    useCodingAgentStore.setState({
      client: undefined,
      status: "idle",
      spec: undefined,
      startLog: [],
      view: emptyPiSessionView("pi-session"),
      error: undefined,
      // A forward left in the store by the previous case would be torn down by this one's start, which makes every
      // count in here a count of somebody else's session.
      bridgeTunnel: undefined,
      conversationsTunnel: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    useCodingAgentStore.setState({ client: undefined, status: "idle", spec: undefined });
    (globalThis as { window?: unknown }).window = undefined;
  });

  it("starts the pair with the directory the host resolved", async () => {
    await useCodingAgentStore.getState().start(START);

    // On the spec, because that is what mounts it and what emits CD_SESSION_DIR — the two halves that put the
    // history outside the volume.
    expect(startedSpec().sessionsPath).toBe(HOST_SESSIONS_DIR);
  });

  // Absent is a first-class answer: pi then keeps its own default, which is exactly the behaviour that shipped
  // before this directory existed. Refusing to start would trade a session for a place to put its transcript.
  it("starts a session anyway when the host cannot resolve one", async () => {
    installBridge({ agentSessionsDir: undefined });

    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().sessionsPath).toBeUndefined();
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });

  it("starts a session anyway when the host refuses to create one", async () => {
    installBridge({
      agentSessionsDir: vi.fn(async () => {
        throw new Error("EROFS: read-only file system");
      }),
    });

    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().sessionsPath).toBeUndefined();
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });

  // A remote engine runs on a machine that has never seen this directory, and its path translation is deliberately the
  // identity — over SSH the workspace path is one the remote already has. Asking it to mount a path from here would
  // have the ENGINE create it, as root, and pi would fail with EACCES on the first turn. So the pair is SERVED the
  // directory instead: it publishes a socket, and this app answers pi's reads and writes over it.
  it("serves the conversations to a remote engine instead of mounting them", async () => {
    engineHost = connection(ContainerEngineHost.PODMAN_REMOTE, "win11");

    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().sessionsPath).toBeUndefined();
    expect(startedSpec().storageHostPort).toBeGreaterThan(0);
    expect(servedConversations).toHaveBeenCalledTimes(1);
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });

  // The two are exclusive by construction: a pair that mounts the directory and also answered for it would be two
  // writers on one file.
  it("does not serve a local engine, which mounts the directory instead", async () => {
    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().sessionsPath).toBe(HOST_SESSIONS_DIR);
    expect(startedSpec().storageHostPort).toBeUndefined();
    expect(servedConversations).not.toHaveBeenCalled();
  });

  // Without a directory there is nothing to answer WITH, and a store that accepted calls it could not serve would fail
  // every turn. pi keeps its own default instead, which is the behaviour that shipped before any of this existed.
  it("serves nothing when the host could not resolve a directory", async () => {
    engineHost = connection(ContainerEngineHost.PODMAN_REMOTE, "win11");
    installBridge({ agentSessionsDir: undefined });

    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().storageHostPort).toBeUndefined();
    expect(servedConversations).not.toHaveBeenCalled();
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });

  // Both forwards die with the session, and the store stops answering. A socket left serving would keep a path into
  // the user's history open for containers that no longer exist.
  it("stops serving the conversations when the session stops", async () => {
    engineHost = connection(ContainerEngineHost.PODMAN_REMOTE, "win11");

    await useCodingAgentStore.getState().start(START);
    // Two `ssh -NL` children: the bridge, and the conversation store.
    expect(spawned).toHaveBeenCalledTimes(2);

    await useCodingAgentStore.getState().stop();

    expect(stoppedServingConversations).toHaveBeenCalled();
    expect(killed).toHaveBeenCalledTimes(2);
  });

  // A remote connection whose scope names no entry in `~/.ssh/config` cannot be forwarded to, and a session that
  // "started" would then own containers on the remote that nothing can ever talk to.
  it("refuses a remote session it has no way to reach, instead of starting one", async () => {
    engineHost = connection(ContainerEngineHost.PODMAN_REMOTE, "not-in-my-ssh-config");

    await useCodingAgentStore.getState().start(START);

    expect(useCodingAgentStore.getState().status).toBe("error");
    expect(useCodingAgentStore.getState().error).toContain("not-in-my-ssh-config");
  });

  // A pair on a remote engine publishes its bridge on ITS loopback, so the app dialling 127.0.0.1 reaches nothing at
  // all — which is why an assistant session on an SSH connection could not exist. The forward is what makes that port
  // answer here, and it must die exactly when the session does.
  it("reaches a remote pair through a forward, and takes it down with the session", async () => {
    engineHost = connection(ContainerEngineHost.PODMAN_REMOTE, "win11");

    await useCodingAgentStore.getState().start(START);

    // The BRIDGE's forward specifically: a served session opens a second one for the conversation store, and the two
    // are told apart by which remote port they aim at.
    const forwards = spawned.mock.calls as unknown as [string, string[]][];
    const [launcher, argv] = forwards.find(([, args]) => args.join(" ").includes(":127.0.0.1:45871")) as [
      string,
      string[],
    ];
    expect(launcher).toBe("ssh");
    // The remote end is the port the pair published; the local end is what the client dialled.
    expect(argv.join(" ")).toMatch(/-NL 127\.0\.0\.1:\d+:127\.0\.0\.1:45871/);
    const dialled = createPiBridgeClient.mock.calls[0][0] as { url: string };
    expect(dialled.url).toBe(`ws://127.0.0.1:${argv.join(" ").match(/127\.0\.0\.1:(\d+):127/)?.[1]}/`);

    await useCodingAgentStore.getState().stop();

    expect(killed).toHaveBeenCalled();
  });

  it("opens no forward for a pair on this machine", async () => {
    await useCodingAgentStore.getState().start(START);

    expect(spawned).not.toHaveBeenCalled();
    expect((createPiBridgeClient.mock.calls[0][0] as { url: string }).url).toBe("ws://127.0.0.1:45871/");
  });

  // Attaching mounts nothing — the pair is already built. So what the spec may claim about it is only what the
  // pair itself reports: CD_SESSION_DIR and the --volume are emitted together, so the env is the proof.
  it("claims the directory for a running pair whose env carries it", async () => {
    attachPiAgentSession.mockResolvedValueOnce({
      hostPort: 45871,
      bridgeToken: "bridge-token-1",
      modelId: "qwen3-4b-instruct-2507",
      sessionsDir: SESSIONS_DIR_IN_IMAGE,
    });

    await useCodingAgentStore.getState().attachSession({ ...START, sessionKind: "default" });

    expect(useCodingAgentStore.getState().spec?.sessionsPath).toBe(HOST_SESSIONS_DIR);
  });

  it("claims none for a running pair whose history is still in the volume", async () => {
    await useCodingAgentStore.getState().attachSession({ ...START, sessionKind: "default" });

    // A pair built before the mount existed has no such directory, and saying it has one would describe a mount
    // that is not there.
    expect(useCodingAgentStore.getState().spec?.sessionsPath).toBeUndefined();
  });

  it("removes nothing when attaching to a running pair fails", async () => {
    stopPiAgentSession.mockClear();
    const client = fakeClient();
    (client.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    createPiBridgeClient.mockReturnValue(client);

    await useCodingAgentStore.getState().attachSession({ ...START, sessionKind: "default" });

    expect(useCodingAgentStore.getState().status).toBe("error");
    // The deliberate asymmetry with `start`, which DOES release what it just created. This pair was already running
    // and holds the user's conversation: failing to reach it is this app's problem, not a reason to destroy it. Making
    // the two paths "consistent" would silently delete the session the user asked to continue.
    expect(stopPiAgentSession).not.toHaveBeenCalled();
  });
});
