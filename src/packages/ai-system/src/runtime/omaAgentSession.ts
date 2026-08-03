import type { CreateAgentSession } from "@/ai-system/core/types";
import { createOmaAdapter } from "@/ai-system/runtime/omaAdapter";
import { makeCreateOmaAgentSession } from "@/ai-system/runtime/omaAgentSessionRuntime";
import { makeCompactThreadContext } from "@/ai-system/runtime/omaThreadCompactor";

// Each turn builds the adapter from that turn's resolved provider + shell providerFetch, so a mid-thread
// model/provider switch takes effect on the next submit and the API key stays at the host boundary.
export const createOmaAgentSession: CreateAgentSession = makeCreateOmaAgentSession((task, observer) =>
  createOmaAdapter(task.resolved, task.providerFetch, {
    agentName: "assistant",
    onToken: (_agentName, delta, messages) => observer.onToken(delta, messages),
  }),
);

export const compactOmaThreadContext = makeCompactThreadContext((input) =>
  createOmaAdapter(input.resolved, input.providerFetch),
);
