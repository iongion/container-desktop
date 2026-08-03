import { describe, expect, it } from "vitest";

import {
  isProjectSkillTrusted,
  parseSkillTrustFile,
  prepareSkillTrustFile,
  type SkillTrustSnapshot,
} from "@/ai-system/core/skillTrust";

const identity = {
  workspaceId: "a".repeat(64),
  root: "/workspace/.container-desktop/skills",
  skillId: "skill:project:review",
  fingerprint: "b".repeat(64),
};

describe("skill trust file", () => {
  it("round-trips source enablement and an exact fingerprint grant", () => {
    const file = prepareSkillTrustFile({
      status: "ok",
      path: "/data/ai-skill-trust.json",
      sources: [{ workspaceId: identity.workspaceId, root: identity.root, enabledAt: 10 }],
      skills: [{ ...identity, trustedAt: 11 }],
    });
    const parsed = parseSkillTrustFile(JSON.stringify(file));
    expect(parsed).toEqual({ status: "ok", sources: file.sources, skills: file.skills });
    expect(
      isProjectSkillTrusted({ ...parsed, path: "/data/ai-skill-trust.json" } as SkillTrustSnapshot, identity),
    ).toBe(true);
  });

  it("does not trust a changed fingerprint, root, or workspace", () => {
    const snapshot: SkillTrustSnapshot = {
      status: "ok",
      path: "/data/ai-skill-trust.json",
      sources: [{ workspaceId: identity.workspaceId, root: identity.root, enabledAt: 10 }],
      skills: [{ ...identity, trustedAt: 11 }],
    };
    expect(isProjectSkillTrusted(snapshot, { ...identity, fingerprint: "c".repeat(64) })).toBe(false);
    expect(isProjectSkillTrusted(snapshot, { ...identity, root: "/other" })).toBe(false);
    expect(isProjectSkillTrusted(snapshot, { ...identity, workspaceId: "d".repeat(64) })).toBe(false);
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, sources: [], skills: [] }),
    JSON.stringify({ version: 1, sources: [], skills: [{ ...identity, fingerprint: "weak" }] }),
  ])("fails closed for corrupt or unsupported data", (text) => {
    expect(parseSkillTrustFile(text)).toEqual({ status: "error", sources: [], skills: [] });
  });
});
