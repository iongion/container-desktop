import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AttachedPiAgentSession } from "@/ai-system/adapters/piAgentContainer";
import { SESSIONS_DIR_IN_IMAGE } from "@/ai-system/adapters/piAgentContainer";
import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import { ContainerEngineHost } from "@/container-client/types/engine";
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
const createPiBridgeClient = vi.fn();

vi.mock("@/ai-system/adapters/piAgentContainer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai-system/adapters/piAgentContainer")>()),
  startPiAgentSession: (...args: unknown[]) => startPiAgentSession(...args),
  attachPiAgentSession: (...args: unknown[]) => attachPiAgentSession(...args),
}));
vi.mock("@/ai-system/adapters/piBridgeClient", () => ({
  createPiBridgeClient: (...args: unknown[]) => createPiBridgeClient(...args),
}));
// The connection the session starts on, swapped per test: whether a directory this machine made can be mounted at all
// depends on the engine host.
let engineHost: { PROGRAM: string; HOST: ContainerEngineHost } = {
  PROGRAM: "podman",
  HOST: ContainerEngineHost.PODMAN_NATIVE,
};
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

function installBridge(overrides: Record<string, unknown> = {}) {
  askedForSessionsDir = vi.fn(async () => ({ path: HOST_SESSIONS_DIR }));
  (globalThis as { window?: unknown }).window = {
    AI: {
      modelWindow: vi.fn(async () => ({})),
      writeAgentEnvFile: vi.fn(async () => ({ path: "/protected/agent.env" })),
      agentSessionsDir: askedForSessionsDir,
      getProjectContext: vi.fn(async () => undefined),
      ...overrides,
    },
  };
}

function startedSpec() {
  return startPiAgentSession.mock.calls[0][1] as { sessionsPath?: string };
}

describe("useCodingAgentStore conversations directory", () => {
  beforeEach(() => {
    // A stray flag would send both paths through the scripted bridge, which mounts nothing.
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    engineHost = { PROGRAM: "podman", HOST: ContainerEngineHost.PODMAN_NATIVE };
    createPiBridgeClient.mockReturnValue(fakeClient());
    installBridge();
    useCodingAgentStore.setState({
      client: undefined,
      status: "idle",
      spec: undefined,
      startLog: [],
      view: emptyPiSessionView("pi-session"),
      error: undefined,
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
  // have the ENGINE create it, as root, and pi would fail with EACCES on the first turn of a session that works today.
  it("mounts nothing on a remote engine, whose machine never had this directory", async () => {
    engineHost = { PROGRAM: "podman", HOST: ContainerEngineHost.PODMAN_REMOTE };

    await useCodingAgentStore.getState().start(START);

    expect(startedSpec().sessionsPath).toBeUndefined();
    expect(useCodingAgentStore.getState().status).toBe("ready");
    // Not even asked for: a directory created here would be for nothing.
    expect(askedForSessionsDir).not.toHaveBeenCalled();
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
});
