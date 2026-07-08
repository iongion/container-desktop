// State-free helpers for the security scan seam. Command execution and logging/fault handling stay in the
// Application methods; the report skeleton and all JSON parsing live here — Trivy (vulnerabilities + SBOM
// packages) and cosign (signature/provenance). Pure + node-free (stays clean under `yarn audit:shared`).

import { randomUUID } from "@/utils/randomUUID";

// The initial report shape checkSecurity fills in. Loose `any` to match the original inline object.
export function createSecurityReport(scanner: string): any {
  return {
    status: "failure",
    scanner: {
      name: scanner,
      path: "",
      version: undefined,
      database: undefined,
    },
    counts: {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    },
    result: undefined,
    fault: undefined,
  };
}

// Parse `trivy --version --format json` output. Throws on bad JSON so the caller keeps its
// error log and the pre-set version/database (matching the original try/catch).
export function parseTrivyDatabase(stdout: string | undefined): { database: any; version: string } {
  const decoded = JSON.parse(stdout || "{}");
  const database = decoded || {};
  return { database, version: database.Version || "" };
}

// Parse a Trivy analysis result. NOT pure by design: assigns a fresh `guid` to every Result and
// Vulnerability (via the cross-platform `guid()` helper) and MUTATES the passed `counts` (incrementing per
// Severity, seeding unknown severities). Throws on bad JSON so the caller sets the "Error during output
// parsing" fault. These side effects are part of the contract — do not refactor them away.
export function parseTrivyAnalysis(stdout: string | undefined, counts: Record<string, number>): any {
  const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const sorter = (a: { Severity: string }, b: { Severity: string }) => {
    return priorities.indexOf(b.Severity) - priorities.indexOf(a.Severity);
  };
  const data = JSON.parse(stdout || JSON.stringify({ Results: [] }));
  data.Results = (data.Results || []).map((it: any) => {
    it.guid = randomUUID();
    it.Vulnerabilities = (it.Vulnerabilities || [])
      .map((v: any) => {
        v.guid = randomUUID();
        if (typeof counts[v.Severity] === "undefined") {
          counts[v.Severity] = 0;
        }
        counts[v.Severity] += 1;
        return v;
      })
      .sort(sorter);
    return it;
  });
  return data;
}

// ————— cosign: signature & provenance —————

export type SecuritySignatureState = "verified" | "unsigned" | "error";

// The facts surfaced by a policy-free keyless `cosign verify` (identity/issuer/Rekor), or the honest
// "unsigned"/"error" outcome. Never claims a trust-policy verdict — that lives in the Registry trust center.
export interface SecuritySignatureReport {
  state: SecuritySignatureState;
  keyless: boolean;
  signatureCount: number;
  identity?: string;
  issuer?: string;
  digest?: string;
  rekorLogIndex?: string;
  // For the "error" state: the concrete cosign reason (last meaningful stderr line), so the UI can say WHY.
  detail?: string;
  // For the "error" state: true when the failure is an auth challenge (the registry needs a login before the
  // manifest can be read) — drives the Security tab's "log in to verify" recovery instead of a dead-end error.
  authRequired?: boolean;
}

// The cosign error a user cares about is the last "Error: …" line, not the whole trace. Strip the prefix.
function cosignErrorDetail(stderr: string | undefined): string | undefined {
  const line = (stderr || "")
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .pop();
  if (!line) {
    return undefined;
  }
  return line.replace(/^Error:\s*/i, "");
}

// A non-zero cosign exit carrying one of these means "there is simply no signature", not a tool failure.
const COSIGN_UNSIGNED_PATTERN =
  /no signatures found|no matching signatures|no signatures associated|MANIFEST_UNKNOWN|no signature is present/i;

