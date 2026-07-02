// Pure conversion from Containerfile lint findings to Monaco editor markers (the squiggles). Kept separate
// so the mapping — severity translation and the 0-based CfRange → 1-based Monaco line/column shift — is unit
// testable without the editor. `import type` is erased at build time.

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import type { LintFinding, LintSeverity } from "@/container-client/builder/types";

// Monaco's MarkerSeverity enum values: Hint = 1, Info = 2, Warning = 4, Error = 8.
const MONACO_SEVERITY: Record<LintSeverity, number> = { error: 8, warning: 4, info: 2 };

export function lintFindingsToMarkers(findings: LintFinding[]): Monaco.editor.IMarkerData[] {
  return findings.map((finding) => ({
    severity: MONACO_SEVERITY[finding.severity],
    message: `${finding.ruleId}: ${finding.message}`,
    code: finding.ruleId,
    startLineNumber: finding.range.start + 1,
    startColumn: 1,
    endLineNumber: finding.range.end + 1,
    endColumn: 4096, // to end of line — the linter is line-granular, not column-granular
  }));
}
