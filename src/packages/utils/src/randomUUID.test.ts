import { describe, expect, it } from "vitest";

import { randomUUID } from "./randomUUID";

describe("randomUUID", () => {
  it("produces a canonical RFC-4122 v4 UUID (version + variant bits set)", () => {
    expect(randomUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("is effectively unique across many calls", () => {
    const values = new Set(Array.from({ length: 5000 }, () => randomUUID()));
    expect(values.size).toBe(5000);
  });
});
