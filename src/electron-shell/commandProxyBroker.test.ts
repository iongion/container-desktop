import { describe, expect, it } from "vitest";

import { COMMAND_PROXY } from "@/container-client/commandProxyProtocol";
import { CommandProxyBroker } from "./commandProxyBroker";

function makeEmitter() {
  const listeners: Record<string, (arg?: any) => void> = {};
  let destroyed = false;
  return {
    on(event: string, listener: (arg?: any) => void) {
      listeners[event] = listener;
      return this;
    },
    emit(event: string, arg?: any) {
      listeners[event]?.(arg);
    },
    destroy() {
      destroyed = true;
    },
    get destroyed() {
      return destroyed;
    },
  };
}

function makeDeps(driver: { request: (config: any) => Promise<any> }) {
  const invokeHandlers = new Map<string, (event: any, payload: any) => unknown>();
  const messageHandlers = new Map<string, (event: any, payload: any) => void>();
  const sent: Array<{ channel: string; payload: any }> = [];
  let ensured = 0;
  return {
    ensureConnected: async () => {
      ensured += 1;
    },
    getDriver: async () => driver,
    onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => invokeHandlers.set(channel, handler),
    onMessage: (channel: string, handler: (event: any, payload: any) => void) => messageHandlers.set(channel, handler),
    send: (_event: any, channel: string, payload: unknown) => sent.push({ channel, payload }),
    isAllowedSender: (event: any) => event?.allowed === true,
    senderId: (event: any) => event?.id ?? 1,
    _invoke: (channel: string, event: any, payload?: any) => invokeHandlers.get(channel)?.(event, payload),
    _message: (channel: string, event: any, payload?: any) => messageHandlers.get(channel)?.(event, payload),
    _sent: () => sent,
    _ensured: () => ensured,
  };
}

const ALLOWED = { allowed: true, id: 7 };

describe("CommandProxyBroker", () => {
  it("rejects an unauthorized sender without touching the engine", async () => {
    const deps = makeDeps({ request: async () => ({ status: 200, data: [] }) });
    new CommandProxyBroker(deps).register();
    const result: any = await deps._invoke(COMMAND_PROXY.request, { allowed: false }, { req: { url: "/x" } });
    expect(result).toMatchObject({ stream: false, ok: false });
    expect(deps._ensured()).toBe(0);
  });

  it("connects then forwards a non-stream request and returns the response", async () => {
    const deps = makeDeps({
      request: async () => ({
        status: 200,
        statusText: "OK",
        data: [{ Id: "a" }],
        headers: { "content-type": "json" },
      }),
    });
    new CommandProxyBroker(deps).register();
    const result: any = await deps._invoke(COMMAND_PROXY.request, ALLOWED, { req: { url: "/containers/json" } });
    expect(deps._ensured()).toBe(1);
    expect(result).toMatchObject({ stream: false, ok: true, status: 200, data: [{ Id: "a" }] });
  });

  it("carries an engine error response (non-2xx) so the renderer can rebuild it", async () => {
    const deps = makeDeps({
      request: async () => {
        const error: any = new Error("Request failed");
        error.response = { status: 404, statusText: "Not Found", data: { message: "no such container" }, headers: {} };
        throw error;
      },
    });
    new CommandProxyBroker(deps).register();
    const result: any = await deps._invoke(COMMAND_PROXY.request, ALLOWED, { req: { url: "/containers/x/json" } });
    expect(result).toMatchObject({ stream: false, ok: false, status: 404, data: { message: "no such container" } });
  });

  it("bridges a stream: opens it and forwards chunks + end to the requesting window", async () => {
    const emitter = makeEmitter();
    const deps = makeDeps({ request: async () => ({ status: 200, data: emitter, headers: {} }) });
    new CommandProxyBroker(deps).register();
    const handle: any = await deps._invoke(COMMAND_PROXY.request, ALLOWED, {
      req: { url: "/containers/x/logs", responseType: "stream" },
    });
    expect(handle).toMatchObject({ stream: true, status: 200 });
    expect(typeof handle.streamId).toBe("string");
    emitter.emit("data", "line-1");
    emitter.emit("end");
    const events = deps._sent().filter((entry) => entry.channel === COMMAND_PROXY.streamEvent);
    expect(events.map((entry) => entry.payload.type)).toEqual(["data", "end"]);
    expect(events[0].payload.payload).toBe("line-1");
    expect(events[0].payload.streamId).toBe(handle.streamId);
  });

  it("tears a stream down on destroy", async () => {
    const emitter = makeEmitter();
    const deps = makeDeps({ request: async () => ({ status: 200, data: emitter, headers: {} }) });
    new CommandProxyBroker(deps).register();
    const handle: any = await deps._invoke(COMMAND_PROXY.request, ALLOWED, { req: { responseType: "stream" } });
    deps._message(COMMAND_PROXY.streamDestroy, ALLOWED, { streamId: handle.streamId });
    expect(emitter.destroyed).toBe(true);
  });

  it("reaps a sender's streams when its window closes", async () => {
    const emitter = makeEmitter();
    const deps = makeDeps({ request: async () => ({ status: 200, data: emitter, headers: {} }) });
    const broker = new CommandProxyBroker(deps);
    broker.register();
    await deps._invoke(COMMAND_PROXY.request, ALLOWED, { req: { responseType: "stream" } });
    broker.disposeForSender(ALLOWED.id);
    expect(emitter.destroyed).toBe(true);
  });
});
