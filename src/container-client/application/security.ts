// State-free helpers for checkSecurity (Trivy). Lifted verbatim from Application.ts — command execution
// and logging/fault handling stay in the method; only the report skeleton and JSON parsing live here.

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
// console.error and the pre-set version/database (matching the original try/catch).
export function parseTrivyDatabase(stdout: string | undefined): { database: any; version: string } {
  const decoded = JSON.parse(stdout || "{}");
  const database = decoded || {};
  return { database, version: database.Version || "" };
}

// Parse a Trivy analysis result. NOT pure by design: assigns a fresh `guid` to every Result and
// Vulnerability (crypto.randomUUID) and MUTATES the passed `counts` (incrementing per Severity, seeding
// unknown severities). Throws on bad JSON so the caller sets the "Error during output parsing" fault.
// These side effects are part of the contract — do not refactor them away.
export function parseTrivyAnalysis(stdout: string | undefined, counts: Record<string, number>): any {
  const priorities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const sorter = (a: { Severity: string }, b: { Severity: string }) => {
    return priorities.indexOf(b.Severity) - priorities.indexOf(a.Severity);
  };
  const data = JSON.parse(stdout || JSON.stringify({ Results: [] }));
  data.Results = (data.Results || []).map((it: any) => {
    it.guid = crypto.randomUUID();
    it.Vulnerabilities = (it.Vulnerabilities || [])
      .map((v: any) => {
        v.guid = crypto.randomUUID();
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
