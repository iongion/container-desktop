// App-owned build history. Holds live BuildRuns (steps stream in via upsertStep/appendLog) and persists a
// capped, REDACTED slice to localStorage. Persistence runs every value through toPersistedRun so secret
// material (build-args, secret env, tokens in the command preview / raw log) never reaches disk, step logs
// are dropped (they can be huge and are transient), and the raw-log tail is capped.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { redactPayload, redactText } from "@/ai-system/core/redact";
import type { BuildRun, BuildStep, BuildStepLogLine } from "@/container-client/builder/types";

const RAW_LOG_CAP = 32 * 1024;
const MAX_PERSISTED_RUNS = 50;
const IN_MEMORY_RAW_LOG_CAP = 512 * 1024;

/** Pure: the on-disk projection of a run — redacted, log-stripped, size-capped. Exported for tests. */
export function toPersistedRun(run: BuildRun): BuildRun {
  return redactPayload({
    ...run,
    argvPreview: redactText(run.argvPreview ?? ""),
    rawLogTail: run.rawLogTail ? run.rawLogTail.slice(-RAW_LOG_CAP) : run.rawLogTail,
    steps: run.steps.map((step) => ({ ...step, logs: [] })),
  });
}

interface BuildStoreState {
  runs: Record<string, BuildRun>;
  order: string[]; // run ids, most-recent first
  activeRunId?: string;
  startRun: (run: BuildRun) => void;
  upsertStep: (runId: string, step: BuildStep) => void;
  appendLog: (runId: string, key: string, line: BuildStepLogLine) => void;
  setImageId: (runId: string, imageId: string) => void;
  finishRun: (runId: string, code: number | null, extra?: Partial<BuildRun>) => void;
  removeRun: (runId: string) => void;
}

function replaceStep(steps: BuildStep[], step: BuildStep): BuildStep[] {
  const index = steps.findIndex((existing) => existing.key === step.key);
  if (index === -1) {
    return [...steps, step];
  }
  const next = steps.slice();
  next[index] = { ...next[index], ...step };
  return next;
}

export const useBuildStore = create<BuildStoreState>()(
  persist(
    (set) => ({
      runs: {},
      order: [],
      activeRunId: undefined,

      startRun: (run) =>
        set((state) => ({
          runs: { ...state.runs, [run.id]: run },
          order: [run.id, ...state.order.filter((id) => id !== run.id)],
          activeRunId: run.id,
        })),

      upsertStep: (runId, step) =>
        set((state) => {
          const run = state.runs[runId];
          if (!run) {
            return {};
          }
          return { runs: { ...state.runs, [runId]: { ...run, steps: replaceStep(run.steps, step) } } };
        }),

      appendLog: (runId, key, line) =>
        set((state) => {
          const run = state.runs[runId];
          if (!run) {
            return {};
          }
          const steps = run.steps.map((step) => (step.key === key ? { ...step, logs: [...step.logs, line] } : step));
          const rawLogTail = `${run.rawLogTail ?? ""}${line.text}\n`.slice(-IN_MEMORY_RAW_LOG_CAP);
          return { runs: { ...state.runs, [runId]: { ...run, steps, rawLogTail } } };
        }),

      setImageId: (runId, imageId) =>
        set((state) => {
          const run = state.runs[runId];
          if (!run || run.imageId === imageId) {
            return {};
          }
          return { runs: { ...state.runs, [runId]: { ...run, imageId } } };
        }),

      finishRun: (runId, code, extra) =>
        set((state) => {
          const run = state.runs[runId];
          if (!run) {
            return {};
          }
          const status = code === 0 ? "succeeded" : "failed";
          const steps = run.steps.map((step) =>
            step.status === "running" ? { ...step, status: status === "succeeded" ? "done" : "error" } : step,
          ) as BuildStep[];
          return {
            runs: {
              ...state.runs,
              [runId]: { ...run, status, exitCode: code, finishedAt: Date.now(), steps, ...extra },
            },
          };
        }),

      removeRun: (runId) =>
        set((state) => {
          const { [runId]: _removed, ...runs } = state.runs;
          return {
            runs,
            order: state.order.filter((id) => id !== runId),
            activeRunId: state.activeRunId === runId ? undefined : state.activeRunId,
          };
        }),
    }),
    {
      name: "container-desktop.builds",
      partialize: (state) => {
        const order = state.order.slice(0, MAX_PERSISTED_RUNS);
        const runs: Record<string, BuildRun> = {};
        for (const id of order) {
          if (state.runs[id]) {
            runs[id] = toPersistedRun(state.runs[id]);
          }
        }
        return { runs, order };
      },
    },
  ),
);
