import { describe, expect, it } from "vitest";

import { upstreamModelApi } from "@/ai-system/core/piAgentEnv";

describe("upstreamModelApi", () => {
  it("speaks Anthropic's own wire shape to an Anthropic upstream", () => {
    // The app forwards bytes: a request that leaves pi as OpenAI completions cannot reach /v1/messages, so the shape
    // has to be decided here rather than assumed.
    expect(upstreamModelApi("anthropic")).toBe("anthropic-messages");
  });

  it("speaks OpenAI completions to everything else", () => {
    expect(upstreamModelApi("openai")).toBe("openai-completions");
    expect(upstreamModelApi("openai-compatible")).toBe("openai-completions");
    expect(upstreamModelApi("local")).toBe("openai-completions");
  });
});
