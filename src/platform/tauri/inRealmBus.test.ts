import { describe, expect, it, vi } from "vitest";

import { createInRealmBus } from "./inRealmBus";

describe("createInRealmBus", () => {
  it("routes invoke() to the registered invoke handler with the LOCAL_EVENT sentinel", () => {
    const bus = createInRealmBus();
    const handler = vi.fn((_event, payload) => `got:${payload}`);
    bus.onInvoke("ch.a", handler);
    expect(bus.invoke("ch.a", "x")).toBe("got:x");
    // A single trusted webview: the handler is called with an event object (never a renderer's).
    expect(handler.mock.calls[0][0]).toEqual({ local: true });
    expect(bus.isAllowedSender()).toBe(true);
    expect(bus.senderId()).toBe(1);
  });

  it("routes send() to the registered message handler; unknown channels are inert", () => {
    const bus = createInRealmBus();
    const handler = vi.fn();
    bus.onMessage("ch.msg", handler);
    bus.send("ch.msg", { n: 1 });
    expect(handler).toHaveBeenCalledWith({ local: true }, { n: 1 });
    expect(() => bus.send("ch.unknown", {})).not.toThrow();
    expect(bus.invoke("ch.unknown")).toBeUndefined();
  });

  it("dispatch() fans out to every subscriber; unsubscribe stops delivery", () => {
    const bus = createInRealmBus();
    const a = vi.fn();
    const b = vi.fn();
    const offA = bus.subscribe("push", a);
    bus.subscribe("push", b);
    bus.dispatch("push", "one");
    expect(a).toHaveBeenCalledWith("one");
    expect(b).toHaveBeenCalledWith("one");
    offA();
    bus.dispatch("push", "two");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("a throwing subscriber never breaks delivery to the others", () => {
    const bus = createInRealmBus();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bus.subscribe("push", bad);
    bus.subscribe("push", good);
    expect(() => bus.dispatch("push", "x")).not.toThrow();
    expect(good).toHaveBeenCalledWith("x");
  });

  it("handles() reflects registered channels; clear() tears everything down", () => {
    const bus = createInRealmBus();
    bus.onInvoke("i", vi.fn());
    bus.onMessage("m", vi.fn());
    const sub = vi.fn();
    bus.subscribe("p", sub);
    expect(bus.handles("i")).toBe(true);
    expect(bus.handles("m")).toBe(true);
    expect(bus.handles("nope")).toBe(false);
    bus.clear();
    expect(bus.handles("i")).toBe(false);
    bus.dispatch("p", "after-clear");
    expect(sub).not.toHaveBeenCalled();
  });
});
