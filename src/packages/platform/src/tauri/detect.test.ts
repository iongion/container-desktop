import { describe, expect, it } from "vitest";
import { isTauriRuntime } from "./detect";

describe("isTauriRuntime", () => {
  it("detects Tauri from its injected internals marker", () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isTauriRuntime({ Preloaded: true })).toBe(false);
  });
});
