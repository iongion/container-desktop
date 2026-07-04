import { describe, expect, it } from "vitest";
import { isElectronRuntime } from "./detect";

describe("isElectronRuntime", () => {
  it("detects the Electron preload surface without classifying Tauri as Electron", () => {
    expect(isElectronRuntime({ Preloaded: true })).toBe(true);
    expect(isElectronRuntime({ Preloaded: true, __TAURI_INTERNALS__: {} })).toBe(false);
    expect(isElectronRuntime({})).toBe(false);
  });
});
