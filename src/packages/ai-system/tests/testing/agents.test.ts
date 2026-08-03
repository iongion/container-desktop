import { describe, expect, it } from "vitest";

import { workerFileSchema } from "@/ai-system/core/schemas";
import { CANONICAL_WORKERS, materializeWorkers, workersForLive } from "@/ai-system/testing/agents";

// The ONE canonical worker roster, shared by the mock app seeding and the live agent tests. Its shape must be
// what the wire actually accepts (workerFileSchema), so the same definitions round-trip through the real store
// and the real run host in both lenses.
describe("shared agent fixture", () => {
  it("caps the runnable roster at 10 workers with unique ids", () => {
    expect(CANONICAL_WORKERS.length).toBeGreaterThan(0);
    expect(CANONICAL_WORKERS.length).toBeLessThanOrEqual(10);
    const ids = CANONICAL_WORKERS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("materializes into schema-valid WorkerDefinitions carrying real prompts", () => {
    const workers = materializeWorkers(CANONICAL_WORKERS, { now: 1_000_000_000_000 });
    const parsed = workerFileSchema.safeParse({ version: 1, workers });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    for (const w of workers) {
      expect(w.systemPrompt.length).toBeGreaterThan(0);
      expect(w.specialty.length).toBeGreaterThan(0);
      expect(w.createdAt).toBeGreaterThan(0);
      expect(w.updatedAt).toBeGreaterThan(0);
    }
  });

  it("assigns distinct OpenRouter free models per worker for the live (multi-inference) lens", () => {
    const live = workersForLive();
    const parsed = workerFileSchema.safeParse({ version: 1, workers: live });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    // At least two different models across the roster → genuinely multi-inference.
    const models = new Set(live.map((w) => w.model));
    expect(models.size).toBeGreaterThanOrEqual(2);
    // Every live worker routes through OpenRouter and names a `:free` model.
    for (const w of live) {
      expect(w.providerId).toBe("openrouter");
      expect(w.model).toContain(":free");
    }
  });

  it("lets a caller override a single worker's model without mutating the fixture", () => {
    const custom = materializeWorkers(CANONICAL_WORKERS, {
      now: 1_000_000_000_000,
      models: { [CANONICAL_WORKERS[0].id]: { providerId: "openrouter", model: "x/y:free" } },
    });
    expect(custom[0].model).toBe("x/y:free");
    // The source spec is untouched (no shared mutable state between calls).
    expect(materializeWorkers(CANONICAL_WORKERS)[0].model).not.toBe("x/y:free");
  });
});
