import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

// What start() does with the session BEFORE it can be talked to. The container pair and the socket are the only
// two things a hermetic run cannot have; everything else here is the real path, because the ordering under test
// is start()'s own — and mock mode takes a different one, which is exactly how this went unnoticed.

const startPiAgentSession = vi.fn(async () => ({ hostPort: 45871 }));
const createPiBridgeClient = vi.fn();

vi.mock("@/ai-system/adapters/piAgentContainer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai-system/adapters/piAgentContainer")>()),
  startPiAgentSession: (...args: unknown[]) => startPiAgentSession(...(args as [])),
}));
vi.mock("@/ai-system/adapters/piBridgeClient", () => ({
  createPiBridgeClient: (...args: unknown[]) => createPiBridgeClient(...args),
}));
vi.mock("@/web-app/domain/engineHost", () => ({
  resolveConnectionHost: async () => ({ PROGRAM: "podman" }),
}));

const READY: BridgeEvent = {
  type: "ready",
  protocolVersion: 1,
  sessionId: "pi-session-1",
  cwd: "/workspace",
  model: "lmstudio/qwen3-4b-instruct-2507",
};

// A socket reports the session's arrival DURING connect. That is the whole point: everything pi says between
// dialling and the promise settling is said to a store that may not hold the client yet.
function fakeClient(events: BridgeEvent[]) {
  let listener: (event: BridgeEvent) => void = () => {};
  const client = {
    onEvent: (fn: (event: BridgeEvent) => void) => {
      listener = fn;
      return () => {};
    },
    connect: vi.fn(async () => {
      for (const event of events) listener(event);
    }),
    listResources: vi.fn(async () => ({
      extensions: [],
      commands: [],
      skills: [],
      prompts: [],
      builtins: [{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", runsIn: "session" }],
    })),
    setTheme: vi.fn(async () => {}),
    setSystemContext: vi.fn(async () => {}),
    close: vi.fn(),
  };
  return client as unknown as PiBridgeClient;
}

const START = {
  connectionId: "podman-1",
  workspacePath: "/work",
  modelId: "qwen3-4b-instruct-2507",
  providerId: "lmstudio",
  upstreamBaseUrl: "http://127.0.0.1:1234/v1",
  appVersion: "6.0.0",
};

describe("useCodingAgentStore start", () => {
  beforeEach(() => {
    // A stray flag in the shell would send start() down the scripted path and prove nothing.
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    (globalThis as { window?: unknown }).window = {
      AI: {
        modelWindow: vi.fn(async () => ({})),
        writeAgentGatewayEnv: vi.fn(async () => ({ path: "/protected/gateway.env" })),
        writeAgentEnvFile: vi.fn(async () => ({ path: "/protected/agent.env" })),
        getProjectContext: vi.fn(async () => undefined),
      },
    };
    useCodingAgentStore.setState({
      client: undefined,
      status: "idle",
      spec: undefined,
      resources: { extensions: [], commands: [], skills: [], prompts: [], builtins: [] },
      view: emptyPiSessionView("pi-session"),
      sessionModel: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    useCodingAgentStore.setState({ client: undefined, status: "idle" });
    (globalThis as { window?: unknown }).window = undefined;
  });

  it("holds the client before the session can report anything", async () => {
    createPiBridgeClient.mockReturnValue(fakeClient([READY]));

    await useCodingAgentStore.getState().start(START);

    // pi's own commands are reported by the session, not hard-coded here, so an event answered by a store with
    // no client leaves the palette permanently empty — every pi command then reads as "Unknown command".
    await vi.waitFor(() =>
      expect(useCodingAgentStore.getState().resources.builtins.map(({ name }) => name)).toContain("scoped-models"),
    );
    expect(useCodingAgentStore.getState().status).toBe("ready");
    // The model pi answered with, not the id the form asked for — the provider prefix belongs to pi's label.
    expect(useCodingAgentStore.getState().sessionModel).toBe("qwen3-4b-instruct-2507");
  });

  it("keeps no client when the session could not be dialled", async () => {
    const client = fakeClient([]);
    (client.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("connection refused"));
    createPiBridgeClient.mockReturnValue(client);

    await useCodingAgentStore.getState().start(START);

    expect(useCodingAgentStore.getState().status).toBe("error");
    expect(useCodingAgentStore.getState().error).toContain("connection refused");
    // A client nothing answered on would let submit() and every panel dial a socket that was never up.
    expect(useCodingAgentStore.getState().client).toBeUndefined();
  });
});
