import { describe, expect, it } from "vitest";

import { inspectDate, shortId } from "./inspectSummary.helpers";

describe("shortId", () => {
  it("strips a sha256: prefix and keeps the first 12 chars", () => {
    expect(shortId("sha256:1234567890abcdef1111")).toBe("1234567890ab");
  });
  it("keeps the first 12 chars of a bare id", () => {
    expect(shortId("abcdef0123456789")).toBe("abcdef012345");
  });
  it("is safe on empty/undefined", () => {
    expect(shortId("")).toBe("");
    expect(shortId(undefined)).toBe("");
    expect(shortId(null)).toBe("");
  });
});

describe("inspectDate", () => {
  const DATE_RE = /\d{2} \w{3} \d{4} \d{2}:\d{2}/;
  it("formats an ISO string (incl. nanosecond precision like Docker inspect)", () => {
    expect(inspectDate("2023-11-14T22:13:20.000Z")).toMatch(DATE_RE);
    expect(inspectDate("2023-11-14T22:13:20.123456789Z")).toMatch(DATE_RE);
  });
  it("formats epoch seconds (Podman list) and epoch millis", () => {
    expect(inspectDate(1_700_000_000)).toMatch(DATE_RE); // seconds
    expect(inspectDate(1_700_000_000_000)).toMatch(DATE_RE); // millis
  });
  it("formats an all-digit epoch string", () => {
    expect(inspectDate("1700000000")).toMatch(DATE_RE);
  });
  it("both epoch-seconds and epoch-millis resolve to the SAME instant", () => {
    expect(inspectDate(1_700_000_000)).toBe(inspectDate(1_700_000_000_000));
  });
  it("shows the RAW value (never 'Invalid Date') when it can't be parsed", () => {
    expect(inspectDate("not-a-date")).toBe("not-a-date");
    expect(inspectDate("Invalid Date")).toBe("Invalid Date");
  });
  it("returns empty string for empty input so the row can be omitted", () => {
    expect(inspectDate("")).toBe("");
    expect(inspectDate(undefined)).toBe("");
    expect(inspectDate(null)).toBe("");
  });
});
