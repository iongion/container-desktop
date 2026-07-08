import { describe, expect, it } from "vitest";

import {
  createSecurityReport,
  parseCosignVerification,
  parseTrivyAnalysis,
  parseTrivyDatabase,
  parseTrivySbomPackages,
  shortLicense,
  summarizeSbomLicenses,
} from "./security";

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

describe("parseCosignVerification", () => {
  // cosign verify --output json emits a JSON array of signature payloads. Keyless surfaces the OIDC
  // issuer + signer subject under `optional`; casing varies (Optional/optional, Critical/critical).
  const keylessStdout = JSON.stringify([
    {
      critical: {
        Identity: { "docker-reference": "docker.io/library/nginx" },
        Image: { "Docker-manifest-digest": "sha256:e4b0c2" },
        Type: "cosign container image signature",
      },
      optional: {
        Issuer: "https://token.actions.githubusercontent.com",
        Subject: "https://github.com/nginxinc/docker-nginx/.github/workflows/build.yml@refs/tags/1.27",
        Bundle: { Payload: { logIndex: 123457821, integratedTime: 1699999999 } },
      },
    },
  ]);

  it("reports a keyless verified signature with issuer, identity, digest, and Rekor log index", () => {
    const report = parseCosignVerification(keylessStdout, { success: true });
    expect(report.state).toBe("verified");
    expect(report.keyless).toBe(true);
    expect(report.issuer).toBe("https://token.actions.githubusercontent.com");
    expect(report.identity).toContain("github.com/nginxinc");
    expect(report.digest).toBe("sha256:e4b0c2");
    expect(report.rekorLogIndex).toBe("123457821");
    expect(report.signatureCount).toBe(1);
  });

  it("tolerates capitalized Optional/Critical payload casing", () => {
    const raw = JSON.stringify([
      { Critical: { Image: { "Docker-manifest-digest": "sha256:aa" } }, Optional: { Issuer: "iss", Subject: "sub" } },
    ]);
    const report = parseCosignVerification(raw, { success: true });
    expect(report.state).toBe("verified");
    expect(report.issuer).toBe("iss");
    expect(report.identity).toBe("sub");
  });

  it("treats a key-based signature (no OIDC issuer) as verified but not keyless", () => {
    const raw = JSON.stringify([
      { critical: { Image: { "Docker-manifest-digest": "sha256:bb" } }, optional: { sig: "x" } },
    ]);
    const report = parseCosignVerification(raw, { success: true });
    expect(report.state).toBe("verified");
    expect(report.keyless).toBe(false);
    expect(report.issuer).toBeUndefined();
  });

  it("maps a `no signatures found` failure to unsigned", () => {
    const report = parseCosignVerification("", { success: false, stderr: "Error: no signatures found for image" });
    expect(report.state).toBe("unsigned");
    expect(report.signatureCount).toBe(0);
  });

  it("maps other failures (e.g. network) to error, not auth-required", () => {
    const report = parseCosignVerification("", { success: false, stderr: "Error: dial tcp: i/o timeout" });
    expect(report.state).toBe("error");
    expect(report.authRequired).toBe(false);
  });

  it("flags an UNAUTHORIZED failure as auth-required (drives the log-in recovery)", () => {
    const stderr =
      "Error: GET https://index.docker.io/v2/library/app/manifests/latest: UNAUTHORIZED: authentication required";
    const report = parseCosignVerification("", { success: false, stderr });
    expect(report.state).toBe("error");
    expect(report.authRequired).toBe(true);
    expect(report.detail).toContain("UNAUTHORIZED");
  });

  it("stays verified (facts unknown) when cosign exits 0 with unparseable output", () => {
    const report = parseCosignVerification("not json", { success: true });
    expect(report.state).toBe("verified");
    expect(report.signatureCount).toBe(1);
    expect(report.issuer).toBeUndefined();
  });

  it("empty array output is unsigned", () => {
    const report = parseCosignVerification("[]", { success: true });
    expect(report.state).toBe("unsigned");
  });
});

describe("parseTrivySbomPackages", () => {
  const result = {
    Results: [
      {
        Target: "nginx (debian 12.1)",
        Class: "os-pkgs",
        Type: "debian",
        Packages: [
          { Name: "libssl3", Version: "3.0.14", Licenses: ["OpenSSL"] },
          { Name: "zlib1g", Version: "1.3.1", Licenses: ["Zlib"] },
          { Name: "libssl3", Version: "3.0.14", Licenses: ["OpenSSL"] }, // dup — deduped by name+version+type
        ],
      },
      {
        Target: "app/node_modules",
        Class: "lang-pkgs",
        Type: "node-pkg",
        Packages: [{ Name: "lodash", Version: "4.17.21" }],
      },
    ],
  };

  it("flattens, dedupes and sorts packages with license + type", () => {
    const packages = parseTrivySbomPackages(result);
    expect(packages).toEqual([
      { name: "libssl3", version: "3.0.14", license: "OpenSSL", type: "debian" },
      { name: "lodash", version: "4.17.21", license: undefined, type: "node-pkg" },
      { name: "zlib1g", version: "1.3.1", license: "Zlib", type: "debian" },
    ]);
  });

  it("returns an empty list when there are no Packages", () => {
    expect(parseTrivySbomPackages({ Results: [{ Target: "t", Vulnerabilities: [] }] })).toEqual([]);
    expect(parseTrivySbomPackages(undefined)).toEqual([]);
  });
});

describe("shortLicense", () => {
  it("reduces a long compound expression to its primary term", () => {
    expect(
      shortLicense("LGPLv2+ and LGPLv2+ with exceptions and GPLv2+ and GPLv2+ with exceptions and BSD and ISC"),
    ).toBe("LGPLv2+");
  });

  it("takes the first term across and/or/with and separators", () => {
    expect(shortLicense("Apache-2.0 OR MIT")).toBe("Apache-2.0");
    expect(shortLicense("MPL-2.0 with exceptions")).toBe("MPL-2.0");
    expect(shortLicense("GPL-2.0/BSD-3-Clause")).toBe("GPL-2.0");
  });

  it("leaves a plain short license unchanged and hard-caps an over-long token", () => {
    expect(shortLicense("MIT")).toBe("MIT");
    expect(shortLicense("A".repeat(40))).toBe(`${"A".repeat(23)}…`);
    expect(shortLicense("")).toBe("");
  });
});

describe("summarizeSbomLicenses", () => {
  it("counts packages per license, most-common first, skipping unlicensed", () => {
    const summary = summarizeSbomLicenses([
      { name: "a", version: "1", license: "MIT", type: "npm" },
      { name: "b", version: "1", license: "MIT", type: "npm" },
      { name: "c", version: "1", license: "Apache-2.0", type: "npm" },
      { name: "d", version: "1", license: undefined, type: "npm" },
    ]);
    expect(summary).toEqual([
      { license: "MIT", count: 2 },
      { license: "Apache-2.0", count: 1 },
    ]);
  });
});
