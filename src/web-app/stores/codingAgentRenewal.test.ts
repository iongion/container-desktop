import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { Notification } from "@/web-app/Notification";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import { type ProviderRefreshResult, useProviderLoginStore } from "@/web-app/stores/providerLogin";

// The renderer's half of a self-renewing sign-in. The exchange itself belongs to the one-shot container and is
// covered where it lives (pi-agent-host/authLogin.test.ts); what is covered here is everything the app decides
// AROUND it — when a rotation is asked for, what a spent refresh token stops, and how a token that lapses mid-session
// reaches a gateway that is already running. None of it needs a provider, an account or a container.

const startPiAgentSession = vi.fn(async (..._args: unknown[]) => ({ hostPort: 45871 }));
const stopPiAgentSession = vi.fn(async () => {});
const createPiBridgeClient = vi.fn();

vi.mock("@/ai-system/adapters/piAgentContainer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ai-system/adapters/piAgentContainer")>()),
  // Faithful in the one respect this file asserts: the real one AWAITS the host-written gateway env file before it
  // runs the gateway, so calling it here is what puts "the token was frozen" on the record in the right order.
  startPiAgentSession: async (
    host: unknown,
    spec: unknown,
    envFile: unknown,
    options?: { gatewayEnvFile?: () => Promise<string> },
  ) => {
    await options?.gatewayEnvFile?.();
    return startPiAgentSession(host, spec, envFile, options);
  },
  stopPiAgentSession: () => stopPiAgentSession(),
}));
vi.mock("@/ai-system/adapters/piBridgeClient", () => ({
  createPiBridgeClient: (...args: unknown[]) => createPiBridgeClient(...args),
}));
vi.mock("@/web-app/domain/engineHost", () => ({
  resolveConnectionHost: async () => ({ PROGRAM: "podman" }),
}));
// The real one builds a Blueprint toaster against a window these tests install and remove themselves.
vi.mock("@/web-app/Notification", () => ({ Notification: { show: vi.fn() } }));

const READY: BridgeEvent = {
  type: "ready",
  protocolVersion: 1,
  sessionId: "pi-session-1",
  cwd: "/workspace",
  model: "anthropic/claude-sonnet-4",
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
    setGatewayCredential: vi.fn(async () => {}),
    close: vi.fn(),
  };
  return client as unknown as PiBridgeClient;
}

const START = {
  connectionId: "podman-1",
  workspacePath: "/work",
  modelId: "claude-sonnet-4",
  providerId: "anthropic",
  upstreamBaseUrl: "https://api.anthropic.com",
  appVersion: "6.0.0",
};

// A minute past the margin the store renews on, so a scheduled rotation is a step this test takes deliberately
// rather than something that fires while start() is still running.
const NOW = 1_800_000_000_000;
const TEN_MINUTES = 600_000;
const RENEWAL_MARGIN_MS = 60_000;

const realRefreshCredential = useProviderLoginStore.getState().refreshCredential;
let writeAgentGatewayEnv = vi.fn(async () => ({ path: "/protected/gateway.env" }));

// What the vault's owning realm answers when the app asks for a rotation. Replaced in the store rather than mocked
// as a module, so start() reaches it exactly the way it does in the app.
function answerRotationWith(...outcomes: ProviderRefreshResult[]) {
  const rotate = vi.fn(async () => outcomes[Math.min(rotate.mock.calls.length - 1, outcomes.length - 1)]);
  useProviderLoginStore.setState({ refreshCredential: rotate });
  return rotate;
}

