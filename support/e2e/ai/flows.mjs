// Stable public entry point for backend-agnostic AI end-to-end flows.
import {
  assistantApprovalFlow,
  planRejectFlow,
  stopFlow,
  taskTranscriptFlow,
  toolRejectFlow,
} from "./approvalFlows.mjs";
import { chatFlow, composerEnterFlow, slashCommandKeyboardFlow, threadHistoryKeyboardFlow } from "./assistantFlows.mjs";
import { contextDiagnosticsFlow, projectContextFlow } from "./contextFlows.mjs";
import { runFlow, runRosterFlow, runsListFlow } from "./runFlows.mjs";
import { skillDiscoveryFlow } from "./skillFlows.mjs";
import { threadBranchFlow } from "./threadBranchFlows.mjs";
import { workerConfigFlow, workersFlow } from "./workerFlows.mjs";

export {
  assistantApprovalFlow,
  planRejectFlow,
  stopFlow,
  taskTranscriptFlow,
  toolRejectFlow,
} from "./approvalFlows.mjs";
export { chatFlow, composerEnterFlow, slashCommandKeyboardFlow, threadHistoryKeyboardFlow } from "./assistantFlows.mjs";
export { contextDiagnosticsFlow, projectContextFlow } from "./contextFlows.mjs";
export { runFlow, runRosterFlow, runsListFlow } from "./runFlows.mjs";
export { skillDiscoveryFlow } from "./skillFlows.mjs";
export { threadBranchFlow } from "./threadBranchFlows.mjs";
export { workerConfigFlow, workersFlow } from "./workerFlows.mjs";

export const AI_FLOWS = [
  chatFlow,
  composerEnterFlow,
  slashCommandKeyboardFlow,
  contextDiagnosticsFlow,
  projectContextFlow,
  skillDiscoveryFlow,
  threadHistoryKeyboardFlow,
  threadBranchFlow,
  assistantApprovalFlow,
  runFlow,
  runRosterFlow,
  planRejectFlow,
  toolRejectFlow,
  taskTranscriptFlow,
  stopFlow,
  runsListFlow,
  workersFlow,
  workerConfigFlow,
];

/** Run all flows against a driver, returning results. @param {import("./flowSupport.mjs").AiE2eDriver} driver */
export async function runAiFlows(driver) {
  const results = [];
  for (const flow of AI_FLOWS) {
    try {
      results.push(await flow(driver));
    } catch (error) {
      results.push({ name: flow.name, ok: false, detail: `threw: ${error?.message || error}` });
    }
  }
  return results;
}
