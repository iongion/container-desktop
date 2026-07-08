import { describe, expect, it } from "vitest";

import type { Secret } from "@/env/Types";

import { buildSecretSummary } from "./inspectSummary";

const baseSecret = (overrides: Partial<Secret> = {}): Secret =>
  ({
    ID: "secretid1234567890abcdef",
    Spec: { Name: "db-password", Driver: { Name: "file", Options: {} } },
    CreatedAt: "2026-07-02T10:06:05.000Z",
    UpdatedAt: "2026-07-03T11:07:06.000Z",
    ...overrides,
  }) as Secret;

const byKey = (rows: ReturnType<typeof buildSecretSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildSecretSummary", () => {
  it("surfaces name, short id, driver, created and updated", () => {
    const rows = byKey(buildSecretSummary(baseSecret()));
    expect(rows.name.value).toBe("db-password");
    expect(rows.name.copyText).toBe("db-password");
    expect(rows.id.value).toBe("secretid1234");
    expect(rows.driver.value).toBe("file");
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
    expect(String(rows.updated.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });

  it("omits the driver row when no driver name is set", () => {
    const rows = buildSecretSummary(baseSecret({ Spec: { Name: "x", Driver: undefined as any } }));
    expect(rows.some((r) => r.key === "driver")).toBe(false);
  });
});
