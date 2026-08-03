import type { AIRecordedError } from "@/ai-system/core/diagnostics";

export interface GroupedDiagnosticError {
  error: AIRecordedError;
  count: number;
}

export function groupDiagnosticErrors(errors: readonly AIRecordedError[]): GroupedDiagnosticError[] {
  const groups = new Map<string, GroupedDiagnosticError>();
  for (let index = errors.length - 1; index >= 0; index -= 1) {
    const error = errors[index];
    const existing = groups.get(error.message);
    if (existing) existing.count += 1;
    else groups.set(error.message, { error, count: 1 });
  }
  return [...groups.values()];
}
