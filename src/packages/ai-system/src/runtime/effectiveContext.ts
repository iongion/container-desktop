import type { LLMMessage, LLMToolDef } from "@open-multi-agent/core";

import type {
  EffectiveContextSection,
  EffectiveContextSnapshot,
  EffectiveContextSource,
} from "@/ai-system/core/context";
import type { AIPermissionMode } from "@/ai-system/core/permissions";
import { WORKER_TOOL_CATALOGUE } from "@/ai-system/core/workerTools";
import type { Toolset } from "@/ai-system/runtime/tools/toolset";

const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;
const toolGroups = new Map(WORKER_TOOL_CATALOGUE.map((tool) => [tool.name, tool.group]));

function serializedCharacters(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

function section(kind: EffectiveContextSection["kind"], items: number, characters: number): EffectiveContextSection {
  return {
    kind,
    items,
    characters,
    estimatedTokens: Math.ceil(characters / APPROXIMATE_CHARACTERS_PER_TOKEN),
  };
}

interface EffectiveContextInput {
  providerId: string;
  model: string;
  systemPrompt: string;
  history: readonly LLMMessage[];
  historySummary?: string;
  omittedMessages?: number;
  turn: readonly LLMMessage[];
  tools?: readonly LLMToolDef[];
  toolset: Toolset | null;
  permissionMode: AIPermissionMode;
  sources?: readonly EffectiveContextSource[];
  capturedAt?: number;
}

export function buildEffectiveContextSnapshot(input: EffectiveContextInput): EffectiveContextSnapshot {
  const tools = (input.tools ?? []).filter((tool) => input.toolset?.has(tool.name));
  const sections = [
    section("system", 1, input.systemPrompt.length),
    section(
      "history",
      input.history.length + (input.historySummary ? 1 : 0),
      serializedCharacters(input.history) + (input.historySummary?.length ?? 0),
    ),
    section("turn", input.turn.length, serializedCharacters(input.turn)),
    section("tools", tools.length, serializedCharacters(tools)),
  ];
  const characters = sections.reduce((total, item) => total + item.characters, 0);
  return {
    providerId: input.providerId,
    model: input.model,
    capturedAt: input.capturedAt ?? Date.now(),
    window: { status: "unknown" },
    sections,
    totals: {
      characters,
      estimatedTokens: Math.ceil(characters / APPROXIMATE_CHARACTERS_PER_TOKEN),
    },
    sources: [...(input.sources ?? [])],
    tools: tools.map((tool) => ({
      name: tool.name,
      title: input.toolset?.title(tool.name) ?? tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      group: toolGroups.get(tool.name) ?? "other",
      gated: input.toolset?.gated(tool.name) ?? false,
    })),
    permissionMode: input.permissionMode,
    truncation: {
      applied: (input.omittedMessages ?? 0) > 0,
      omittedMessages: input.omittedMessages ?? 0,
    },
  };
}
