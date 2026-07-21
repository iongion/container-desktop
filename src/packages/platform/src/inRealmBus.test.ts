import { describe, expect, it, vi } from "vitest";
import { createInRealmBus } from "./inRealmBus";

describe("createInRealmBus", () => {
  it("routes invoke and message handlers through the local sender", () => {
    const bus = createInRealmBus();
    const invoke = vi.fn((_event, payload) => `got:${payload}`);
    const message = vi.fn();
    bus.onInvoke("invoke", invoke);
    bus.onMessage("message", message);

    expect(bus.invoke("invoke", "x")).toBe("got:x");
    bus.send("message", { n: 1 });
    expect(invoke).toHaveBeenCalledWith({ local: true }, "x");
    expect(message).toHaveBeenCalledWith({ local: true }, { n: 1 });
    expect(bus.isAllowedSender()).toBe(true);
    expect(bus.senderId()).toBe(1);
  });

  it("fans out safely, unsubscribes, and clears every registration", () => {
    const bus = createInRealmBus();
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bus.subscribe("push", bad);
    const unsubscribe = bus.subscribe("push", good);
    bus.onInvoke("invoke", vi.fn());

    expect(() => bus.dispatch("push", "one")).not.toThrow();
    expect(good).toHaveBeenCalledWith("one");
    unsubscribe();
    bus.dispatch("push", "two");
    expect(good).toHaveBeenCalledOnce();
    expect(bus.handles("invoke")).toBe(true);
    bus.clear();
    expect(bus.handles("invoke")).toBe(false);
  });
});
