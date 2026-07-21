import { describe, expect, it } from "vitest";

import { createKnowledgeBank, type KnowledgeBankData, type KnowledgeStorage } from "./knowledgeBank";

// In-memory storage so the bank is testable without the filesystem.
function memoryStorage(
  initial: KnowledgeBankData | null = null,
): KnowledgeStorage & { data: KnowledgeBankData | null } {
  const state = { data: initial };
  return {
    get data() {
      return state.data;
    },
    async load() {
      return state.data;
    },
    async save(d: KnowledgeBankData) {
      state.data = d;
    },
  };
}

describe("KnowledgeBank — seeding", () => {
  it("seeds built-in Podman/Docker/WSL/SSH solutions on first init and persists them", async () => {
    const storage = memoryStorage();
    const bank = createKnowledgeBank({ storage });
    await bank.init();
    const seeded = storage.data?.entries ?? [];
    expect(seeded.length).toBeGreaterThan(0);
    const domains = new Set(seeded.map((e) => e.domain));
    for (const d of ["podman", "docker", "wsl", "ssh"]) {
      expect(domains.has(d as any)).toBe(true);
    }
  });

  it("does NOT reseed when the store already has entries", async () => {
    const storage = memoryStorage({
      version: 1,
      entries: [{ id: "x", domain: "general", title: "t", symptom: "s", solution: "fix" }],
    });
    const bank = createKnowledgeBank({ storage });
    await bank.init();
    expect(storage.data?.entries).toHaveLength(1);
    expect(storage.data?.entries[0].id).toBe("x");
  });
});

describe("KnowledgeBank — search (read-only grounding)", () => {
  it("finds an entry by symptom keywords", async () => {
    const bank = createKnowledgeBank({ storage: memoryStorage() });
    await bank.init();
    const hits = await bank.search("permission denied docker socket");
    expect(hits.length).toBeGreaterThan(0);
    expect(`${hits[0].symptom} ${hits[0].solution}`.toLowerCase()).toContain("permission");
  });

  it("ranks the best keyword overlap first", async () => {
    const bank = createKnowledgeBank({ storage: memoryStorage() });
    await bank.init();
    const hits = await bank.search("ssh host key verification failed known_hosts");
    expect(hits[0].domain).toBe("ssh");
  });

  it("returns nothing for an unrelated query", async () => {
    const bank = createKnowledgeBank({ storage: memoryStorage() });
    await bank.init();
    expect(await bank.search("zzzqqq nonsense xyzzy")).toHaveLength(0);
  });
});
