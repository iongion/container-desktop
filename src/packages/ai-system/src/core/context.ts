import type { Money } from "./cost";
import type { AIPermissionMode } from "./permissions";
import type { WorkerToolGroup } from "./workerTools";

export type EffectiveContextSectionKind = "system" | "history" | "turn" | "tools";
export type EffectiveContextSourceKind =
  | "os"
  | "engine"
  | "connection"
  | "screen"
  | "activity"
  | "resources"
  | "errors"
  | "rules"
  | "memory"
  | "skill";
export type ContextTrust = "application" | "external" | "user" | "project";

export interface EffectiveContextSource {
  kind: EffectiveContextSourceKind;
  trust: ContextTrust;
  characters: number;
}

export interface EffectiveContextSection {
  kind: EffectiveContextSectionKind;
  items: number;
  characters: number;
  estimatedTokens: number;
}

export interface EffectiveToolView {
  name: string;
  title: string;
  description?: string;
  group: WorkerToolGroup | "other";
  gated: boolean;
}

export interface EffectiveContextSnapshot {
  providerId: string;
  model: string;
  capturedAt: number;
  window: { status: "known"; maxInputTokens: number; reservedOutputTokens: number } | { status: "unknown" };
  sections: EffectiveContextSection[];
  totals: { characters: number; estimatedTokens: number };
  sources: EffectiveContextSource[];
  tools: EffectiveToolView[];
  permissionMode: AIPermissionMode;
  truncation: { applied: boolean; omittedMessages: number };
}

export interface ThreadUsageSnapshot {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costs: Money[];
}
