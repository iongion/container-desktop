// What a model row says about itself, in as few characters as a menu row can spare.
//
// Every number here was published by somebody — pi's catalogue or the provider's own listing (see
// `pi-bridge/modelBaseline` and `adapters/modelWindow`). Nothing is derived or guessed, so a model nobody
// published anything for gets no second line at all rather than a row of dashes.

import type { PiModelBaseline } from "@/pi-bridge/modelBaseline";

export interface ModelFactsSummary {
  // "1M ctx", "128k out", "$10/$50", "free" — in reading order, already prose.
  parts: string[];
  // Present when the model reasons; the hardest level it accepts, or "" when nobody named one.
  thinks?: string;
}

// A window is read at a glance, so a round million or thousand is said that way. A server's own odd number is
// NOT rounded — LM Studio loading 8192 must not read as "8k", which would be a number it never said.
export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${trimZeroes(value / 1_000_000, 2)}M`;
  }
  if (value >= 100_000) {
    return `${trimZeroes(value / 1_000, 1)}k`;
  }
  return value.toLocaleString("en-US");
}

function trimZeroes(value: number, digits: number): string {
  return Number.parseFloat(value.toFixed(digits)).toString();
}

function rate(value: number | undefined): string {
  return `$${Number.parseFloat((value ?? 0).toFixed(4))}`;
}

export function formatModelFacts(facts: PiModelBaseline | undefined): ModelFactsSummary {
  const parts: string[] = [];
  if (facts?.contextWindow) {
    parts.push(`${formatTokenCount(facts.contextWindow)} ctx`);
  }
  if (facts?.maxOutputTokens) {
    parts.push(`${formatTokenCount(facts.maxOutputTokens)} out`);
  }
  const pricing = facts?.pricing;
  if (pricing) {
    // pi prices a free model at zero and so does a local server; "free" is the honest reading of that, and it is
    // not the same as a price nobody published, which yields no part at all.
    parts.push(pricing.input || pricing.output ? `${rate(pricing.input)}/${rate(pricing.output)}` : "free");
  }
  const levels = facts?.reasoning?.levels;
  return {
    parts,
    ...(facts?.reasoning ? { thinks: levels?.length ? levels[levels.length - 1] : "" } : {}),
  };
}
