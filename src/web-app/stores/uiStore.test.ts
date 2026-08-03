import { beforeEach, describe, expect, it } from "vitest";

import { clampConsoleHeight, useUIStore } from "./uiStore";

describe("uiStore selection", () => {
  beforeEach(() => {
    useUIStore.getState().reset();
  });

  it("sets selected rows per scope", () => {
    useUIStore.getState().setSelectedRows("containers", ["a", "b"]);
    expect(useUIStore.getState().selectedRows.containers).toEqual(["a", "b"]);
    expect(useUIStore.getState().selectedRows.images).toBeUndefined();
  });

  it("reset clears selected rows", () => {
    useUIStore.getState().setSelectedRows("containers", ["a", "b"]);
    useUIStore.getState().reset();
    expect(useUIStore.getState().selectedRows).toEqual({});
  });
});

describe("uiStore assistant console", () => {
  beforeEach(() => {
    useUIStore.getState().setAssistantConsoleOpen(false);
    useUIStore.getState().setAssistantConsoleVariant("bottom");
    useUIStore.getState().setAssistantConsoleOpacity(0.9);
    useUIStore.getState().setAssistantConsoleHeight(56);
  });

  it("defaults to a closed bottom quake at 90% opacity", () => {
    const { open, variant, opacity } = useUIStore.getState().assistantConsole;
    expect({ open, variant, opacity }).toEqual({ open: false, variant: "bottom", opacity: 0.9 });
  });

  it("defaults to a 56% quake height and clamps drag-resize to the 10–80% range", () => {
    expect(useUIStore.getState().assistantConsole.height).toBe(56);
    useUIStore.getState().setAssistantConsoleHeight(42);
    expect(useUIStore.getState().assistantConsole.height).toBe(42);
    useUIStore.getState().setAssistantConsoleHeight(95);
    expect(useUIStore.getState().assistantConsole.height).toBe(80);
    useUIStore.getState().setAssistantConsoleHeight(3);
    expect(useUIStore.getState().assistantConsole.height).toBe(10);
  });

  it("toggles open without disturbing variant/opacity", () => {
    useUIStore.getState().setAssistantConsoleVariant("right");
    useUIStore.getState().setAssistantConsoleOpacity(0.6);
    useUIStore.getState().toggleAssistantConsole();
    expect(useUIStore.getState().assistantConsole).toEqual({ open: true, variant: "right", opacity: 0.6, height: 56 });
    useUIStore.getState().toggleAssistantConsole();
    expect(useUIStore.getState().assistantConsole.open).toBe(false);
  });

  it("reset (connection switch) leaves the console + current screen untouched", () => {
    useUIStore.getState().setAssistantConsoleOpen(true);
    useUIStore.getState().setCurrentScreen({ id: "containers", title: "Containers" });
    useUIStore.getState().reset();
    expect(useUIStore.getState().assistantConsole.open).toBe(true);
    expect(useUIStore.getState().currentScreen).toEqual({ id: "containers", title: "Containers" });
  });
});

describe("clampConsoleHeight", () => {
  it("keeps a mid-range height untouched and caps it at 80%", () => {
    expect(clampConsoleHeight(50, 900)).toBe(50);
    expect(clampConsoleHeight(95, 900)).toBe(80);
  });

  it("floors at 250px, which dominates the 10% floor on a typical viewport", () => {
    // 250px is ~27.78% of a 900px viewport, so anything shorter snaps up to it.
    expect(clampConsoleHeight(5, 900)).toBeCloseTo((250 / 900) * 100, 5);
    expect(clampConsoleHeight(40, 900)).toBe(40);
  });

  it("falls back to the 10% floor on a very tall viewport where 250px is under 10%", () => {
    // 250px is only 6.25% of a 4000px viewport, so the 10% percentage floor binds instead.
    expect(clampConsoleHeight(3, 4000)).toBe(10);
  });
});