describe("useCodingAgentStore credential renewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // A stray flag in the shell would send start() down the scripted path, which rotates nothing.
    vi.stubEnv("CONTAINER_DESKTOP_MOCK", "");
    writeAgentGatewayEnv = vi.fn(async () => ({ path: "/protected/gateway.env" }));
    (globalThis as { window?: unknown }).window = {
      AI: {
        modelWindow: vi.fn(async () => ({})),
        writeAgentGatewayEnv,
        writeAgentEnvFile: vi.fn(async () => ({ path: "/protected/agent.env" })),
        getProjectContext: vi.fn(async () => undefined),
      },
    };
    createPiBridgeClient.mockReturnValue(fakeClient());
    useCodingAgentStore.setState({
      client: undefined,
      status: "idle",
      spec: undefined,
      startLog: [],
      view: emptyPiSessionView("pi-session"),
      error: undefined,
    });
  });

  afterEach(async () => {
    // The renewal timer is module state, so a test that leaves one armed renews inside the next one.
    await useCodingAgentStore.getState().stop();
    useProviderLoginStore.setState({ refreshCredential: realRefreshCredential });
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = undefined;
  });

  it("rotates the credential before the gateway env file freezes it", async () => {
    const rotate = answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });

    await useCodingAgentStore.getState().start(START);

    expect(rotate).toHaveBeenCalledWith("anthropic");
    // That file is where the access token is frozen for the session's whole life, so a rotation after it would be
    // stored in the vault and never reach the gateway this session talks to.
    expect(rotate.mock.invocationCallOrder[0]).toBeLessThan(writeAgentGatewayEnv.mock.invocationCallOrder[0]);
  });

  it("says in the start log that the sign-in was renewed", async () => {
    answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });

    await useCodingAgentStore.getState().start(START);

    expect(useCodingAgentStore.getState().startLog).toContain("renewed the anthropic sign-in");
  });

  it("refuses to start on a sign-in that can no longer be renewed", async () => {
    answerRotationWith({ refreshed: false, mustSignInAgain: true, reason: "invalid_grant" });

    await useCodingAgentStore.getState().start(START);

    expect(useCodingAgentStore.getState().status).toBe("error");
    expect(useCodingAgentStore.getState().error).toContain("sign in again");
    // Said here rather than surfacing as a 401 on the first turn — so no pair may be standing to take one.
    expect(startPiAgentSession).not.toHaveBeenCalled();
  });

  it("asks for no rotation at all when the endpoint is keyless", async () => {
    const rotate = answerRotationWith({ refreshed: false });

    await useCodingAgentStore.getState().start({ ...START, providerId: undefined });

    // A keyless local server names no provider, so there is no vault entry to rotate and no container to spend on it.
    expect(rotate).not.toHaveBeenCalled();
    expect(useCodingAgentStore.getState().status).toBe("ready");
  });

  it("hands a rotation to the gateway that is already running", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: true, expiresAt: NOW + 2 * TEN_MINUTES, accessToken: "rotated-2" },
    );
    await useCodingAgentStore.getState().start(START);
    const client = useCodingAgentStore.getState().client as PiBridgeClient;

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);

    expect(rotate).toHaveBeenCalledTimes(2);
    // The gateway sits on the pair's --internal network with no published port, so the agent container is the only
    // thing that can carry the new token to it.
    expect(client.setGatewayCredential).toHaveBeenCalledWith("rotated-2");
  });

  it("keeps renewing after the gateway refuses a rotation", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: true, expiresAt: NOW + TEN_MINUTES + 120_000, accessToken: "rotated-2" },
      { refreshed: true, expiresAt: NOW + TEN_MINUTES + 600_000, accessToken: "rotated-3" },
    );
    await useCodingAgentStore.getState().start(START);
    const client = useCodingAgentStore.getState().client as PiBridgeClient;
    (client.setGatewayCredential as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no route to the gateway"));

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);
    expect(rotate).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);

    // The vault holds the rotation whether or not the push landed, so a refused one costs this session's gateway
    // its new token; dropping the timer with it would cost every renewal after, silently.
    expect(rotate).toHaveBeenCalledTimes(3);
  });

  it("reschedules off the expiry the exchange reported, not the first one", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: true, expiresAt: NOW + TEN_MINUTES + 120_000, accessToken: "rotated-2" },
      { refreshed: true, expiresAt: NOW + TEN_MINUTES + 600_000, accessToken: "rotated-3" },
    );
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);
    expect(rotate).toHaveBeenCalledTimes(2);
    // A provider whose token lives two minutes is renewed every minute; scheduling off the first expiry would
    // renew it once and let every turn after that die on a lapsed token.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(rotate).toHaveBeenCalledTimes(3);
  });

  it("leaves a permanent key with no renewal timer", async () => {
    const rotate = answerRotationWith({ refreshed: false });

    await useCodingAgentStore.getState().start(START);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);

    // A key that never lapses has nothing to rotate, and a timer on it would start a login container for nothing.
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it("stops renewing once the session is stopped", async () => {
    const rotate = answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });
    await useCodingAgentStore.getState().start(START);

    await useCodingAgentStore.getState().stop();
    await vi.advanceTimersByTimeAsync(TEN_MINUTES);

    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it("renews again on a session started afresh", async () => {
    const rotate = answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });
    await useCodingAgentStore.getState().start(START);
    await useCodingAgentStore.getState().stop();
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);

    // One rotation per start, and one from the timer the second start armed. A fourth would mean the first
    // session's timer outlived it; two would mean cancelling a session's renewals cancelled its successor's.
    expect(rotate).toHaveBeenCalledTimes(3);
  });

  it("stops renewing when the session ends while an exchange is still running", async () => {
    let settle: (outcome: ProviderRefreshResult) => void = () => {};
    const rotate = vi.fn(async () => {
      if (rotate.mock.calls.length > 1) {
        return new Promise<ProviderRefreshResult>((resolve) => {
          settle = resolve;
        });
      }
      return { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" } as ProviderRefreshResult;
    });
    useProviderLoginStore.setState({ refreshCredential: rotate });
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);
    expect(rotate).toHaveBeenCalledTimes(2);
    await useCodingAgentStore.getState().stop();
    settle({ refreshed: true, expiresAt: NOW + 2 * TEN_MINUTES, accessToken: "rotated-2" });
    await vi.advanceTimersByTimeAsync(2 * TEN_MINUTES);

    // Rescheduling off an exchange that outlived its session leaves a timer nothing can cancel: it starts a login
    // container every rotation, for a session that ended, until the app is closed.
    expect(rotate).toHaveBeenCalledTimes(2);
  });

  it("says the sign-in expired when a scheduled rotation finds the refresh token spent", async () => {
    answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: false, mustSignInAgain: true, reason: "invalid_grant" },
    );
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);

    // Mid-session there is no start drawer to report into, and the turns simply begin failing, so the only place
    // left to say it is a notification.
    expect(Notification.show).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("sign-in expired") }),
    );
  });
});
