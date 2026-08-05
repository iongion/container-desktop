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

// Four decimals is the right scale for a turn that cost cents, and a lie for one that cost fractions of one: a cheap
// model on a short turn lands in the sixth decimal place and used to print the same "0.0000" a free local model gets.
// Below what four decimals can hold, the amount is shown to two significant digits instead — so only a genuinely
// free turn reads as zero.
export function formatCost(value: Money | undefined): string {
  if (!value || !Number.isFinite(value.amount) || value.amount < 0 || !value.currency.trim()) return "—";
  const currency = value.currency.toUpperCase();
  const rounded = value.amount.toFixed(4);
  if (value.amount === 0 || Number.parseFloat(rounded) > 0) return `${currency} ${rounded}`;
  // Widened by magnitude rather than through toPrecision, which switches to exponential below 1e-6 — "USD 6.0e-7" is
  // not a price. toFixed refuses past 100 decimals, which no real rate reaches.
  const decimals = Math.min(100, 1 - Math.floor(Math.log10(value.amount)));
  return `${currency} ${value.amount.toFixed(decimals)}`;
}
