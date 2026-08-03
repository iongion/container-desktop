// Neutral run events shared by the host run driver and the renderer projection.
// No AI-SDK, React, Node, Tauri, or Wails imports.

import type { z } from "zod";
import type { Money } from "./cost";
import type {
  resolveRunPlanRequest,
  resolveRunPlanResult,
  resolveRunToolRequest,
  runEvent,
  runEventEnvelope,
  runPhase,
  runView,
  startRunRequest,
  startRunResult,
} from "./schemas";

export type RunPhase = z.infer<typeof runPhase>;
export type RunView = z.infer<typeof runView>;
export type RunTaskView = RunView["tasks"][number];
export type RunTaskStatus = RunTaskView["status"];
export type RunSpanView = RunView["spans"][number];
export type RunMoney = Money;
export type RunApprovalView = RunView["approvals"][number];
export type RunUsage = RunView["usage"];
export type RunEvent = z.infer<typeof runEvent>;
// The plan the coordinator produced: the DAG nodes before any execution state is folded onto them.
export type RunPlanTask = Extract<RunEvent, { type: "plan-ready" }>["tasks"][number];
export type RunErrorScope = Extract<RunEvent, { type: "error" }>["scope"];
export type RunEventEnvelope = z.infer<typeof runEventEnvelope>;
export type StartRunRequest = z.infer<typeof startRunRequest>;
export type StartRunResult = z.infer<typeof startRunResult>;
export type ResolveRunPlanRequest = z.infer<typeof resolveRunPlanRequest>;
export type ResolveRunPlanResult = z.infer<typeof resolveRunPlanResult>;
export type ResolveRunToolRequest = z.infer<typeof resolveRunToolRequest>;
