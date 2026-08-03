import { describe, expect, it } from "vitest";
import { AVATAR_PRESETS, monogramFor, resolveAvatar } from "@/ai-system/core/avatarPresets";

describe("resolveAvatar", () => {
  const customs = [{ id: "c1", dataUrl: "data:image/webp;base64,AAAA" }];
  it("resolves a known preset id", () => {
    const preset = AVATAR_PRESETS[0];
    expect(resolveAvatar(preset.id, customs, "Aria")).toEqual({ kind: "preset", preset });
  });
  it("resolves a custom id to its image", () => {
    expect(resolveAvatar("c1", customs, "Aria")).toEqual({ kind: "image", dataUrl: "data:image/webp;base64,AAAA" });
  });
  it("falls back to a deterministic monogram for undefined or missing id", () => {
    const a = resolveAvatar(undefined, customs, "Aria");
    const b = resolveAvatar("gone", customs, "Aria");
    expect(a).toEqual(b);
    expect(a.kind).toBe("monogram");
  });
});

describe("monogramFor", () => {
  it("takes up to two initials, uppercased", () => {
    expect(monogramFor("ada lovelace").initials).toBe("AL");
    expect(monogramFor("Prometheus").initials).toBe("PR");
  });
  it("is deterministic in color for the same name", () => {
    expect(monogramFor("Aria").color).toBe(monogramFor("Aria").color);
  });
  it("handles empty name", () => {
    expect(monogramFor("   ").initials).toBe("?");
  });
});
