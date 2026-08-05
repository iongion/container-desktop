import { describe, expect, it } from "vitest";

import { formatModelFacts, formatTokenCount } from "@/ai-system/ui/core/modelFacts";

describe("formatTokenCount", () => {
  // A window is read at a glance, so a round million or thousand is said that way — but a server's own odd
  // number (LM Studio's loaded 8192) is never rounded into a lie.
  it.each([
    [1000000, "1M"],
    [1047576, "1.05M"],
    [200000, "200k"],
    [204800, "204.8k"],
    [131072, "131.1k"],
    [8192, "8,192"],
    [4096, "4,096"],
  ])("says %i as %s", (value, expected) => {
    expect(formatTokenCount(value)).toBe(expected);
  });
});

describe("formatModelFacts", () => {
  it("says the window, the answer cap and the rates", () => {
    expect(
      formatModelFacts({
        contextWindow: 1000000,
        maxOutputTokens: 128000,
        pricing: { input: 10, output: 50 },
      }),
    ).toEqual({ parts: ["1M ctx", "128k out", "$10/$50"], thinks: undefined });
  });

  // pi prices a free model at zero, and so does a local server. "free" is the honest reading, and it is not the
  // same as a price nobody published.
  it("calls a zero price free and says nothing when no price was published", () => {
    expect(formatModelFacts({ contextWindow: 8192, pricing: { input: 0, output: 0 } }).parts).toEqual([
      "8,192 ctx",
      "free",
    ]);
    expect(formatModelFacts({ contextWindow: 8192 }).parts).toEqual(["8,192 ctx"]);
  });

  // The capability is the point; the top level it accepts is the detail worth showing beside it.
  it("marks a reasoner with the hardest level it accepts", () => {
    expect(formatModelFacts({ reasoning: { levels: ["low", "medium", "high", "xhigh"] } }).thinks).toBe("xhigh");
    expect(formatModelFacts({ reasoning: {} }).thinks).toBe("");
  });

  it("says nothing at all about a model nobody published anything for", () => {
    expect(formatModelFacts(undefined)).toEqual({ parts: [], thinks: undefined });
    expect(formatModelFacts({})).toEqual({ parts: [], thinks: undefined });
  });
});
