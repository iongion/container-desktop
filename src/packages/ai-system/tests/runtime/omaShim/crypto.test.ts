import { describe, expect, it } from "vitest";

import { randomBytes, randomUUID } from "@/ai-system/runtime/omaShim/crypto";

describe("omaShim/crypto", () => {
  it("randomUUID returns distinct v4 UUIDs", () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it("randomBytes(n).toString('hex') returns 2n lowercase hex chars", () => {
    const hex = randomBytes(16).toString("hex");
    expect(hex).toMatch(/^[0-9a-f]{32}$/);
    expect(randomBytes(8).toString("hex")).toHaveLength(16);
  });
});
