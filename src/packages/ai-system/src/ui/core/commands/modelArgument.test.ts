import { describe, expect, it } from "vitest";

import { modelFromCommandArgument } from "@/ai-system/ui/core/commands/modelArgument";

describe("modelFromCommandArgument", () => {
  it("reads nothing out of a bare command, which is the one that opens the picker", () => {
    expect(modelFromCommandArgument("", "lmstudio")).toBe("");
    expect(modelFromCommandArgument("   ", "lmstudio")).toBe("");
  });

  it("takes a plain id as the model for the session's own source", () => {
    expect(modelFromCommandArgument("qwen3-4b-instruct-2507", "lmstudio")).toBe("qwen3-4b-instruct-2507");
  });

  // pi's own argument is `<provider/model>`, so a pi user types the prefix. It is stripped only when it names THIS
  // session's source — the gateway holds one upstream, so nothing else could be meant.
  it("strips a prefix that names the session's source", () => {
    expect(modelFromCommandArgument("lmstudio/qwen3-4b", "lmstudio")).toBe("qwen3-4b");
  });

  // The trap: an aggregator's ids CONTAIN slashes, so splitting on the first one would rename half of OpenRouter.
  it("keeps a vendor-prefixed model id whole", () => {
    expect(modelFromCommandArgument("anthropic/claude-3.5-sonnet", "openrouter")).toBe("anthropic/claude-3.5-sonnet");
    expect(modelFromCommandArgument("openrouter/anthropic/claude-3.5-sonnet", "openrouter")).toBe(
      "anthropic/claude-3.5-sonnet",
    );
  });
});
