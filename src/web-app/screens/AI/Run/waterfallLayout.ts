import type { RunSpanView } from "@/ai-system/core/runEvents";

export interface WaterfallRow {
  key: string;
  span: RunSpanView;
  depth: number;
  parentKey?: string;
  hasChildren: boolean;
  offsetPercent?: number;
  widthPercent?: number;
  timingKnown: boolean;
  hierarchyIssue?: "unparented" | "cycle";
}

export interface WaterfallAttempt {
  attempt: number;
  startUnixMs?: number;
  endUnixMs?: number;
  durationMs?: number;
  rows: WaterfallRow[];
}

export interface WaterfallLayout {
  attempts: WaterfallAttempt[];
  issueCount: number;
}

export interface LimitedWaterfall {
  attempts: WaterfallAttempt[];
  visibleCount: number;
  remainingCount: number;
}

interface MutableNode {
  span: RunSpanView;
  parentKey?: string;
  hierarchyIssue?: WaterfallRow["hierarchyIssue"];
}

interface AttemptHierarchy {
  roots: MutableNode[];
  children: Map<string, MutableNode[]>;
}

interface AttemptTiming {
  startUnixMs?: number;
  endUnixMs?: number;
  durationMs?: number;
  scaleDuration: number;
}

const clamp = (minimum: number, maximum: number, value: number) => Math.min(maximum, Math.max(minimum, value));

function compareSpans(left: RunSpanView, right: RunSpanView): number {
  const leftStart = left.startUnixMs ?? Number.POSITIVE_INFINITY;
  const rightStart = right.startUnixMs ?? Number.POSITIVE_INFINITY;
  return leftStart - rightStart || left.key.localeCompare(right.key);
}

function breakCycles(nodes: Map<string, MutableNode>) {
  for (const key of [...nodes.keys()].sort()) {
    const seen = new Set<string>();
    let current = nodes.get(key);
    while (current?.parentKey) {
      if (seen.has(current.parentKey)) {
        current.parentKey = undefined;
        current.hierarchyIssue = "cycle";
        break;
      }
      seen.add(current.span.key);
      current = nodes.get(current.parentKey);
    }
  }
}

function buildHierarchy(sorted: RunSpanView[]): AttemptHierarchy {
  const nodes = new Map<string, MutableNode>(sorted.map((span) => [span.key, { span, parentKey: span.parentKey }]));
  for (const node of nodes.values()) {
    if (node.parentKey && !nodes.has(node.parentKey)) {
      node.parentKey = undefined;
      node.hierarchyIssue = "unparented";
    }
  }
  breakCycles(nodes);
  const children = new Map<string, MutableNode[]>();
  const roots: MutableNode[] = [];
  for (const node of nodes.values()) {
    if (!node.parentKey) {
      roots.push(node);
      continue;
    }
    const siblings = children.get(node.parentKey) ?? [];
    siblings.push(node);
    children.set(node.parentKey, siblings);
  }
  roots.sort((left, right) => compareSpans(left.span, right.span));
  for (const siblings of children.values()) siblings.sort((left, right) => compareSpans(left.span, right.span));
  return { roots, children };
}

function attemptTiming(sorted: RunSpanView[]): AttemptTiming {
  const starts = sorted.flatMap((span) => (span.startUnixMs === undefined ? [] : [span.startUnixMs]));
  const ends = sorted.flatMap((span) => {
    if (span.endUnixMs !== undefined) return [span.endUnixMs];
    return span.startUnixMs !== undefined && span.durationMs !== undefined ? [span.startUnixMs + span.durationMs] : [];
  });
  const startUnixMs = starts.length > 0 ? Math.min(...starts) : undefined;
  const endUnixMs = ends.length > 0 ? Math.max(...ends) : undefined;
  const durationMs =
    startUnixMs !== undefined && endUnixMs !== undefined ? Math.max(0, endUnixMs - startUnixMs) : undefined;
  return { startUnixMs, endUnixMs, durationMs, scaleDuration: Math.max(1, durationMs ?? 0) };
}