// A non-zero exit carrying one of these is an authentication challenge — the registry needs a login before the
// manifest (and thus the signature) can be read. Distinct from "unsigned": here the image simply couldn't be read.
const COSIGN_AUTH_PATTERN =
  /UNAUTHORIZED|authentication required|\b401\b|no basic auth credentials|access to the resource is denied/i;

// Parse `cosign verify --output json` (a JSON array of signature payloads). Casing varies between cosign
// versions (Critical/critical, Optional/optional) so both are accepted. A clean exit with unparseable output
// stays "verified" with unknown facts rather than dropping a real signature.
export function parseCosignVerification(
  stdout: string | undefined,
  opts: { success: boolean; stderr?: string },
): SecuritySignatureReport {
  const unsigned: SecuritySignatureReport = { state: "unsigned", keyless: false, signatureCount: 0 };
  if (!opts.success) {
    if (COSIGN_UNSIGNED_PATTERN.test(opts.stderr || "")) {
      return unsigned;
    }
    return {
      state: "error",
      keyless: false,
      signatureCount: 0,
      detail: cosignErrorDetail(opts.stderr),
      authRequired: COSIGN_AUTH_PATTERN.test(opts.stderr || ""),
    };
  }
  let entries: any[];
  try {
    const decoded = JSON.parse(stdout || "[]");
    entries = Array.isArray(decoded) ? decoded : [decoded];
  } catch {
    return { state: "verified", keyless: false, signatureCount: 1 };
  }
  if (entries.length === 0) {
    return unsigned;
  }
  const first = entries[0] || {};
  const optional = first.optional || first.Optional || {};
  const critical = first.critical || first.Critical || {};
  const issuer = optional.Issuer || optional.issuer || undefined;
  const identity = optional.Subject || optional.subject || critical?.Identity?.["docker-reference"] || undefined;
  const digest = critical?.Image?.["Docker-manifest-digest"] || undefined;
  const bundle = optional.Bundle || optional.bundle || {};
  const logIndex = bundle?.Payload?.logIndex ?? bundle?.payload?.logIndex;
  return {
    state: "verified",
    keyless: !!issuer,
    signatureCount: entries.length,
    identity,
    issuer,
    digest,
    rekorLogIndex: logIndex === undefined || logIndex === null ? undefined : String(logIndex),
  };
}

// ————— trivy: SBOM (packages emitted by the same `--list-all-pkgs` scan) —————

export interface SbomPackage {
  name: string;
  version: string;
  license?: string;
  type: string;
}

export interface SbomLicenseSummary {
  license: string;
  count: number;
}

// Trivy licenses are often long compound expressions ("LGPLv2+ and GPLv2+ with exceptions and BSD and …").
// Reduce to the primary term so chart slices + legend rows stay short; hard-cap the length as a backstop.
export function shortLicense(raw: string): string {
  if (!raw) {
    return raw;
  }
  const primary = (raw.split(/\s+(?:and|or|with)\s+|\s*[,;/|]\s*/i)[0] || raw).trim();
  return primary.length > 24 ? `${primary.slice(0, 23)}…` : primary;
}

