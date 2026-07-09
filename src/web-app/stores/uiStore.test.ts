import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "./uiStore";

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
  });

  it("defaults to a closed bottom quake at 90% opacity", () => {
    const { open, variant, opacity } = useUIStore.getState().assistantConsole;
    expect({ open, variant, opacity }).toEqual({ open: false, variant: "bottom", opacity: 0.9 });
  });

  it("toggles open without disturbing variant/opacity", () => {
    useUIStore.getState().setAssistantConsoleVariant("right");
    useUIStore.getState().setAssistantConsoleOpacity(0.6);
    useUIStore.getState().toggleAssistantConsole();
    expect(useUIStore.getState().assistantConsole).toEqual({ open: true, variant: "right", opacity: 0.6 });
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
