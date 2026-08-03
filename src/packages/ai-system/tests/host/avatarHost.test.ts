import { describe, expect, it } from "vitest";
import type { AvatarRecord, AvatarStore } from "@/ai-system/core/avatars";
import { createAvatarHost } from "@/ai-system/host/avatarHost";

const rec = (id: string): AvatarRecord => ({ id, name: id, dataUrl: "data:image/webp;base64,AAAA", createdAt: 1 });

function fakeStore(initial: AvatarRecord[] = []): AvatarStore {
  let data = initial;
  return {
    async load() {
      return { status: "ok", avatars: data, path: "/x" };
    },
    async save(next) {
      data = next;
    },
  };
}

describe("avatarHost", () => {
  it("saves and lists", async () => {
    const host = createAvatarHost({ store: fakeStore() });
    await host.ready();
    const after = await host.save(rec("a"));
    expect(after.map((x) => x.id)).toEqual(["a"]);
    expect(host.list().map((x) => x.id)).toEqual(["a"]);
  });
  it("removes", async () => {
    const host = createAvatarHost({ store: fakeStore([rec("a"), rec("b")]) });
    await host.ready();
    expect((await host.remove("a")).map((x) => x.id)).toEqual(["b"]);
  });
});
