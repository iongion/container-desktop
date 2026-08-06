import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PiBridgeClient } from "@/ai-system/adapters/piBridgeClient";
import { emptyPiSessionView } from "@/ai-system/core/piSessionView";
import type { ProviderProxyRequest } from "@/pi-bridge/protocol";
import { useCodingAgentStore } from "@/web-app/stores/codingAgent";

// The renderer's part in a turn's inference: it carries the session's request to the app, and the app's answer back to
// the session. Both halves are somebody else's — the container performs the HTTP, the app resolves the key natively —
// so what is covered here is the routing, and what happens when it cannot be done.

const REQUEST: ProviderProxyRequest = {
  requestId: "pv-1",
  method: "POST",
  path: "/v1/chat/completions",
  headers: { "content-type": "application/json" },
  body: btoa('{"model":"m"}'),
};

function fakeClient() {
  return { providerStream: vi.fn(async () => {}), close: vi.fn() } as unknown as PiBridgeClient;
}

describe("useCodingAgentStore inference routing", () => {
  let runProviderRequest = vi.fn(async () => ({ ok: true as const }));
  let cancelProviderRequest = vi.fn(async () => ({ ok: true as const }));

  beforeEach(() => {
    runProviderRequest = vi.fn(async () => ({ ok: true as const }));
    cancelProviderRequest = vi.fn(async () => ({ ok: true as const }));
    (globalThis as { window?: unknown }).window = {
      AI: { runProviderRequest, cancelProviderRequest },
      AIBus: { subscribe: vi.fn(() => () => {}) },
    };
    useCodingAgentStore.setState({ client: fakeClient(), view: emptyPiSessionView("pi-session") });
  });

  afterEach(() => {
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = undefined;
  });

  it("hands a request the session made to the app, exactly as it arrived", () => {
    useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_request", request: REQUEST });
    expect(runProviderRequest).toHaveBeenCalledWith(REQUEST);
  });

  // Inference is not something the model said. A frame that reached the transcript would render as an empty turn.
  it("puts nothing in the transcript", () => {
    useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_request", request: REQUEST });
    useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_cancel", requestId: "pv-1" });
    expect(useCodingAgentStore.getState().view.timeline).toEqual([]);
  });

  it("passes a cancelled turn on, so the app stops pulling from the provider", () => {
    useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_cancel", requestId: "pv-1" });
    expect(cancelProviderRequest).toHaveBeenCalledWith("pv-1");
  });

  // The invoke settles on ACCEPTANCE, so a rejection means the request never started — and pi is blocked inside its own
  // provider client. The refusal has to travel back as the answer, or the turn simply stops receiving bytes.
  it("answers the session with the refusal when the app will not take the request", async () => {
    runProviderRequest.mockRejectedValueOnce(new Error("no credential stored for this provider"));

    useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_request", request: REQUEST });
    await vi.waitFor(() =>
      expect(useCodingAgentStore.getState().client?.providerStream).toHaveBeenCalledWith("pv-1", {
        kind: "error",
        message: "no credential stored for this provider",
      }),
    );
  });

  // A cancel is best-effort: the session has already stopped listening, and a failure here must not take the turn's
  // own error path with it.
  it("survives a cancel the app could not perform", async () => {
    cancelProviderRequest.mockRejectedValueOnce(new Error("gone"));
    expect(() =>
      useCodingAgentStore.getState().applyBridgeEvent({ type: "provider_cancel", requestId: "pv-1" }),
    ).not.toThrow();
    await vi.waitFor(() => expect(cancelProviderRequest).toHaveBeenCalled());
  });
});
