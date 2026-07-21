import { describe, expect, it, vi } from "vitest";
import type { ProviderTransportRequest } from "@/ai-system/core/types";
import { createTauriProviderTransport } from "./providerTransport";

function request(overrides: Partial<ProviderTransportRequest> = {}): ProviderTransportRequest {
  return {
    credential: {
      providerId: "openai",
      providerKind: "openai",
      origin: "https://api.openai.com",
      auth: { scheme: "bearer" },
    },
    url: "https://api.openai.com/v1/chat",
    method: "POST",
    headers: { "content-type": "application/json" },
    timeoutMs: 300000,
    maxResponseBytes: 8 * 1024 * 1024,
    ...overrides,
  };
}

function fakeChannel() {
  return { onmessage: null as ((message: unknown) => void) | null };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return out;
    out += new TextDecoder().decode(chunk.value);
  }
}

describe("createTauriProviderTransport", () => {
  it("never sends a secret to the native side and streams raw bytes back", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "provider_transport_request") return undefined;
      // The payload must carry a credential reference only.
      expect(JSON.stringify(args)).not.toContain("sk-");
      queueMicrotask(() => {
        channel.onmessage?.(new TextEncoder().encode("hel").buffer);
        channel.onmessage?.(new TextEncoder().encode("lo").buffer);
        channel.onmessage?.({ streamId: "ai-1", type: "end" });
      });
      return { streamId: "ai-1", status: 200, statusText: "OK", headers: { "content-type": "text/event-stream" } };
    });

    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    const response = await transport.request(request(), new AbortController().signal);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("text/event-stream");
    expect(await readAll(response.body as ReadableStream<Uint8Array>)).toBe("hello");
  });

  it("tears the native stream down when the caller aborts", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string) =>
      command === "provider_transport_request"
        ? { streamId: "ai-7", status: 200, statusText: "OK", headers: {} }
        : undefined,
    );
    const controller = new AbortController();
    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    await transport.request(request(), controller.signal);

    controller.abort();
    await new Promise((r) => setTimeout(r, 0));
    expect(invoke).toHaveBeenCalledWith("provider_transport_destroy", { streamId: "ai-7" });
  });

  it("fails the stream when the response exceeds maxResponseBytes", async () => {
    const channel = fakeChannel();
    const invoke = vi.fn(async (command: string) => {
      if (command !== "provider_transport_request") return undefined;
      queueMicrotask(() => channel.onmessage?.(new Uint8Array(64).buffer));
      return { streamId: "ai-2", status: 200, statusText: "OK", headers: {} };
    });
    const transport = createTauriProviderTransport({ invoke: invoke as never, newChannel: () => channel });
    const response = await transport.request(request({ maxResponseBytes: 16 }), new AbortController().signal);
    await expect(readAll(response.body as ReadableStream<Uint8Array>)).rejects.toThrow(/too large/);
  });
});
