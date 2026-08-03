import type { Money } from "@/ai-system/core/cost";
import type { RunView } from "@/ai-system/core/runEvents";
import { uniqueStrings } from "@/utils/uniqueStrings";

const TERMINAL_PHASES = new Set<RunView["phase"]>(["done", "error", "stopped"]);

export function runDuration(view: RunView, now = Date.now()): number | undefined {
  const starts = [...view.tasks.map((task) => task.startedAt), ...view.spans.map((span) => span.startUnixMs)].filter(
    (value): value is number => value !== undefined,
  );
  if (starts.length === 0) return undefined;
  const ends = [...view.tasks.map((task) => task.endedAt), ...view.spans.map((span) => span.endUnixMs)].filter(
    (value): value is number => value !== undefined,
  );
  if (TERMINAL_PHASES.has(view.phase) && ends.length === 0) return undefined;
  const end = TERMINAL_PHASES.has(view.phase) ? Math.max(...ends) : now;
  return Math.max(0, end - Math.min(...starts));
}

export function totalRunCost(view: RunView): Money | undefined {
  const spanCosts = view.spans.flatMap((span) => (span.kind === "llm" && span.cost ? [span.cost] : []));
  const costs = spanCosts.length > 0 ? spanCosts : view.tasks.flatMap((task) => (task.cost ? [task.cost] : []));
  const currencies = uniqueStrings(costs.map((cost) => cost.currency));
  if (currencies.length !== 1) return undefined;
  return { currency: currencies[0], amount: costs.reduce((sum, cost) => sum + cost.amount, 0) };
}
