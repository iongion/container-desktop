import { describe, expect, it } from "vitest";

import { createSecurityReport, parseTrivyAnalysis, parseTrivyDatabase } from "./security";

describe("createSecurityReport", () => {
  it("returns the failure skeleton with zeroed counts", () => {
    const report = createSecurityReport("trivy");
    expect(report.status).toBe("failure");
    expect(report.scanner).toEqual({ name: "trivy", path: "", version: undefined, database: undefined });
    expect(report.counts).toEqual({ CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 });
    expect(report.result).toBeUndefined();
    expect(report.fault).toBeUndefined();
  });
});

describe("parseTrivyDatabase", () => {
  it("extracts the database Version", () => {
    expect(parseTrivyDatabase(JSON.stringify({ Version: "db-1" }))).toEqual({
      database: { Version: "db-1" },
      version: "db-1",
    });
  });

  it("empty stdout yields an empty db and version", () => {
    expect(parseTrivyDatabase(undefined)).toEqual({ database: {}, version: "" });
  });

  it("throws on invalid JSON (caller keeps the pre-set values)", () => {
    expect(() => parseTrivyDatabase("not json")).toThrow();
  });
});

describe("parseTrivyAnalysis", () => {
  it("mutates counts, assigns guids, and sorts vulnerabilities by severity desc", () => {
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const data = parseTrivyAnalysis(
      JSON.stringify({
        Results: [
          { Target: "t", Vulnerabilities: [{ Severity: "LOW" }, { Severity: "CRITICAL" }, { Severity: "HIGH" }] },
        ],
      }),
      counts,
    );
    // counts is the SAME object, mutated in place
    expect(counts).toEqual({ CRITICAL: 1, HIGH: 1, MEDIUM: 0, LOW: 1 });
    const vulns = data.Results[0].Vulnerabilities;
    expect(vulns.map((v: any) => v.Severity)).toEqual(["CRITICAL", "HIGH", "LOW"]);
    expect(typeof data.Results[0].guid).toBe("string");
    expect(vulns.every((v: any) => typeof v.guid === "string")).toBe(true);
  });

  it("seeds unknown severities encountered in the data", () => {
    const counts: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    parseTrivyAnalysis(JSON.stringify({ Results: [{ Vulnerabilities: [{ Severity: "UNKNOWN" }] }] }), counts);
    expect(counts.UNKNOWN).toBe(1);
  });

  it("empty stdout yields empty Results", () => {
    const data = parseTrivyAnalysis("", {});
    expect(data.Results).toEqual([]);
  });

  it("throws on invalid JSON (caller sets the parsing fault)", () => {
    expect(() => parseTrivyAnalysis("not json", {})).toThrow();
  });
});
