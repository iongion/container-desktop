// Neutral goal-run events shared by the host run driver and the renderer projection.
// No AI-SDK, Electron, React, Node, Tauri, or Wails imports.

import type { z } from "zod";
import type {
  resolveGoalPlanRequest,
  resolveGoalPlanResult,
  resolveGoalToolRequest,
  runEvent,
  runEventEnvelope,
  runPhase,
  runView,
  startGoalRequest,
  startGoalResult,
} from "./schemas";

export type RunPhase = z.infer<typeof runPhase>;
export type RunView = z.infer<typeof runView>;
export type RunTaskView = RunView["tasks"][number];
export type RunTaskStatus = RunTaskView["status"];
export type RunApprovalView = RunView["approvals"][number];
export type RunUsage = RunView["usage"];
export type RunEvent = z.infer<typeof runEvent>;
// The plan the coordinator produced: the DAG nodes before any execution state is folded onto them.
export type RunPlanTask = Extract<RunEvent, { type: "plan-ready" }>["tasks"][number];
export type RunErrorScope = Extract<RunEvent, { type: "error" }>["scope"];
export type RunEventEnvelope = z.infer<typeof runEventEnvelope>;
export type StartGoalRequest = z.infer<typeof startGoalRequest>;
export type StartGoalResult = z.infer<typeof startGoalResult>;
export type ResolveGoalPlanRequest = z.infer<typeof resolveGoalPlanRequest>;
export type ResolveGoalPlanResult = z.infer<typeof resolveGoalPlanResult>;
export type ResolveGoalToolRequest = z.infer<typeof resolveGoalToolRequest>;
