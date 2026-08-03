import { describe, expect, it, vi } from "vitest";

import { createHostRpc } from "@/pi-agent-host/hostRpc";
import type { BridgeEvent } from "@/pi-bridge/protocol";

describe("createHostRpc", () => {
  it("emits a host_request and resolves with the matching response value", async () => {
    const emitted: BridgeEvent[] = [];
    const rpc = createHostRpc((event) => emitted.push(event));
    const pending = rpc.request<boolean>("confirm", { title: "Allow?" });
    const request = emitted[0] as Extract<BridgeEvent, { type: "host_request" }>;
    expect(request.method).toBe("confirm");
    rpc.settle(request.requestId, { ok: true, value: true });
    await expect(pending).resolves.toBe(true);
  });

  it("gives every request a distinct id and settles them independently", async () => {
    const emitted: BridgeEvent[] = [];
    const rpc = createHostRpc((event) => emitted.push(event));
    const first = rpc.request<string>("input", { title: "one" });
    const second = rpc.request<string>("input", { title: "two" });
    const ids = emitted.map((event) => (event as { requestId: string }).requestId);
    expect(new Set(ids).size).toBe(2);
    rpc.settle(ids[1], { ok: true, value: "second" });
    rpc.settle(ids[0], { ok: true, value: "first" });
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("resolves with the fallback when the app reports failure", async () => {
    const emitted: BridgeEvent[] = [];
    const rpc = createHostRpc((event) => emitted.push(event));
    const pending = rpc.request<boolean>("confirm", {}, { fallback: false });
    rpc.settle((emitted[0] as { requestId: string }).requestId, { ok: false, error: "dismissed" });
    await expect(pending).resolves.toBe(false);
  });

  it("resolves with the fallback on timeout without leaking the pending entry", async () => {
    vi.useFakeTimers();
    try {
      const rpc = createHostRpc(() => {});
      const pending = rpc.request<boolean>("confirm", {}, { timeoutMs: 1000, fallback: false });
      vi.advanceTimersByTime(1001);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves with the fallback when the caller's signal aborts", async () => {
    const controller = new AbortController();
    const rpc = createHostRpc(() => {});
    const pending = rpc.request<boolean>("confirm", {}, { fallback: false, signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toBe(false);
  });

  it("resolves immediately when the signal is already aborted", async () => {
    const rpc = createHostRpc(() => {});
    const pending = rpc.request<string>("input", {}, { fallback: "none", signal: AbortSignal.abort() });
    await expect(pending).resolves.toBe("none");
  });

  it("ignores a response for an unknown request id", () => {
    const rpc = createHostRpc(() => {});
    expect(() => rpc.settle("ghost", { ok: true, value: 1 })).not.toThrow();
  });

  it("notify emits a host_request that never waits", () => {
    const emitted: BridgeEvent[] = [];
    const rpc = createHostRpc((event) => emitted.push(event));
    rpc.notify("setStatus", { statusKey: "k", statusText: "working" });
    expect(emitted).toHaveLength(1);
  });
});
