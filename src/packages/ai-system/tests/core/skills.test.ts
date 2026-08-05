import { describe, expect, it } from "vitest";

import { isValidSkillName, narrowSkillTools, SKILL_LIMITS } from "@/ai-system/core/skills";

describe("isValidSkillName", () => {
  it.each(["a", "web-research", "skill123", "skill-with-many-parts"])("accepts %s", (name) => {
    expect(isValidSkillName(name)).toBe(true);
  });

  it.each([
    "",
    "MySkill",
    "my_skill",
    "-skill",
    "skill-",
    "skill--name",
    "../skill",
    "skill/name",
    "skill\\name",
    "café",
    `a${"b".repeat(SKILL_LIMITS.nameBytes)}`,
  ])("rejects %s", (name) => {
    expect(isValidSkillName(name)).toBe(false);
  });
});

describe("narrowSkillTools", () => {
  it("intersects the skill allowlist with the Session toolset", () => {
    expect(narrowSkillTools(new Set(["readFile", "writeFile"]), ["readFile", "removePath"])).toEqual(
      new Set(["readFile"]),
    );
  });

  it("cannot add tools when a skill has no allowlist", () => {
    const available = new Set(["readFile", "writeFile"]);
    expect(narrowSkillTools(available)).toBe(available);
  });
});
