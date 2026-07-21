import { describe, expect, it } from "vitest";

import { filterToolset, humanizeToolName, mergeToolsets, type Toolset } from "@/ai-system/runtime/tools/toolset";

// A minimal Toolset stand-in: `gated` is true for any name starting with "remove", `run` records what it ran so a
// test can prove a filtered-out call never reached the executor.
function fakeToolset(names: string[], ran: string[] = []): Toolset {
  return {
    defs: names.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) as Toolset["defs"],
    has: (name) => names.includes(name),
    gated: (name) => name.startsWith("remove"),
    title: (name) => humanizeToolName(name),
    validate: (name, input) => (names.includes(name) ? { ok: true, value: input } : { ok: false, error: "unknown" }),
    run: async (name) => {
      ran.push(name);
      return { ok: true, result: name, summary: name };
    },
  };
}

describe("filterToolset", () => {
  it("offers only the allowlisted tools to the model", () => {
    const filtered = filterToolset(fakeToolset(["readFile", "writeFile", "removeContainer"]), new Set(["readFile"]));
    expect(filtered?.defs.map((def) => def.name)).toEqual(["readFile"]);
  });

  it("reports a filtered-out tool as absent, not merely ungated", () => {
    const filtered = filterToolset(fakeToolset(["readFile", "removeContainer"]), new Set(["readFile"]));
    expect(filtered?.has("removeContainer")).toBe(false);
    // `gated` must not answer true for a tool the worker does not hold: the caller reads it to decide whether to
    // raise an approval, and "not gated" would otherwise read as "safe to run unattended".
    expect(filtered?.gated("removeContainer")).toBe(false);
    expect(filtered?.gated("readFile")).toBe(false);
  });

  // THE case that matters. A model can emit a call for a tool it was never offered — hallucinated, or planted by
  // injected text inside a file it WAS allowed to read. If filtering stopped at `defs`, that call would pass
  // has() → validate() → gated() and reach run(), and a cached allow would execute it.
  it("refuses to validate or run a tool outside the allowlist", async () => {
    const ran: string[] = [];
    const filtered = filterToolset(fakeToolset(["readFile", "removeContainer"], ran), new Set(["readFile"]));
    expect(filtered?.validate("removeContainer", { id: "x" })).toEqual({
      ok: false,
      error: "unknown tool: removeContainer",
    });
    await expect(filtered?.run("removeContainer", { id: "x" })).rejects.toThrow(/unknown tool: removeContainer/);
    expect(ran).toEqual([]);
  });

  it("still runs an allowlisted tool", async () => {
    const ran: string[] = [];
    const filtered = filterToolset(fakeToolset(["readFile", "removeContainer"], ran), new Set(["readFile"]));
    await expect(filtered?.run("readFile", {})).resolves.toMatchObject({ ok: true });
    expect(ran).toEqual(["readFile"]);
  });

  // title() is read BEFORE the has-check when the orchestrator builds the approval/event title, so throwing here
  // would turn a benign hallucinated name into an exception mid-turn.
  it("keeps titling every name, including filtered-out ones", () => {
    const filtered = filterToolset(fakeToolset(["readFile", "removeContainer"]), new Set(["readFile"]));
    expect(filtered?.title("removeContainer")).toBe("Remove Container");
  });

  it("returns null when the allowlist removes everything, matching mergeToolsets' empty case", () => {
    expect(filterToolset(fakeToolset(["readFile"]), new Set(["nothingMatches"]))).toBeNull();
    expect(filterToolset(fakeToolset(["readFile"]), new Set())).toBeNull();
  });

  it("composes with mergeToolsets across both capabilities", () => {
    const merged = mergeToolsets([fakeToolset(["listContainers", "removeContainer"]), fakeToolset(["readFile"])]);
    const filtered = filterToolset(merged as Toolset, new Set(["listContainers", "readFile"]));
    expect(filtered?.defs.map((def) => def.name)).toEqual(["listContainers", "readFile"]);
    expect(filtered?.has("removeContainer")).toBe(false);
  });
});
