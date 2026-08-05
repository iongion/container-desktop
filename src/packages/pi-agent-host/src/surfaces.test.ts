import { describe, expect, it, vi } from "vitest";

import { createSurfaceRegistry } from "@/pi-agent-host/surfaces";
import type { BridgeEvent } from "@/pi-bridge/protocol";

const component = (lines: string[]) => ({ render: vi.fn(() => lines), handleInput: vi.fn(), invalidate: vi.fn() });

function registry(defaultColumns = 80) {
  const events: BridgeEvent[] = [];
  return { events, registry: createSurfaceRegistry({ emit: (event) => events.push(event), defaultColumns }) };
}

const frames = (events: BridgeEvent[]) => events.filter((event) => event.type === "surface_frame");

describe("createSurfaceRegistry", () => {
  it("emits a frame when a surface opens, rendering at the default width", () => {
    const { events, registry: r } = registry(100);
    const c = component(["hello"]);
    r.open({ kind: "footer" }, c as never);
    expect(c.render).toHaveBeenCalledWith(100);
    expect(events[0]).toMatchObject({ type: "surface_frame", lines: ["hello"], focus: false, overlay: false });
  });

  it("gives each surface a distinct id", () => {
    const { registry: r } = registry();
    const first = r.open({ kind: "header" }, component(["a"]) as never);
    const second = r.open({ kind: "footer" }, component(["b"]) as never);
    expect(first).not.toBe(second);
  });

  it("re-renders on demand and emits a fresh frame", () => {
    const { events, registry: r } = registry();
    const c = component(["one"]);
    const id = r.open({ kind: "footer" }, c as never);
    c.render.mockReturnValue(["two"]);
    r.rerender(id);
    expect(events.at(-1)).toMatchObject({ type: "surface_frame", lines: ["two"] });
  });

  it("forwards input to the component and re-renders after it", () => {
    const { events, registry: r } = registry();
    const c = component(["before"]);
    const id = r.open({ kind: "custom", surfaceId: "s1" }, c as never, { focus: true });
    c.render.mockReturnValue(["after"]);
    r.input(id, "q");
    expect(c.handleInput).toHaveBeenCalledWith("q");
    expect(events.at(-1)).toMatchObject({ lines: ["after"] });
  });

  it("re-renders at the new width on resize", () => {
    const { registry: r } = registry(80);
    const c = component(["x"]);
    const id = r.open({ kind: "footer" }, c as never);
    r.resize(id, 42);
    expect(c.render).toHaveBeenLastCalledWith(42);
  });

  it("emits surface_closed and ignores later input for that id", () => {
    const { events, registry: r } = registry();
    const c = component(["x"]);
    const id = r.open({ kind: "footer" }, c as never);
    r.close(id);
    expect(events.at(-1)).toEqual({ type: "surface_closed", surfaceId: id });
    r.input(id, "q");
    expect(c.handleInput).not.toHaveBeenCalled();
  });

  it("replaces the surface already occupying a slot instead of stacking", () => {
    const { events, registry: r } = registry();
    r.open({ kind: "footer" }, component(["first"]) as never);
    r.open({ kind: "footer" }, component(["second"]) as never);
    const closed = events.filter((event) => event.type === "surface_closed");
    expect(closed).toHaveLength(1);
  });

  it("closes a slot by identity, not by surface id", () => {
    const { events, registry: r } = registry();
    const id = r.open({ kind: "widget", widgetKey: "k" }, component(["x"]) as never);
    r.closeSlot({ kind: "widget", widgetKey: "k" });
    expect(events.at(-1)).toEqual({ type: "surface_closed", surfaceId: id });
  });

  it("survives a component whose render throws, reporting an error frame", () => {
    const { events, registry: r } = registry();
    const exploding = {
      render: () => {
        throw new Error("bad render");
      },
    };
    expect(() => r.open({ kind: "footer" }, exploding as never)).not.toThrow();
    expect((events.at(-1) as { lines: string[] }).lines.join(" ")).toContain("bad render");
  });

  it("survives a component whose handleInput throws and keeps the surface open", () => {
    const { registry: r } = registry();
    const c = {
      render: () => ["still here"],
      handleInput: () => {
        throw new Error("bad input");
      },
    };
    const id = r.open({ kind: "custom", surfaceId: "s1" }, c as never, { focus: true });
    expect(() => r.input(id, "q")).not.toThrow();
    expect(r.focusedSurfaceId()).toBe(id);
  });

  it("marks a focused overlay surface as both and carries its placement", () => {
    const { events, registry: r } = registry();
    r.open({ kind: "custom", surfaceId: "s1" }, component(["x"]) as never, {
      focus: true,
      overlay: true,
      placement: { anchor: "top-center", width: "50%" },
    });
    expect(events.at(-1)).toMatchObject({
      focus: true,
      overlay: true,
      placement: { anchor: "top-center", width: "50%" },
    });
  });

  it("reports the most recently focused surface and hands focus back when it closes", () => {
    const { registry: r } = registry();
    expect(r.focusedSurfaceId()).toBeUndefined();
    const first = r.open({ kind: "custom", surfaceId: "s1" }, component(["a"]) as never, { focus: true });
    const second = r.open({ kind: "custom", surfaceId: "s2" }, component(["b"]) as never, { focus: true });
    expect(r.focusedSurfaceId()).toBe(second);
    r.close(second);
    expect(r.focusedSurfaceId()).toBe(first);
    r.close(first);
    expect(r.focusedSurfaceId()).toBeUndefined();
  });

  it("notifies the owner when a surface closes so a pending custom() can settle", () => {
    const { registry: r } = registry();
    const onClose = vi.fn();
    const id = r.open({ kind: "custom", surfaceId: "s1" }, component(["x"]) as never, { onClose });
    r.close(id);
    r.close(id);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disposes a component that offers dispose when its surface closes", () => {
    const { registry: r } = registry();
    const dispose = vi.fn();
    const id = r.open({ kind: "footer" }, { render: () => ["x"], dispose } as never);
    r.close(id);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("skips a frame when the render is identical to the one already sent", () => {
    const { events, registry: r } = registry();
    const c = component(["same"]);
    const id = r.open({ kind: "footer" }, c as never);
    r.rerender(id);
    expect(frames(events)).toHaveLength(1);
  });

  it("closes every surface at once when the session ends", () => {
    const { events, registry: r } = registry();
    r.open({ kind: "footer" }, component(["a"]) as never);
    r.open({ kind: "header" }, component(["b"]) as never);
    r.closeAll();
    expect(events.filter((event) => event.type === "surface_closed")).toHaveLength(2);
    expect(r.focusedSurfaceId()).toBeUndefined();
  });
});
