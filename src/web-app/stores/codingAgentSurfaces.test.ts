import { describe, expect, it } from "vitest";

import type { BridgeEvent, SurfaceSlot } from "@/pi-bridge/protocol";
import {
  applySurfaceEvent,
  chromeSurface,
  focusedSurface,
  noSurfaces,
  toolSurface,
  widgetSurfaces,
} from "@/web-app/stores/codingAgentSurfaces";

const frame = (
  surfaceId: string,
  slot: SurfaceSlot,
  over: Partial<Extract<BridgeEvent, { type: "surface_frame" }>> = {},
) =>
  ({
    type: "surface_frame",
    surfaceId,
    slot,
    lines: ["x"],
    focus: false,
    overlay: false,
    ...over,
  }) as BridgeEvent;

describe("applySurfaceEvent", () => {
  it("adds a surface on its first frame", () => {
    const surfaces = applySurfaceEvent(noSurfaces(), frame("s1", { kind: "footer" }, { lines: ["ready"] }));
    expect(surfaces.s1).toMatchObject({ surfaceId: "s1", lines: ["ready"], slot: { kind: "footer" } });
  });

  it("replaces the lines on every later frame", () => {
    let surfaces = applySurfaceEvent(noSurfaces(), frame("s1", { kind: "footer" }));
    surfaces = applySurfaceEvent(surfaces, frame("s1", { kind: "footer" }, { lines: ["a", "b"] }));
    expect(surfaces.s1.lines).toEqual(["a", "b"]);
    expect(Object.keys(surfaces)).toHaveLength(1);
  });

  it("drops a surface when it closes", () => {
    let surfaces = applySurfaceEvent(noSurfaces(), frame("s1", { kind: "footer" }));
    surfaces = applySurfaceEvent(surfaces, { type: "surface_closed", surfaceId: "s1" });
    expect(surfaces.s1).toBeUndefined();
  });

  it("returns the same object for an event that is not a surface event", () => {
    const surfaces = noSurfaces();
    expect(applySurfaceEvent(surfaces, { type: "idle" })).toBe(surfaces);
  });

  it("ignores a close for a surface it never saw", () => {
    const surfaces = noSurfaces();
    expect(applySurfaceEvent(surfaces, { type: "surface_closed", surfaceId: "ghost" })).toBe(surfaces);
  });
});

describe("surface selectors", () => {
  const populated = [
    frame("s1", { kind: "footer" }, { lines: ["footer"] }),
    frame("s2", { kind: "header" }, { lines: ["header"] }),
    frame("s3", { kind: "widget", widgetKey: "a", placement: "belowEditor" }, { lines: ["below"] }),
    frame("s4", { kind: "widget", widgetKey: "b" }, { lines: ["above"] }),
    frame("s5", { kind: "tool", toolCallId: "t1", slot: "result" }, { lines: ["tool"] }),
    frame("s6", { kind: "custom", surfaceId: "c1" }, { lines: ["dialog"], focus: true, overlay: true }),
  ].reduce(applySurfaceEvent, noSurfaces());

  it("finds the single surface holding a chrome slot", () => {
    expect(chromeSurface(populated, "footer")?.lines).toEqual(["footer"]);
    expect(chromeSurface(populated, "header")?.lines).toEqual(["header"]);
    expect(chromeSurface(populated, "editor")).toBeUndefined();
  });

  it("splits widgets by the placement the extension asked for, defaulting above the composer", () => {
    expect(widgetSurfaces(populated, "belowEditor").map((surface) => surface.lines[0])).toEqual(["below"]);
    expect(widgetSurfaces(populated, "aboveEditor").map((surface) => surface.lines[0])).toEqual(["above"]);
  });

  it("finds a tool's own surface by call id and slot", () => {
    expect(toolSurface(populated, "t1", "result")?.lines).toEqual(["tool"]);
    expect(toolSurface(populated, "t1", "call")).toBeUndefined();
    expect(toolSurface(populated, "nope", "result")).toBeUndefined();
  });

  it("reports the focused surface, and nothing when none is focused", () => {
    expect(focusedSurface(populated)?.surfaceId).toBe("s6");
    expect(focusedSurface(noSurfaces())).toBeUndefined();
  });

  it("prefers the surface focused most recently when two claim it", () => {
    const both = [
      frame("s1", { kind: "custom", surfaceId: "c1" }, { focus: true }),
      frame("s2", { kind: "custom", surfaceId: "c2" }, { focus: true }),
    ].reduce(applySurfaceEvent, noSurfaces());
    expect(focusedSurface(both)?.surfaceId).toBe("s2");
  });
});
