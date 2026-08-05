// Turns what the session reported into the shapes the app's context and usage panels already render. The session
// states facts about itself; everything here is either arithmetic on those facts or the app's own policy — which
// tool is gated, which provider this is, what permission mode is in force — because pi has no opinion on any of it.

import {
  PI_FALLBACK_MAX_OUTPUT_TOKENS,
  type SessionContextReport,
  type SessionUsageReport,
} from "@/pi-bridge/protocol";

import type {
  EffectiveContextSection,
  EffectiveContextSnapshot,
  EffectiveContextSource,
  EffectiveToolView,
  SessionUsageSnapshot,
} from "./context";
import type { AIPermissionMode } from "./permissions";
import { isPiToolGated } from "./piApprovals";
import { isContainerToolName } from "./toolNames";
import { isWorkspaceToolName } from "./workspaceToolNames";

// Four characters per token. Crude, and labelled "approximate" everywhere it is shown: the alternative is a
// tokenizer per model family in the renderer, for a number whose only job is to give a sense of scale.
const CHARS_PER_TOKEN = 4;

function estimateTokens(characters: number): number {
  return Math.ceil(characters / CHARS_PER_TOKEN);
}

export function toSessionUsage(report: SessionUsageReport): SessionUsageSnapshot {
  return {
    requests: report.requests,
    inputTokens: report.inputTokens,
    outputTokens: report.outputTokens,
    // A provider with no published price yields nothing to show, which the panel says in words rather than
    // printing a confident $0.00.
    costs: report.costUsd > 0 ? [{ amount: report.costUsd, currency: "USD" }] : [],
  };
}

function toolView(tool: { name: string; description?: string }): EffectiveToolView {
  return {
    name: tool.name,
    title: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    group: isContainerToolName(tool.name) ? "container" : isWorkspaceToolName(tool.name) ? "workspace" : "other",
    gated: isPiToolGated(tool.name),
  };
}

// The three parts of a request this session can account for separately. `history` carries what is left of pi's own
// estimate once the parts we measured are taken out — the panel is explicitly approximate, and reporting 0 tokens
// against a conversation that plainly has some would be worse than an estimate.
function sections(report: SessionContextReport, toolCharacters: number): EffectiveContextSection[] {
  const systemTokens = estimateTokens(report.systemPromptChars);
  const toolTokens = estimateTokens(toolCharacters);
  const historyItems = report.messages.user + report.messages.assistant + report.messages.toolCalls;
  const remaining =
    report.contextTokens === null ? null : Math.max(0, report.contextTokens - systemTokens - toolTokens);
  return [
    { kind: "system", items: 1, characters: report.systemPromptChars, estimatedTokens: systemTokens },
    { kind: "tools", items: report.tools.length, characters: toolCharacters, estimatedTokens: toolTokens },
    ...(historyItems > 0
      ? [
          {
            kind: "history" as const,
            items: historyItems,
            characters: 0,
            estimatedTokens: remaining ?? 0,
          },
        ]
      : []),
  ];
}

export interface PiContextAppFacts {
  providerId: string;
  permissionMode: AIPermissionMode;
  // What the app put into the system prompt itself: the project's rules and memories, with their trust. The session
  // cannot report these — it only ever saw the composed prose.
  sources?: readonly EffectiveContextSource[];
}

// What a model cannot be asked to hold less than: this session's own system prompt and tool definitions, plus the
// room reserved for the answer. A model whose window is under that fails the NEXT TURN in the server's own words —
// gemma loaded at 4096 against pi's ~4.6k-token prompt answered `n_keep: 4639 >= n_ctx: 4096` — and both numbers are
// known at the moment of the pick: the prompt from the session's last report, the window from the provider.
//
// An ESTIMATE, at four characters per token, so this warns and never refuses: a real tokenizer may fit what this
// arithmetic says will not, and locking the user out of a model on those grounds would be worse than the failed turn.
export interface UndersizedWindow {
  contextWindow: number;
  requiredTokens: number;
}

export function undersizedWindow(
  context: EffectiveContextSnapshot | undefined,
  published: { contextWindow?: number; maxOutputTokens?: number },
): UndersizedWindow | undefined {
  const contextWindow = published.contextWindow;
  // Nothing to compare: an unknown window is not a small one, and a session that has not reported yet has no prompt
  // to measure.
  if (!contextWindow || !context) return undefined;
  const prompt = context.sections
    .filter((section) => section.kind === "system" || section.kind === "tools")
    .reduce((total, section) => total + section.estimatedTokens, 0);
  if (!prompt) return undefined;
  // The cap that will be in force for THAT model once it is registered — what the provider published, or the fallback
  // the container registers in its place.
  const requiredTokens = prompt + (published.maxOutputTokens ?? PI_FALLBACK_MAX_OUTPUT_TOKENS);
  return requiredTokens > contextWindow ? { contextWindow, requiredTokens } : undefined;
}

export function toEffectiveContext(
  report: SessionContextReport,
  facts: PiContextAppFacts,
  capturedAt: number,
): EffectiveContextSnapshot {
  const toolCharacters = report.tools.reduce((total, tool) => total + (tool.description?.length ?? 0), 0);
  const parts = sections(report, toolCharacters);
  return {
    providerId: facts.providerId,
    model: report.model,
    capturedAt,
    // A window of zero is pi saying it does not know one for this model, not a model with no room.
    window:
      report.contextWindow > 0
        ? {
            status: "known",
            maxInputTokens: Math.max(0, report.contextWindow - report.maxOutputTokens),
            reservedOutputTokens: report.maxOutputTokens,
            reservedFromProvider: report.providerMaxOutputTokens > 0,
          }
        : { status: "unknown" },
    sections: parts,
    totals: {
      characters: parts.reduce((total, section) => total + section.characters, 0),
      // pi's own estimate when it has one, so the budget line matches what pi would tell the user itself.
      estimatedTokens: report.contextTokens ?? parts.reduce((total, section) => total + section.estimatedTokens, 0),
    },
    sources: [...(facts.sources ?? [])],
    tools: report.tools.map(toolView),
    permissionMode: facts.permissionMode,
    // pi compacts on its own schedule and never says how many messages went; the flag is the honest half of that.
    truncation: { applied: report.compacted, omittedMessages: 0 },
  };
}
