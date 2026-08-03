import { describe, expect, it } from "vitest";

import { mockVisibleUserText } from "@/ai-system/testing/omaMocks";

describe("OMA mock display text", () => {
  it("does not echo private skill instructions or fingerprints into the transcript", () => {
    expect(
      mockVisibleUserText(`User-invoked skill: /skill:user:audit
Source: user
Fingerprint: secret-fingerprint

Arguments supplied by the user:

production containers

Skill instructions:

PRIVATE SKILL BODY`),
    ).toBe("/skill:user:audit production containers");
  });

  it("preserves ordinary mock prompts", () => {
    expect(mockVisibleUserText("list my containers")).toBe("list my containers");
  });
});
