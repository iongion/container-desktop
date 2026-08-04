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

  // Plugin management needs answers, not fire-and-forget: the table renders what the container reports and an
  // install that failed has to say so.
  async function connectedClient() {
    const { socket, sent } = fakeSocket();
    const client = createPiBridgeClient({ url: "ws://127.0.0.1:1/", token: "tok", socketFactory: () => socket });
    const connected = client.connect();
    socket.onopen?.();
    socket.onmessage?.({ data: READY });
    await connected;
    sent.length = 0;
    return { socket, sent, client };
  }

  const lastId = (sent: string[]) => JSON.parse(sent.at(-1) as string).id as string;

  it("resolves listPlugins with the result of the matching response", async () => {
    const { socket, sent, client } = await connectedClient();
    const payload = client.listPlugins();
    const configured = [{ source: "npm:@foo/bar", scope: "user" as const, filtered: false }];
    socket.onmessage?.({
      data: encodeEvent({ type: "response", id: lastId(sent), success: true, result: { configured } }),
    });
    await expect(payload).resolves.toEqual({ configured });
  });

  it("rejects a request whose response reports a failure", async () => {
    const { socket, sent, client } = await connectedClient();
    const install = client.installPlugin("npm:@foo/bar", "user");
    socket.onmessage?.({
      data: encodeEvent({ type: "response", id: lastId(sent), success: false, error: "registry down" }),
    });
    await expect(install).rejects.toThrow("registry down");
  });

  it("leaves a request pending when another command is answered", async () => {
    const { socket, sent, client } = await connectedClient();
    const settled: string[] = [];
    void client.listResources().then(() => settled.push("resources"));
    socket.onmessage?.({ data: encodeEvent({ type: "response", id: "someone-else", success: true }) });
    await Promise.resolve();
    expect(settled).toEqual([]);
    socket.onmessage?.({ data: encodeEvent({ type: "response", id: lastId(sent), success: true, result: {} }) });
    await Promise.resolve();
    expect(settled).toEqual(["resources"]);
  });

  it("fails an in-flight request when the bridge closes", async () => {
    const { socket, client } = await connectedClient();
    const install = client.installPlugin("npm:@foo/bar", "user");
    socket.onclose?.();
    await expect(install).rejects.toThrow(/closed/i);
  });

  it("fails an in-flight request when the session is stopped", async () => {
    const { client } = await connectedClient();
    const install = client.installPlugin("npm:@foo/bar", "user");
    client.close();
    await expect(install).rejects.toThrow(/stopped/i);
  });

  it("sends plugins_update with no source when updating everything", async () => {
    const { sent, client } = await connectedClient();
    void client.updatePlugins();
    expect(JSON.parse(sent.at(-1) as string)).toEqual({ id: expect.any(String), type: "plugins_update" });
  });

  // A lost project context is the defect this carries: the agent would answer without the user's rules and
  // nothing would say so. It is a request, not fire-and-forget, so a failure can be reported.
  it("sends the project context as a request the caller can see fail", async () => {
    const { socket, sent, client } = await connectedClient();
    const published = client.setSystemContext("## rules\n\nbe terse");
    expect(JSON.parse(sent.at(-1) as string)).toMatchObject({
      type: "set_system_context",
      text: "## rules\n\nbe terse",
    });
    socket.onmessage?.({ data: encodeEvent({ type: "response", id: lastId(sent), success: false, error: "gone" }) });
    await expect(published).rejects.toThrow("gone");
  });

  it("refuses a request before the bridge is connected", async () => {
    const client = createPiBridgeClient({
      url: "ws://127.0.0.1:1/",
      token: "tok",
      socketFactory: () => fakeSocket().socket,
    });
    await expect(client.listPlugins()).rejects.toThrow(/not connected/i);
  });
});