// Flatten the full package inventory out of a parsed Trivy result (`Results[].Packages[]`), deduped by
// name+version+type and sorted by name. Tolerates missing Packages (a vuln-only result → empty list).
export function parseTrivySbomPackages(result: any): SbomPackage[] {
  const groups = result?.Results;
  if (!Array.isArray(groups)) {
    return [];
  }
  const seen = new Set<string>();
  const packages: SbomPackage[] = [];
  for (const group of groups) {
    const type = group?.Type || group?.Class || "";
    for (const pkg of group?.Packages || []) {
      const name = pkg?.Name || "";
      if (!name) {
        continue;
      }
      const version = pkg?.Version || "";
      const key = `${name}@${version}@${type}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const rawLicense = (pkg?.Licenses || [])[0];
      packages.push({ name, version, license: rawLicense ? shortLicense(rawLicense) : undefined, type });
    }
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// Count packages per license (most common first) for the SBOM license chips; unlicensed packages are skipped.
export function summarizeSbomLicenses(packages: SbomPackage[]): SbomLicenseSummary[] {
  const counts = new Map<string, number>();
  for (const pkg of packages) {
    if (!pkg.license) {
      continue;
    }
    counts.set(pkg.license, (counts.get(pkg.license) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([license, count]) => ({ license, count }))
    .sort((a, b) => b.count - a.count || a.license.localeCompare(b.license));
}

// The outcome of a `cosign verify` attempt: whether cosign is installed at all (drives the missing-tool
// NonIdealState) and, when it is, the parsed signature facts.
export interface SecuritySignatureResult {
  provider: string;
  available: boolean;
  version?: string;
  signature?: SecuritySignatureReport;
  fault?: { detail: string; message: string };
}

export function createSignatureResult(): SecuritySignatureResult {
  return { provider: "cosign", available: false };
}

// ————— mock data (dev/demo only — every caller is gated by isMockMode) —————

// Deterministic string hash so a given image ref always yields the same demo verdict + variety.
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function mockSignatureResult(target: string): SecuritySignatureResult {
  const bucket = hashString(target) % 4;
  const name = (target.split("/").pop() || "image").split(":")[0] || "image";
  if (bucket === 0) {
    return {
      provider: "cosign",
      available: true,
      version: "2.4.1",
      signature: { state: "unsigned", keyless: false, signatureCount: 0 },
    };
  }
  if (bucket === 1) {
    return {
      provider: "cosign",
      available: true,
      version: "2.4.1",
      signature: {
        state: "error",
        keyless: false,
        signatureCount: 0,
        authRequired: true,
        detail: `GET https://index.docker.io/v2/library/${name}/manifests/latest: UNAUTHORIZED: authentication required`,
      },
    };
  }
  return {
    provider: "cosign",
    available: true,
    version: "2.4.1",
    signature: {
      state: "verified",
      keyless: true,
      signatureCount: 1,
      issuer: "https://token.actions.githubusercontent.com",
      identity: `https://github.com/${name}/${name}/.github/workflows/release.yml@refs/tags/v1`,
      digest: `sha256:${hashString(target).toString(16).padStart(12, "0")}`,
      rekorLogIndex: String(123457000 + bucket),
    },
  };
}

