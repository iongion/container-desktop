// Reading the DATA one of pi's own commands answered with. `PiCommandResult.data` is `unknown` by design — the
// commands answer with whatever they are about — so the few answers the GUI acts on are recognised here, once,
// instead of being narrowed inline in a component where nothing can test the narrowing.
//
// The shape is a claim, not a guarantee: it crossed a socket from a container. An answer that does not hold up is not
// an error, it is simply not this kind of answer.

import type {
  PiForkPoint,
  PiProjectTrust,
  PiScopedModels,
  PiSessionSettings,
  PiSessionSummary,
  PiSessionTreeNode,
} from "@/pi-bridge/protocol";

// What a bare `/fork`, `/tree` or `/resume` answered: the points the session can be moved to, and which question
// was asked. A session on disk is such a point too — it is where the conversation goes next.
export type PiSessionPointsAnswer =
  | { kind: "fork"; points: PiForkPoint[] }
  | { kind: "tree"; nodes: PiSessionTreeNode[] }
  | { kind: "sessions"; sessions: PiSessionSummary[] };

function entries(data: unknown, key: string): unknown[] | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
}

// The state answers are single objects rather than sets, so an array under the key is not this kind of answer.
function record(data: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function isQueueMode(value: unknown): value is "all" | "one-at-a-time" {
  return value === "all" || value === "one-at-a-time";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isForkPoint(value: unknown): value is PiForkPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.entryId === "string" && typeof point.text === "string";
}

function isTreeNode(value: unknown): value is PiSessionTreeNode {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  // `id` is what a branch switch is named by and `children` is what makes it a tree; without either there is nothing
  // a picker could do with the row.
  return typeof node.id === "string" && typeof node.kind === "string" && Array.isArray(node.children);
}

function isSessionSummary(value: unknown): value is PiSessionSummary {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;
  // `path` is what a resume is named by, and `current` is what lets the picker say "you are here" instead of
  // offering to reopen what is already running.
  return (
    typeof session.path === "string" &&
    typeof session.id === "string" &&
    typeof session.modified === "string" &&
    typeof session.messageCount === "number" &&
    typeof session.firstMessage === "string" &&
    typeof session.current === "boolean"
  );
}

function isScopedModel(value: unknown): value is PiScopedModels["available"][number] {
  if (typeof value !== "object" || value === null) return false;
  const model = value as Record<string, unknown>;
  return typeof model.id === "string" && typeof model.name === "string" && typeof model.provider === "string";
}

export function readSessionTreeAnswer(data: unknown): PiSessionPointsAnswer | undefined {
  const points = entries(data, "forkPoints");
  if (points) return points.every(isForkPoint) ? { kind: "fork", points: points as PiForkPoint[] } : undefined;
  const nodes = entries(data, "tree");
  if (nodes) return nodes.every(isTreeNode) ? { kind: "tree", nodes: nodes as PiSessionTreeNode[] } : undefined;
  const sessions = entries(data, "sessions");
  if (sessions) {
    return sessions.every(isSessionSummary)
      ? { kind: "sessions", sessions: sessions as PiSessionSummary[] }
      : undefined;
  }
  return undefined;
}

// What a bare `/settings` answered. Every field is checked because a drawer that renders half of pi's settings is
// worse than one that says it could not read them.
export function readSessionSettingsAnswer(data: unknown): PiSessionSettings | undefined {
  const settings = record(data, "settings");
  if (!settings) return undefined;
  if (typeof settings.autoCompaction !== "boolean") return undefined;
  if (!isQueueMode(settings.steeringMode) || !isQueueMode(settings.followUpMode)) return undefined;
  if (typeof settings.thinkingLevel !== "string" || !isStringArray(settings.availableThinkingLevels)) return undefined;
  return {
    autoCompaction: settings.autoCompaction,
    steeringMode: settings.steeringMode,
    followUpMode: settings.followUpMode,
    thinkingLevel: settings.thinkingLevel,
    availableThinkingLevels: settings.availableThinkingLevels,
  };
}

// What `/trust` answered. `decision: null` is "never decided", which is NOT a decided no — the drawer says so, so
// it travels through rather than being rejected as a missing field.
export function readProjectTrustAnswer(data: unknown): PiProjectTrust | undefined {
  const trust = record(data, "trust");
  if (!trust) return undefined;
  if (trust.decision !== null && typeof trust.decision !== "boolean") return undefined;
  if (typeof trust.matters !== "boolean" || typeof trust.path !== "string") return undefined;
  return { decision: trust.decision, matters: trust.matters, path: trust.path };
}

// What `/scoped-models` answered. An empty `scoped` is pi cycling everything, which is its own default.
export function readScopedModelsAnswer(data: unknown): PiScopedModels | undefined {
  const models = record(data, "models");
  if (!models) return undefined;
  const { available, scoped } = models;
  if (!Array.isArray(available) || !available.every(isScopedModel)) return undefined;
  if (!isStringArray(scoped)) return undefined;
  return { available: available as PiScopedModels["available"], scoped };
}
