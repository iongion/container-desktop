import { describe, expect, it } from "vitest";

import type { Volume } from "@/container-client/types/volume";

import { buildVolumeSummary } from "./inspectSummary";

const baseVolume = (overrides: Partial<Volume> = {}): Volume =>
  ({
    Anonymous: false,
    CreatedAt: "2026-07-02T10:06:05.000Z",
    GID: 0,
    UID: 0,
    Driver: "local",
    Labels: {},
    Mountpoint: "/var/lib/containers/storage/volumes/data/_data",
    Name: "data",
    Options: {},
    Scope: "local",
    Status: {},
    ...overrides,
  }) as Volume;

const byKey = (rows: ReturnType<typeof buildVolumeSummary>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("buildVolumeSummary", () => {
  it("surfaces name, driver, scope, mountpoint (mono+copy) and created", () => {
    const rows = byKey(buildVolumeSummary(baseVolume()));
    expect(rows.name.value).toBe("data");
    expect(rows.driver.value).toBe("local");
    expect(rows.scope.value).toBe("local");
    expect(rows.mountpoint.value).toBe("/var/lib/containers/storage/volumes/data/_data");
    expect(rows.mountpoint.copyText).toBe("/var/lib/containers/storage/volumes/data/_data");
    expect(rows.mountpoint.mono).toBe(true);
    expect(String(rows.created.value)).toMatch(/\d{2} \w{3} \d{4}/);
  });
});
