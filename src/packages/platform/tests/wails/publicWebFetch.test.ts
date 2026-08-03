import { describe, expect, it, vi } from "vitest";
import { createWailsPublicWebFetch } from "@/platform/wails/publicWebFetch";

function fakeChannel() {
  return { onmessage: null as ((m: unknown) => void) | null, close: vi.fn() };
}

describe("createWailsPublicWebFetch", () => {
  it("invokes the pinned service and streams a Response from channel frames", async () => {
    const channel = fakeChannel();
    // The WailsChannel decodes base64 binary frames to a Uint8Array before onmessage; the Go service emits body
    // bytes as binary frames and end/error as JSON control events.
    const invoke = vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === "public_web_fetch_request") {
        queueMicrotask(() => {
          channel.onmessage?.(new TextEncoder().encode("hi"));
          channel.onmessage?.({ streamId: "web-1", type: "end" });
        });
        return { streamId: "web-1", status: 200, statusText: "OK", headers: { "content-type": "text/plain" } };
      }
      return undefined;
    });
    const fetchResolved = createWailsPublicWebFetch({ invoke: invoke as never, newChannel: () => channel });

    const res = await fetchResolved("https://example.com", ["1.1.1.1"], { method: "GET", redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hi");
    const [, args] = invoke.mock.calls.find(([c]) => c === "public_web_fetch_request")!;
    expect((args as { payload: { addresses: string[] } }).payload.addresses).toEqual(["1.1.1.1"]);
  });

  it("rejects the Response when the native side sends an error frame", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async () => {
      queueMicrotask(() => channel.onmessage?.({ streamId: "web-2", type: "error", payload: { message: "boom" } }));
      return { streamId: "web-2", status: 200, statusText: "OK", headers: {} };
    });
    const fetchResolved = createWailsPublicWebFetch({ invoke: invoke as never, newChannel: () => channel });
    const res = await fetchResolved("https://example.com", ["1.1.1.1"], { method: "GET" });
    await expect(res.text()).rejects.toThrow(/boom/);
  });
});
