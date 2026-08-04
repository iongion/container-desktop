// Reading the DATA one of pi's own commands answered with. `PiCommandResult.data` is `unknown` by design — the
// commands answer with whatever they are about — so the few answers the GUI acts on are recognised here, once,
// instead of being narrowed inline in a component where nothing can test the narrowing.
//
// The shape is a claim, not a guarantee: it crossed a socket from a container. An answer that does not hold up is not
// an error, it is simply not this kind of answer.

import type { PiForkPoint, PiSessionTreeNode } from "@/pi-bridge/protocol";

// What a bare `/fork` or `/tree` answered: the points the session can be moved to, and which question was asked.
export type PiSessionPointsAnswer =
  | { kind: "fork"; points: PiForkPoint[] }
  | { kind: "tree"; nodes: PiSessionTreeNode[] };

function entries(data: unknown, key: string): unknown[] | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const value = (data as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : undefined;
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

export function readSessionTreeAnswer(data: unknown): PiSessionPointsAnswer | undefined {
  const points = entries(data, "forkPoints");
  if (points) return points.every(isForkPoint) ? { kind: "fork", points: points as PiForkPoint[] } : undefined;
  const nodes = entries(data, "tree");
  if (nodes) return nodes.every(isTreeNode) ? { kind: "tree", nodes: nodes as PiSessionTreeNode[] } : undefined;
  return undefined;
}
