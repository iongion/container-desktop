import { describe, expect, it } from "vitest";

import type { AIRecordedError } from "@/ai-system/core/diagnostics";
import { groupDiagnosticErrors } from "@/web-app/components/ai/diagnosticErrors";

describe("groupDiagnosticErrors", () => {
  it("puts newest errors first and collapses repeated messages", () => {
    const errors: AIRecordedError[] = [
      { at: 100, message: "repeated", context: "first" },
      { at: 200, message: "different" },
      { at: 300, message: "repeated", context: "latest" },
    ];

    expect(groupDiagnosticErrors(errors)).toEqual([
      { error: errors[2], count: 2 },
      { error: errors[1], count: 1 },
    ]);
  });

  it("does not mutate the source list", () => {
    const errors: AIRecordedError[] = [
      { at: 100, message: "first" },
      { at: 200, message: "second" },
    ];

    groupDiagnosticErrors(errors);

    expect(errors.map(({ at }) => at)).toEqual([100, 200]);
  });
});
