// components/Bulk/summarize.ts — pure headline + intent for a finished bulk run.
// Conjugation-free message ("Stop: 4 of 4 succeeded") so it stays translation-friendly; the bar can
// add per-item failure detail on top. Kept pure for unit testing.

import { Intent } from "@blueprintjs/core";

import type { BulkRunSummary } from "./types";

type TFunc = (key: string, vars?: Record<string, unknown>) => string;

export function summarize<T>(label: string, summary: BulkRunSummary<T>, t: TFunc): { intent: Intent; message: string } {
  const ok = summary.ok.length;
  const total = ok + summary.failed.length;
  const intent = summary.failed.length === 0 ? Intent.SUCCESS : ok === 0 ? Intent.DANGER : Intent.WARNING;
  return {
    intent,
    message: t("{{label}}: {{ok}} of {{total}} succeeded", { label, ok, total }),
  };
}
