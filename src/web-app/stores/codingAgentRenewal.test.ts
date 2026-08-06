import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import type { BridgeEvent } from "@/pi-bridge/protocol";
import { Notification } from "@/web-app/Notification";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";
import { type ProviderRefreshResult, useProviderLoginStore } from "@/web-app/stores/providerLogin";

// The renderer's half of a self-renewing sign-in. The exchange itself belongs to the one-shot container and is
// covered where it lives (pi-agent-host/authLogin.test.ts); what is covered here is everything the app decides
// AROUND it — when a rotation is asked for, what a spent refresh token stops, and that the chain survives an exchange
// that fails. None of it needs a provider, an account or a container.
//
// Nothing DELIVERS a rotation any more: inference reads the vault per request, natively, so a session signs its next
// turn with whatever the last exchange stored. What is left to get wrong is the scheduling.

const startPiAgentSession = vi.fn(async (..._args: unknown[]) => ({ hostPort: 45871 }));
const stopPiAgentSession = vi.fn(async () => {});
const createPiBridgeClient = vi.fn();
// What a running pair answers when the app dials back into it: its own port, token and model.
const attachPiAgentSession = vi.fn(async (..._args: unknown[]) => ({
  hostPort: 45871,
  bridgeToken: "bridge-token-1",
  modelId: "anthropic/claude-sonnet-4",
}));

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
  attachPiAgentSession: (...args: unknown[]) => attachPiAgentSession(...args),
}));
vi.mock("@/ai-system/adapters/piBridgeClient", () => ({
  createPiBridgeClient: (...args: unknown[]) => createPiBridgeClient(...args),
}));
vi.mock("@/web-app/domain/engineHost", () => ({
  // A connection on THIS machine: it wraps no command in a scope, which is the answer the store asks it for.
  resolveConnectionHost: async () => ({ PROGRAM: "podman", isScoped: () => false }),
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
const RENEWAL_RETRY_MS = 120_000;
const RENEWAL_RETRY_LIMIT = 3;

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

  it("rotates the credential before the pair is created", async () => {
    const rotate = answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });

    await useCodingAgentStore.getState().start(START);

    expect(rotate).toHaveBeenCalledWith("anthropic");
    // A token already lapsed would surface as a 401 on the first turn, which reads as a broken session rather than an
    // expired sign-in. Renewing first is what keeps that from being how the user finds out.
    expect(rotate.mock.invocationCallOrder[0]).toBeLessThan(startPiAgentSession.mock.invocationCallOrder[0]);
  });

  it("says in the start log that the sign-in was renewed", async () => {
    answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });

    await useCodingAgentStore.getState().start(START);

    expect(useCodingAgentStore.getState().startLog).toContain("renewed the anthropic sign-in");
  });

  // Continuing a pair that outlived the app is the one path where the credential is certain to be OLDER than the
  // session: nothing renewed it while the app was closed, and the pair's own environment was frozen when it was built.
  it("renews a sign-in that lapsed while the app was closed", async () => {
    const rotate = answerRotationWith({ refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" });
    createPiBridgeClient.mockReturnValue(fakeClient());

    await useCodingAgentStore.getState().attachSession(START);

    // The rotation needs no delivery to that frozen pair: its next turn asks the app for inference, and the app reads
    // the vault then.
    expect(rotate).toHaveBeenCalledWith("anthropic");
  });

  it("arms a renewal the closed app could not have left behind", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: true, expiresAt: NOW + 2 * TEN_MINUTES, accessToken: "rotated-2" },
    );
    const client = fakeClient();
    createPiBridgeClient.mockReturnValue(client);

    await useCodingAgentStore.getState().attachSession(START);
    expect(rotate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS + 1_000);

    expect(rotate).toHaveBeenCalledTimes(2);
  });

  it("carries a session whose sign-in is beyond renewal rather than refusing it", async () => {
    answerRotationWith({ refreshed: false, mustSignInAgain: true, reason: "invalid_grant" });
    const client = fakeClient();
    createPiBridgeClient.mockReturnValue(client);

    await useCodingAgentStore.getState().attachSession(START);

    // Unlike start, there is already a conversation here and it is worth reading — so it says so and attaches.
    expect(Notification.show).toHaveBeenCalled();
    expect(client.connect).toHaveBeenCalled();
    expect(useCodingAgentStore.getState().status).not.toBe("error");
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

  it("renews a token that lapses mid-session, without carrying it anywhere", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: true, expiresAt: NOW + 2 * TEN_MINUTES, accessToken: "rotated-2" },
    );
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);

    // Storing it IS delivering it: the app resolves the credential from the vault on every inference request, so the
    // running session's next turn signs with this one and nothing had to be pushed into a container.
    expect(rotate).toHaveBeenCalledTimes(2);
  });

  // An exchange that neither renewed nor reported the sign-in spent failed transiently — a busy engine, a blinked
  // network. Dropping the chain there costs EVERY renewal after it, and the session 401s once the token lapses.
  it("keeps renewing after an exchange fails transiently", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: false, reason: "no connected container engine" },
      { refreshed: true, expiresAt: NOW + 3 * TEN_MINUTES, accessToken: "rotated-3" },
    );
    await useCodingAgentStore.getState().start(START);

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);
    expect(rotate).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RENEWAL_RETRY_MS);
    expect(rotate).toHaveBeenCalledTimes(3);
  });

  // Bounded, or a provider that keeps refusing spins a login container for as long as the session runs.
  it("gives up and says so after a run of failed exchanges", async () => {
    const rotate = answerRotationWith(
      { refreshed: true, expiresAt: NOW + TEN_MINUTES, accessToken: "rotated-1" },
      { refreshed: false, reason: "no connected container engine" },
    );
    await useCodingAgentStore.getState().start(START);
    (Notification.show as ReturnType<typeof vi.fn>).mockClear();

    await vi.advanceTimersByTimeAsync(TEN_MINUTES - RENEWAL_MARGIN_MS);
    for (let attempt = 0; attempt < RENEWAL_RETRY_LIMIT; attempt += 1) {
      await vi.advanceTimersByTimeAsync(RENEWAL_RETRY_MS);
    }

    expect(rotate).toHaveBeenCalledTimes(1 + RENEWAL_RETRY_LIMIT);
    expect(Notification.show).toHaveBeenCalled();
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
