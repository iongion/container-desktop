import { describe, expect, it } from "vitest";

import { resolveModelChoice } from "./modelChoice";

describe("resolveModelChoice — smart model picker", () => {
  it("falls back to a free-text input when the server lists no models", () => {
    expect(resolveModelChoice("", [])).toEqual({ mode: "input", value: "", options: [] });
  });

  it("keeps a typed model in the input when nothing is reachable", () => {
    expect(resolveModelChoice("gpt-4o", [])).toEqual({ mode: "input", value: "gpt-4o", options: [] });
  });

  it("defaults to the first listed model when a server is reachable and none is saved (smart default)", () => {
    const c = resolveModelChoice("", ["llama-3.1-8b", "qwen2.5"]);
    expect(c.mode).toBe("select");
    expect(c.value).toBe("llama-3.1-8b");
    expect(c.options).toEqual(["llama-3.1-8b", "qwen2.5"]);
    expect(c.autoSelect).toBe("llama-3.1-8b");
  });

  it("shows the saved model selected, no auto-select", () => {
    const c = resolveModelChoice("qwen2.5", ["llama-3.1-8b", "qwen2.5"]);
    expect(c.mode).toBe("select");
    expect(c.value).toBe("qwen2.5");
    expect(c.autoSelect).toBeUndefined();
  });

  it("keeps a saved model selectable even when the server didn't list it", () => {
    const c = resolveModelChoice("my-custom", ["llama-3.1-8b"]);
    expect(c.options).toContain("my-custom");
    expect(c.options).toContain("llama-3.1-8b");
    expect(c.value).toBe("my-custom");
  });

  it("dedupes the listed models", () => {
    expect(resolveModelChoice("", ["a", "a", "b"]).options).toEqual(["a", "b"]);
  });
});