// Raw Trivy-shaped analysis for the mock scanner: clean-ish for most images, a nasty one for ~1/3, so the UI
// exercises both the "trusted" and "issues" states in dev without trivy installed. Fed through the real parsers.
function mockTrivyRaw(target: string): any {
  const nasty = hashString(target) % 3 === 0;
  if (nasty) {
    return {
      Results: [
        {
          Target: `${target} (debian 11)`,
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [
            {
              Severity: "CRITICAL",
              VulnerabilityID: "CVE-2022-0778",
              PkgName: "openssl",
              InstalledVersion: "1.1.0h",
              Published: "2022-03-15T00:00:00Z",
              PrimaryURL: "https://avd.aquasec.com/nvd/cve-2022-0778",
              Description:
                "The BN_mod_sqrt() function can loop forever for non-prime moduli, leading to denial of service.",
            },
            {
              Severity: "CRITICAL",
              VulnerabilityID: "CVE-2021-3711",
              PkgName: "openssl",
              InstalledVersion: "1.1.0h",
              Published: "2021-08-24T00:00:00Z",
              PrimaryURL: "https://avd.aquasec.com/nvd/cve-2021-3711",
              Description: "SM2 decryption buffer overflow.",
            },
            {
              Severity: "HIGH",
              VulnerabilityID: "CVE-2019-10744",
              PkgName: "lodash",
              InstalledVersion: "4.17.11",
              Published: "2019-07-05T00:00:00Z",
              PrimaryURL: "https://avd.aquasec.com/nvd/cve-2019-10744",
              Description: "Prototype pollution in lodash defaultsDeep.",
            },
          ],
          Packages: [
            { Name: "openssl", Version: "1.1.0h", Licenses: ["OpenSSL"] },
            { Name: "lodash", Version: "4.17.11", Licenses: ["MIT"] },
            { Name: "bash", Version: "5.1", Licenses: ["GPL-3.0"] },
            { Name: "libc6", Version: "2.31", Licenses: ["LGPL-2.1"] },
          ],
        },
      ],
    };
  }
  return {
    Results: [
      {
        Target: `${target} (debian 12.1)`,
        Class: "os-pkgs",
        Type: "debian",
        Vulnerabilities: [
          {
            Severity: "MEDIUM",
            VulnerabilityID: "CVE-2024-7347",
            PkgName: "libssl3",
            InstalledVersion: "3.0.14",
            Published: "2024-08-10T00:00:00Z",
            PrimaryURL: "https://avd.aquasec.com/nvd/cve-2024-7347",
            Description: "nginx ngx_http_mp4_module out-of-bounds read.",
          },
          {
            Severity: "MEDIUM",
            VulnerabilityID: "CVE-2024-6119",
            PkgName: "openssl",
            InstalledVersion: "3.0.14",
            Published: "2024-09-03T00:00:00Z",
            PrimaryURL: "https://avd.aquasec.com/nvd/cve-2024-6119",
            Description: "Denial of service in X.509 name checks.",
          },
          {
            Severity: "LOW",
            VulnerabilityID: "CVE-2023-45853",
            PkgName: "zlib1g",
            InstalledVersion: "1.3.1",
            Published: "2023-10-14T00:00:00Z",
            PrimaryURL: "https://avd.aquasec.com/nvd/cve-2023-45853",
            Description: "MiniZip integer overflow in zipOpenNewFileInZip4_64.",
          },
        ],
        Packages: [
          { Name: "libssl3", Version: "3.0.14", Licenses: ["OpenSSL"] },
          { Name: "zlib1g", Version: "1.3.1", Licenses: ["Zlib"] },
          { Name: "nginx", Version: "1.27.0", Licenses: ["BSD-2-Clause"] },
          { Name: "libc6", Version: "2.36", Licenses: ["LGPL-2.1"] },
        ],
      },
    ],
  };
}

export function mockSecurityReport(target: string): any {
  const report = createSecurityReport("trivy");
  report.scanner.path = "/usr/local/bin/trivy";
  report.scanner.name = "trivy";
  report.scanner.version = "0.54.1";
  report.scanner.database = {
    Version: 2,
    VulnerabilityDB: {
      Version: 2,
      UpdatedAt: "2026-07-08T06:00:00Z",
      DownloadedAt: "2026-07-08T06:00:00Z",
      NextUpdate: "2026-07-08T18:00:00Z",
    },
  };
  report.result = parseTrivyAnalysis(JSON.stringify(mockTrivyRaw(target)), report.counts);
  report.sbom = parseTrivySbomPackages(report.result);
  report.status = "success";
  return report;
}

// A minimal SBOM document for the mock Export action, in the requested format.
export function mockSbomDocument(format: string, target: string): string {
  const packages = parseTrivySbomPackages(mockTrivyRaw(target));
  if (format.startsWith("cyclonedx")) {
    return JSON.stringify(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.5",
        metadata: { component: { type: "container", name: target } },
        components: packages.map((p) => ({
          type: "library",
          name: p.name,
          version: p.version,
          licenses: p.license ? [{ license: { id: p.license } }] : [],
        })),
      },
      null,
      2,
    );
  }
  return JSON.stringify(
    {
      spdxVersion: "SPDX-2.3",
      name: target,
      packages: packages.map((p) => ({
        name: p.name,
        versionInfo: p.version,
        licenseConcluded: p.license || "NOASSERTION",
      })),
    },
    null,
    2,
  );
}
