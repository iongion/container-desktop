import { describe, expect, it } from "vitest";

import type { ActivityEntry, ApiEntry, SystemEntry } from "@/web-app/stores/activityTypes";
import { collapseConsecutiveDuplicates, filterEntries, formatRelativeTime } from "./activityFilters";

let seq = 0;
function apiEntry(over: Partial<ApiEntry> = {}): ActivityEntry {
  seq += 1;
  return {
    guid: `g${seq}`,
    date: 1000,
    kind: "api",
    severity: "success",
    title: "api",
    method: "GET",
    url: "/containers/json",
    label: "List containers",
    status: "ok",
    httpStatus: 200,
    ...over,
  } as ApiEntry;
}
function systemEntry(over: Partial<SystemEntry> = {}): ActivityEntry {
  seq += 1;
  return {
    guid: `g${seq}`,
    date: 1000,
    kind: "system",
    severity: "info",
    title: "Startup finished",
    eventType: "startup.phase",
    ...over,
  } as SystemEntry;
}

describe("filterEntries", () => {
  it("restricts to the tab's allowed kinds", () => {
    const entries = [apiEntry(), systemEntry()];
    const out = filterEntries(entries, { tabKinds: ["notification"], kinds: [], severities: [], search: "" });
    expect(out).toHaveLength(0);
  });

  it("applies kind chip filters within the tab", () => {
    const entries = [apiEntry(), systemEntry()];
    const out = filterEntries(entries, {
      tabKinds: ["api", "cli", "system"],
      kinds: ["system"],
      severities: [],
      search: "",
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("system");
  });

  it("applies severity filters", () => {
    const entries = [apiEntry({ severity: "success" }), apiEntry({ severity: "error" })];
    const out = filterEntries(entries, { tabKinds: ["api"], kinds: [], severities: ["error"], search: "" });
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe("error");
  });

  it("matches search against raw path and friendly label", () => {
    const entries = [apiEntry({ url: "/images/json", label: "List images" })];
    expect(
      filterEntries(entries, { tabKinds: ["api"], kinds: [], severities: [], search: "images/json" }),
    ).toHaveLength(1);
    expect(
      filterEntries(entries, { tabKinds: ["api"], kinds: [], severities: [], search: "list images" }),
    ).toHaveLength(1);
    expect(filterEntries(entries, { tabKinds: ["api"], kinds: [], severities: [], search: "nope" })).toHaveLength(0);
  });
});

describe("collapseConsecutiveDuplicates", () => {
  it("folds adjacent identical entries into a counted run", () => {
    const entries = [
      apiEntry({ url: "/x", httpStatus: 200 }),
      apiEntry({ url: "/x", httpStatus: 200 }),
      apiEntry({ url: "/y", httpStatus: 200 }),
    ];
    const out = collapseConsecutiveDuplicates(entries);
    expect(out).toHaveLength(2);
    expect(out[0].count).toBe(2);
    expect(out[1].count).toBe(1);
  });

  it("does not merge non-adjacent duplicates", () => {
    const entries = [apiEntry({ url: "/x" }), apiEntry({ url: "/y" }), apiEntry({ url: "/x" })];
    const out = collapseConsecutiveDuplicates(entries);
    expect(out).toHaveLength(3);
  });
});

describe("formatRelativeTime", () => {
  const now = 10_000_000;
  it("formats recent, minute, hour and day buckets", () => {
    expect(formatRelativeTime(now, now)).toBe("now");
    expect(formatRelativeTime(now - 3_000, now)).toBe("now");
    expect(formatRelativeTime(now - 10_000, now)).toBe("10s");
    expect(formatRelativeTime(now - 120_000, now)).toBe("2m");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe("2d");
  });
});
