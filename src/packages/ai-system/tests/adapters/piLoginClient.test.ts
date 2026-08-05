import { describe, expect, it, vi } from "vitest";
import type { WebSocketLike } from "@/ai-system/adapters/piBridgeClient";
import { createPiLoginClient } from "@/ai-system/adapters/piLoginClient";
import { encodeEvent } from "@/pi-bridge/codec";

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

function connected() {
  const { socket, sent } = fakeSocket();
  const client = createPiLoginClient({
    url: "ws://127.0.0.1:1/",
    token: "tok",
    socketFactory: () => socket,
    connectRetry: { attempts: 1, delayMs: 0 },
  });
  const ready = client.connect();
  socket.onopen?.();
  const hello = JSON.parse(sent[0]) as { id: string };
  socket.onmessage?.({ data: encodeEvent({ type: "response", id: hello.id, success: true }) });
  return { client, socket, sent, ready };
}

describe("createPiLoginClient", () => {
  // A login container announces nothing — no session, no cwd, no model — so the handshake's own response is the
  // only honest signal that the peer is authenticated.
  it("resolves connect on the handshake response, not on a session announcement", async () => {
    const { ready, sent } = connected();
    await expect(ready).resolves.toBeUndefined();
    expect(JSON.parse(sent[0])).toMatchObject({ type: "hello", token: "tok", protocolVersion: 1 });
  });

  it("rejects connect when the container refuses the token", async () => {
    const { socket, sent } = fakeSocket();
    const client = createPiLoginClient({
      url: "ws://127.0.0.1:1/",
      token: "wrong",
      socketFactory: () => socket,
      connectRetry: { attempts: 1, delayMs: 0 },
    });
    const ready = client.connect();
    socket.onopen?.();
    const hello = JSON.parse(sent[0]) as { id: string };
    socket.onmessage?.({
      data: encodeEvent({ type: "response", id: hello.id, success: false, error: "unauthorized" }),
    });
    await expect(ready).rejects.toThrow(/unauthorized/);
  });

  it("carries the login outcome back as a value", async () => {
    const { client, socket, sent, ready } = connected();
    await ready;
    const outcome = client.login("openrouter");
    const request = JSON.parse(sent[1]) as { id: string; type: string; provider: string };
    expect(request).toMatchObject({ type: "auth_login", provider: "openrouter" });
    socket.onmessage?.({
      data: encodeEvent({
        type: "response",
        id: request.id,
        success: true,
        result: { ok: true, credential: { access: "sk-or-v1", refresh: "", expires: Number.MAX_SAFE_INTEGER } },
      }),
    });
    await expect(outcome).resolves.toEqual({
      ok: true,
      credential: { access: "sk-or-v1", refresh: "", expires: Number.MAX_SAFE_INTEGER },
    });
  });

  it("fans out the flow's prompts, its withdrawals and its progress", async () => {
    const { client, socket, ready } = connected();
    await ready;
    const seen: string[] = [];
    client.onEvent((event) => seen.push(event.type));
    socket.onmessage?.({
      data: encodeEvent({ type: "auth_prompt", promptId: "p1", prompt: { type: "manual_code", message: "paste" } }),
    });
    socket.onmessage?.({
      data: encodeEvent({ type: "auth_event", event: { type: "progress", message: "listening" } }),
    });
    socket.onmessage?.({ data: encodeEvent({ type: "auth_prompt_closed", promptId: "p1" }) });
    expect(seen).toEqual(["auth_prompt", "auth_event", "auth_prompt_closed"]);
  });

  it("answers a prompt by its own id, so a late answer cannot settle the next question", async () => {
    const { client, sent, ready } = connected();
    await ready;
    client.answerPrompt("p1", true, "https://openrouter.ai/callback?code=abc");
    expect(JSON.parse(sent[1])).toMatchObject({
      type: "auth_prompt_answer",
      promptId: "p1",
      ok: true,
      value: "https://openrouter.ai/callback?code=abc",
    });
    client.answerPrompt("p2", false);
    expect(JSON.parse(sent[2])).toMatchObject({ type: "auth_prompt_answer", promptId: "p2", ok: false });
  });

  it("fails a login in flight when the container's socket dies", async () => {
    const { client, socket, ready } = connected();
    await ready;
    const outcome = client.login("openrouter");
    socket.onclose?.();
    await expect(outcome).rejects.toThrow(/closed the connection/);
  });
});
