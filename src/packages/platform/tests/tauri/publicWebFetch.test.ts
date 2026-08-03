import { describe, expect, it, vi } from "vitest";
import { createTauriPublicWebFetch } from "@/platform/tauri/publicWebFetch";

function fakeChannel() {
  const channel: { onmessage: ((m: unknown) => void) | null } = { onmessage: null };
  return channel;
}

describe("createTauriPublicWebFetch", () => {
  it("invokes the pinned command with url/addresses/method/headers and streams a Response", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
      if (cmd === "public_web_fetch_request") {
        queueMicrotask(() => {
          channel.onmessage?.(new TextEncoder().encode("hello").buffer);
          channel.onmessage?.({ type: "end" });
        });
        return { streamId: "web-1", status: 200, statusText: "OK", headers: { "content-type": "text/plain" } };
      }
      return undefined;
    });
    const fetchResolved = createTauriPublicWebFetch({ invoke: invoke as never, newChannel: () => channel });

    const res = await fetchResolved("https://example.com", ["1.1.1.1"], { method: "GET", redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("hello");
    const [, args] = invoke.mock.calls.find(([c]) => c === "public_web_fetch_request")!;
    expect((args as { payload: { url: string; addresses: string[] } }).payload.url).toBe("https://example.com");
    expect((args as { payload: { addresses: string[] } }).payload.addresses).toEqual(["1.1.1.1"]);
  });

  it("rejects the Response when the native side sends an error frame", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async () => {
      queueMicrotask(() => channel.onmessage?.({ type: "error", payload: { message: "boom" } }));
      return { streamId: "web-2", status: 200, statusText: "OK", headers: {} };
    });
    const fetchResolved = createTauriPublicWebFetch({ invoke: invoke as never, newChannel: () => channel });
    const res = await fetchResolved("https://example.com", ["1.1.1.1"], { method: "GET" });
    await expect(res.text()).rejects.toThrow(/boom/);
  });
});
