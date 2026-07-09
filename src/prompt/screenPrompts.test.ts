import { describe, expect, it } from "vitest";

import { resolveScreenPrompt, SCREEN_PROMPT_ENTRIES } from "./screenPrompts";

describe("resolveScreenPrompt", () => {
  it("falls back to the generic entry for unknown or missing ids", () => {
    const generic = resolveScreenPrompt(undefined);
    expect(generic.focus).toBeTruthy();
    expect(generic.suggestions.length).toBeGreaterThan(0);
    expect(resolveScreenPrompt("totally.unknown")).toEqual(generic);
  });

  it("resolves a resource list screen to its domain base", () => {
    const containers = resolveScreenPrompt("containers");
    expect(containers.focus.toLowerCase()).toContain("container");
    expect(containers.suggestions.length).toBeGreaterThan(0);
    expect(containers).not.toEqual(resolveScreenPrompt(undefined));
  });

  it("resolves a sub-screen to its own override when present", () => {
    const logs = resolveScreenPrompt("container.logs");
    const base = resolveScreenPrompt("containers");
    expect(logs).not.toEqual(base);
    expect(`${logs.focus} ${logs.suggestions.join(" ")}`.toLowerCase()).toContain("log");
  });

  it("resolves a sub-screen with no override to its domain base", () => {
    // container.kube has no dedicated override → inherits the container base
    expect(resolveScreenPrompt("container.kube")).toEqual(resolveScreenPrompt("containers"));
  });

  it("derives the domain from the first id segment, normalizing plurals", () => {
    expect(resolveScreenPrompt("networks.reachability")).toEqual(resolveScreenPrompt("networks"));
    expect(resolveScreenPrompt("volumes.mounts")).toEqual(resolveScreenPrompt("volumes"));
    expect(resolveScreenPrompt("image.inspect").focus.toLowerCase()).toContain("image");
  });

  it("gives image.security a vulnerability-focused override", () => {
    const sec = resolveScreenPrompt("image.security");
    expect(`${sec.focus} ${sec.suggestions.join(" ")}`.toLowerCase()).toMatch(/vulnerab|cve|signature/);
  });

  it("every registry entry has non-empty focus and at least one suggestion", () => {
    for (const [key, entry] of Object.entries(SCREEN_PROMPT_ENTRIES)) {
      expect(entry.focus.trim(), `focus for ${key}`).not.toBe("");
      expect(entry.suggestions.length, `suggestions for ${key}`).toBeGreaterThan(0);
      for (const s of entry.suggestions) {
        expect(s.trim(), `suggestion in ${key}`).not.toBe("");
      }
    }
  });
});
