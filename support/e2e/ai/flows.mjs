// Stable public entry point for backend-agnostic AI end-to-end flows.
import { assistantApprovalFlow } from "./approvalFlows.mjs";
import { chatFlow, composerEnterFlow, slashCommandKeyboardFlow } from "./assistantFlows.mjs";
import { contextDiagnosticsFlow, projectContextFlow } from "./contextFlows.mjs";
import { skillDiscoveryFlow } from "./skillFlows.mjs";

export { assistantApprovalFlow } from "./approvalFlows.mjs";
export { chatFlow, composerEnterFlow, slashCommandKeyboardFlow } from "./assistantFlows.mjs";
export { contextDiagnosticsFlow, projectContextFlow } from "./contextFlows.mjs";
export { skillDiscoveryFlow } from "./skillFlows.mjs";

export const AI_FLOWS = [
  chatFlow,
  composerEnterFlow,
  slashCommandKeyboardFlow,
  contextDiagnosticsFlow,
  projectContextFlow,
  skillDiscoveryFlow,
  assistantApprovalFlow,
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
