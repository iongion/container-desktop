import type { Money } from "@/ai-system/core/cost";

export function compactTokens(value: number): string {
  return value >= 1_000 ? `${Math.round(value / 100) / 10}k` : String(value);
}

export function formatDurationMs(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1_000) return `${Math.round(value)} ms`;
  if (value < 60_000) return `${Math.round(value / 100) / 10} s`;
  if (value < 3_600_000) return `${Math.round(value / 6_000) / 10} min`;
  return `${Math.round(value / 360_000) / 10} hr`;
}

export function formatCost(value: Money | undefined): string {
  if (!value || !Number.isFinite(value.amount) || value.amount < 0 || !value.currency.trim()) return "—";
  return `${value.currency.toUpperCase()} ${value.amount.toFixed(4)}`;
}
