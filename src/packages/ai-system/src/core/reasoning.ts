import { getProviderEntry } from "./providers";

export type ReasoningLevel = "default" | "low" | "medium" | "high";

export interface ReasoningCapability {
  kind: "none" | "effort";
  levels: readonly ReasoningLevel[];
}

export interface ReasoningThinking {
  enabled: boolean;
  effort: "low" | "medium" | "high";
}

const DEFAULT_ONLY = ["default"] as const;
const EFFORT_LEVELS = ["default", "low", "medium", "high"] as const;

export function isReasoningLevel(value: string): value is ReasoningLevel {
  return EFFORT_LEVELS.some((level) => level === value);
}

export function reasoningCapability(providerId: string, model: string): ReasoningCapability {
  const metadata = getProviderEntry(providerId)?.reasoning;
  const normalized = model.trim().toLowerCase();
  if (!metadata?.modelPrefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()))) {
    return { kind: "none", levels: DEFAULT_ONLY };
  }
  return { kind: metadata.kind, levels: EFFORT_LEVELS };
}

export function reasoningThinking(
  providerId: string,
  model: string,
  level: ReasoningLevel,
): ReasoningThinking | undefined {
  if (level === "default" || !reasoningCapability(providerId, model).levels.includes(level)) return undefined;
  return { enabled: true, effort: level };
}
