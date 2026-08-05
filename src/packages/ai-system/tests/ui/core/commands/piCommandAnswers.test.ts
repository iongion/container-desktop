import { describe, expect, it } from "vitest";

import { readSessionNameAnswer } from "@/ai-system/ui/core/commands/piCommandAnswers";

describe("readSessionNameAnswer", () => {
  it("reads the name pi says it gave the session", () => {
    expect(readSessionNameAnswer({ name: "Release triage" })).toBe("Release triage");
  });

  it("trims it, because the name is shown in a header row", () => {
    expect(readSessionNameAnswer({ name: "  Release triage " })).toBe("Release triage");
  });

  it("is not this kind of answer when nothing nameable came back", () => {
    expect(readSessionNameAnswer({ name: "   " })).toBeUndefined();
    expect(readSessionNameAnswer({ command: "name" })).toBeUndefined();
    expect(readSessionNameAnswer(undefined)).toBeUndefined();
  });
});