function rowTiming(span: RunSpanView, timing: AttemptTiming) {
  const attemptStart = timing.startUnixMs;
  const spanStart = span.startUnixMs;
  const timingKnown = attemptStart !== undefined && spanStart !== undefined;
  const offsetPercent =
    attemptStart !== undefined && spanStart !== undefined
      ? clamp(0, 100, ((spanStart - attemptStart) / timing.scaleDuration) * 100)
      : undefined;
  const actualDuration =
    span.durationMs ??
    (span.startUnixMs !== undefined && span.endUnixMs !== undefined
      ? Math.max(0, span.endUnixMs - span.startUnixMs)
      : undefined);
  const widthPercent =
    offsetPercent !== undefined && actualDuration !== undefined
      ? clamp(0.35, 100 - offsetPercent, (actualDuration / timing.scaleDuration) * 100)
      : undefined;
  return { timingKnown, offsetPercent, widthPercent };
}

function flattenRows(hierarchy: AttemptHierarchy, timing: AttemptTiming): WaterfallRow[] {
  const rows: WaterfallRow[] = [];
  const visit = (node: MutableNode, depth: number) => {
    const span = node.span;
    const spanTiming = rowTiming(span, timing);
    const childNodes = hierarchy.children.get(span.key) ?? [];
    rows.push({
      key: span.key,
      span,
      depth,
      ...(node.parentKey ? { parentKey: node.parentKey } : {}),
      hasChildren: childNodes.length > 0,
      ...(spanTiming.offsetPercent !== undefined ? { offsetPercent: spanTiming.offsetPercent } : {}),
      ...(spanTiming.widthPercent !== undefined ? { widthPercent: spanTiming.widthPercent } : {}),
      timingKnown: spanTiming.timingKnown,
      ...(node.hierarchyIssue ? { hierarchyIssue: node.hierarchyIssue } : {}),
    });
    for (const child of childNodes) visit(child, depth + 1);
  };
  for (const root of hierarchy.roots) visit(root, 0);
  return rows;
}

function attemptLayout(attempt: number, spans: RunSpanView[]): WaterfallAttempt {
  const sorted = [...spans].sort(compareSpans);
  const timing = attemptTiming(sorted);
  return {
    attempt,
    ...(timing.startUnixMs !== undefined ? { startUnixMs: timing.startUnixMs } : {}),
    ...(timing.endUnixMs !== undefined ? { endUnixMs: timing.endUnixMs } : {}),
    ...(timing.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
    rows: flattenRows(buildHierarchy(sorted), timing),
  };
}

export function buildWaterfall(spans: ReadonlyArray<RunSpanView>): WaterfallLayout {
  const grouped = new Map<number, RunSpanView[]>();
  for (const span of spans) {
    const attempt = grouped.get(span.attempt) ?? [];
    attempt.push(span);
    grouped.set(span.attempt, attempt);
  }
  const attempts = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([attempt, attemptSpans]) => attemptLayout(attempt, attemptSpans));
  return {
    attempts,
    issueCount: attempts.reduce(
      (total, attempt) => total + attempt.rows.filter((row) => row.hierarchyIssue !== undefined).length,
      0,
    ),
  };
}

export function limitWaterfall(layout: WaterfallLayout, limit: number): LimitedWaterfall {
  let remaining = Math.max(0, Math.trunc(limit));
  let visibleCount = 0;
  const attempts: WaterfallAttempt[] = [];
  for (const attempt of layout.attempts) {
    if (remaining === 0) break;
    const rows = attempt.rows.slice(0, remaining);
    if (rows.length > 0) attempts.push({ ...attempt, rows });
    visibleCount += rows.length;
    remaining -= rows.length;
  }
  const total = layout.attempts.reduce((count, attempt) => count + attempt.rows.length, 0);
  return { attempts, visibleCount, remainingCount: Math.max(0, total - visibleCount) };
}
