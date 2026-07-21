import { makeCreateAgentSession } from "@/ai-system/runtime/interactiveEngine";
import { createOmaAdapter } from "@/ai-system/runtime/omaAdapter";

// The real interactive engine: the owned loop wired to the provider-backed open-multi-agent adapter. Each turn builds
// the adapter from that turn's resolved provider + shell providerFetch, so a mid-conversation model/provider switch
// takes effect on the next submit and the API key stays at the host boundary (injected inside providerFetch).
export const createOmaAgentSession = makeCreateAgentSession((task) =>
  createOmaAdapter(task.resolved, task.providerFetch),
);
