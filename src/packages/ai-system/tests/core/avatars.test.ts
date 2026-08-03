import { describe, expect, it } from "vitest";
import {
  type AvatarRecord,
  parseAvatarFile,
  prepareAvatarFile,
  removeAvatar,
  upsertAvatar,
} from "@/ai-system/core/avatars";

const make = (id: string, createdAt = 1): AvatarRecord => ({
  id,
  name: `Face ${id}`,
  dataUrl: "data:image/webp;base64,AAAA",
  createdAt,
});

describe("avatar core", () => {
  it("round-trips a prepared file", () => {
    const file = prepareAvatarFile([make("a")]);
    const parsed = parseAvatarFile(JSON.stringify(file));
    expect(parsed.status).toBe("ok");
    expect(parsed.avatars).toHaveLength(1);
  });
  it("flags invalid json as error", () => {
    expect(parseAvatarFile("{not json").status).toBe("error");
  });
  it("upsert replaces by id and appends new", () => {
    const next = upsertAvatar([make("a")], make("a", 9));
    expect(next).toHaveLength(1);
    expect(next[0].createdAt).toBe(9);
    expect(upsertAvatar(next, make("b"))).toHaveLength(2);
  });
  it("remove filters by id", () => {
    expect(removeAvatar([make("a"), make("b")], "a").map((x) => x.id)).toEqual(["b"]);
  });
});
