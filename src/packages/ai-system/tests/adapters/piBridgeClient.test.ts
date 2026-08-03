import { describe, expect, it, vi } from "vitest";

import { createPiBridgeClient, type WebSocketLike } from "@/ai-system/adapters/piBridgeClient";
import { encodeEvent } from "@/pi-bridge/codec";
import type { BridgeEvent } from "@/pi-bridge/protocol";

function fakeSocket() {
  const sent: string[] = [];
  const socket: WebSocketLike = {
    send: (data) => sent.push(data),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return { socket, sent };
}

const READY = encodeEvent({ type: "ready", protocolVersion: 1, sessionId: "s1", cwd: "/workspace" });

describe("createPiBridgeClient", () => {
  it("sends hello on open and resolves connect on ready", async () => {
    const { socket, sent } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    expect(JSON.parse(sent[0])).toMatchObject({ type: "hello", token: "tok", protocolVersion: 1 });
    socket.onmessage?.({ data: READY });
    await expect(connected).resolves.toBeUndefined();
  });

  it("rejects connect when the socket closes before ready", async () => {
    const { socket } = fakeSocket();
    const client = createPiBridgeClient({
      url: "ws://127.0.0.1:1/",
      token: "tok",
      socketFactory: () => socket,
      connectRetry: { attempts: 1, delayMs: 0 },
    });
    const connected = client.connect();
    socket.onopen?.();
    socket.onclose?.();
    await expect(connected).rejects.toThrow(/closed/i);
  });

  // The container's bridge binds its port a few hundred milliseconds after `podman run --detach` returns, so
  // a single-shot connect loses the race and the whole session start fails. Measured: the first attempt is
  // reset, the next one 250ms later is accepted.
  it("retries a connection that is refused before the container's bridge is listening", async () => {
    const sockets = [fakeSocket(), fakeSocket()];
    let created = 0;
    const client = createPiBridgeClient({
      url: "ws://127.0.0.1:1/",
      token: "tok",
      socketFactory: () => sockets[created++].socket,
      connectRetry: { attempts: 5, delayMs: 1 },
    });
    const connected = client.connect();
    sockets[0].socket.onerror?.(new Error("ECONNRESET"));
    await vi.waitFor(() => expect(created).toBe(2));
    sockets[1].socket.onopen?.();
    sockets[1].socket.onmessage?.({ data: READY });
    await expect(connected).resolves.toBeUndefined();
    expect(JSON.parse(sockets[1].sent[0])).toMatchObject({ type: "hello" });
  });

  it("gives up after the configured number of attempts", async () => {
    let created = 0;
    const client = createPiBridgeClient({
      url: "ws://127.0.0.1:1/",
      token: "tok",
      socketFactory: () => {
        created += 1;
        const { socket } = fakeSocket();
        setTimeout(() => socket.onerror?.(new Error("ECONNRESET")), 0);
        return socket;
      },
      connectRetry: { attempts: 3, delayMs: 1 },
    });
    await expect(client.connect()).rejects.toThrow(/socket error/i);
    expect(created).toBe(3);
  });

  it("does not reconnect when the socket drops after it was ready", async () => {
    let created = 0;
    const { socket } = fakeSocket();
    const client = createPiBridgeClient({
      url: "ws://127.0.0.1:1/",
      token: "tok",
      socketFactory: () => {
        created += 1;
        return socket;
      },
      connectRetry: { attempts: 5, delayMs: 1 },
    });
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    socket.onclose?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(created).toBe(1);
  });

  it("forwards decoded events to listeners and stops after unsubscribe", async () => {
    const { socket } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const seen: BridgeEvent[] = [];
    const unsubscribe = client.onEvent((event) => seen.push(event));
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    socket.onmessage?.({ data: encodeEvent({ type: "assistant_delta", text: "hi" }) });
    unsubscribe();
    socket.onmessage?.({ data: encodeEvent({ type: "assistant_delta", text: "ignored" }) });
    expect(seen.filter((event) => event.type === "assistant_delta")).toHaveLength(1);
  });

  it("surfaces an undecodable frame as an error event rather than throwing", async () => {
    const { socket } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const seen: BridgeEvent[] = [];
    client.onEvent((event) => seen.push(event));
    client.connect().catch(() => {});
    socket.onopen?.();
    expect(() => socket.onmessage?.({ data: "{not json" })).not.toThrow();
    expect(seen.at(-1)).toMatchObject({ type: "error" });
  });

  it("keeps one bad subscriber from stopping the stream for the others", async () => {
    const { socket } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const seen: BridgeEvent[] = [];
    client.onEvent(() => {
      throw new Error("bad subscriber");
    });
    client.onEvent((event) => seen.push(event));
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    expect(seen.some((event) => event.type === "ready")).toBe(true);
  });

  it("sends a prompt command with a unique id", async () => {
    const { socket, sent } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    await client.prompt("hello");
    const promptFrame = JSON.parse(sent.at(-1) as string);
    expect(promptFrame).toMatchObject({ type: "prompt", text: "hello" });
    expect(typeof promptFrame.id).toBe("string");
  });

  it("answers a host request with a host_response carrying the same request id", async () => {
    const { socket, sent } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    await client.respond("r1", { ok: true, value: { allow: true } });
    expect(JSON.parse(sent.at(-1) as string)).toMatchObject({
      type: "host_response",
      requestId: "r1",
      ok: true,
      value: { allow: true },
    });
  });

  it("carries a refusal reason back to the container", async () => {
    const { socket, sent } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    await client.respond("r2", { ok: false, error: "dismissed" });
    expect(JSON.parse(sent.at(-1) as string)).toMatchObject({ type: "host_response", ok: false, error: "dismissed" });
  });
});
