import { beforeEach, describe, expect, it } from "vitest";

import { type ChatSession, type ChatStore, getChatStore, InMemoryChatStore, setChatStore } from "./chatStore";

function session(id: string): ChatSession {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages: [] };
}

describe("InMemoryChatStore", () => {
  let store: ChatStore;
  beforeEach(() => {
    store = new InMemoryChatStore();
  });

  it("round-trips sessions (save upserts by id, load returns all)", async () => {
    await store.saveSession(session("a"));
    await store.saveSession(session("b"));
    await store.saveSession({ ...session("a"), title: "updated" });
    const all = await store.loadSessions();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === "a")?.title).toBe("updated");
  });

  it("deletes one and clears all", async () => {
    await store.saveSession(session("a"));
    await store.saveSession(session("b"));
    await store.deleteSession("a");
    expect(await store.loadSessions()).toHaveLength(1);
    await store.clearSessions();
    expect(await store.loadSessions()).toHaveLength(0);
  });

  it("does not leak references (load returns a snapshot copy)", async () => {
    await store.saveSession(session("a"));
    const first = await store.loadSessions();
    first[0].title = "mutated externally";
    const second = await store.loadSessions();
    expect(second[0].title).toBe("a");
  });
});

describe("chat store registry", () => {
  it("defaults to an InMemoryChatStore and can be swapped", () => {
    expect(getChatStore()).toBeInstanceOf(InMemoryChatStore);
    const custom = new InMemoryChatStore();
    setChatStore(custom);
    expect(getChatStore()).toBe(custom);
    setChatStore(new InMemoryChatStore());
  });
});
