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
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    socket.onclose?.();
    await expect(connected).rejects.toThrow(/closed/i);
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
});
