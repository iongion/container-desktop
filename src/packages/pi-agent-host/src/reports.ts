// What the session can tell the app about its own cost and its own context. Pure, over a structural view of the pi
// session, so both reports are testable without one — and so the mapping stays visible in one place rather than
// inline in the subscribe handler.
//
// Facts only. The app adds what only it knows (which configured provider this is, the permission mode, how it
// classifies each tool), because those are its policy and not pi's.

import type { SessionContextReport, SessionUsageReport } from "@/pi-bridge/protocol";

export interface PiSessionFacts {
  model: string;
  systemPrompt: string;
  // The tools the model was offered this turn, and the registry to read their prose from.
  activeToolNames: string[];
  tools: Array<{ name: string; description?: string }>;
  stats: {
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    tokens: { input: number; output: number };
    cost: number;
    contextUsage?: { tokens: number | null; contextWindow: number };
  };
  maxOutputTokens: number;
  // What the PROVIDER published for this model, when it publishes anything. Separate from `stats.contextUsage` on
  // purpose: pi's model config requires a window even when nobody knows one, so its number can be a fallback, and
  // relaying a fallback is what told the user they had 124k of input room on a server holding 8192.
  providerContextWindow?: number;
  // Likewise for the completion cap: absent means the provider published none and the cap in force is pi's default.
  providerMaxOutputTokens?: number;
  compacted: boolean;
}

export function sessionUsageReport(facts: PiSessionFacts): SessionUsageReport {
  return {
    // One assistant message is one provider request — pi counts them over every entry it recorded, so this
    // survives a compaction that dropped the messages themselves.
    requests: facts.stats.assistantMessages,
    inputTokens: facts.stats.tokens.input,
    outputTokens: facts.stats.tokens.output,
    costUsd: facts.stats.cost,
  };
}

export function sessionContextReport(facts: PiSessionFacts): SessionContextReport {
  const registry = new Map(facts.tools.map((tool) => [tool.name, tool]));
  return {
    model: facts.model,
    contextTokens: facts.stats.contextUsage?.tokens ?? null,
    // Only what the provider itself said. Zero means unknown, which the panel says in words — pi's own fallback is
    // for pi's compaction maths and is not a fact about this server.
    contextWindow: facts.providerContextWindow ?? 0,
    maxOutputTokens: facts.maxOutputTokens,
    // Zero means our default is in force, which the panel says in words rather than crediting it to the server.
    providerMaxOutputTokens: facts.providerMaxOutputTokens ?? 0,
    systemPromptChars: facts.systemPrompt.length,
    // Active names first, resolved through the registry: a name with no definition is one the app cannot describe,
    // and listing it would promise the model a tool nobody can explain.
    tools: facts.activeToolNames
      .map((name) => registry.get(name))
      .filter((tool): tool is { name: string; description?: string } => !!tool)
      .map((tool) => ({ name: tool.name, ...(tool.description ? { description: tool.description } : {}) })),
    messages: {
      user: facts.stats.userMessages,
      assistant: facts.stats.assistantMessages,
      toolCalls: facts.stats.toolCalls,
    },
    compacted: facts.compacted,
  };
}
