import { makeCreateGoalRun } from "@/ai-system/runtime/goalOrchestrator";
import { createOmaAdapter } from "@/ai-system/runtime/omaAdapter";

// The real goal-mode engine: the owned multi-agent driver wired to the provider-backed open-multi-agent adapter.
// Adapters are built per turn, so the API key stays inside providerFetch.
//
// Binding `access.model` here is what actually selects the model — the driver decides WHICH access a turn runs
// against (the run default, the cheaper coordinator model, or a worker's own), and this only honours it. OMA's
// adapter captures its model at construction, so nothing downstream can still change it.
export const createOmaGoalRun = makeCreateGoalRun((access) =>
  createOmaAdapter({ ...access.resolved, model: access.model }, access.providerFetch),
);
