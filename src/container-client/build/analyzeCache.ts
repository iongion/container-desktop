// Pure cache-miss analysis — the headline diagnostic. Given the parsed steps (and optionally the
// Containerfile AST), it reports how many layers cached vs rebuilt, where caching first broke, WHY it likely
// broke, and the downstream cascade the miss forced. The cascade respects stage boundaries: once a stage's
// cache breaks every later step IN THAT STAGE rebuilds, but an independent stage (its steps still cached)
// is untouched — detected by stopping the cascade at the next cached step or the next FROM.

import type { BuildStep, CacheAnalysis, CacheBreaker, CacheBreakerCause, ContainerfileAst } from "./types";

// Strip the engine's step-label decoration (`[1/4]`, `#3`, `STEP 1/4:`) to the bare instruction.
function coreInstruction(name: string): string {
  return name
    .replace(/^\s*\[\d+\/\d+\]\s*/, "")
    .replace(/^\s*#\d+\s*/, "")
    .replace(/^\s*STEP\s+\d+\/\d+:\s*/i, "")
    .trim();
}

function keyword(name: string): string {
  return (coreInstruction(name).split(/\s+/)[0] ?? "").toUpperCase();
}

function isFromStep(step: BuildStep): boolean {
  return keyword(step.name) === "FROM";
}

function classify(kw: string): { cause: CacheBreakerCause; fixHint: string } {
  switch (kw) {
    case "COPY":
    case "ADD":
      return {
        cause: "context-changed",
        fixHint: "A file this step copies changed. Copy just the dependency manifest before this, install, then copy the rest.",
      };
    case "RUN":
      return {
        cause: "command-changed",
        fixHint: "The command text or an earlier layer changed. Keep volatile commands late and pin what they depend on.",
      };
    case "FROM":
      return {
        cause: "base-image-updated",
        fixHint: "The base image was re-pulled. Pin it to a digest to keep the cache stable.",
      };
    case "ARG":
      return {
        cause: "build-arg-changed",
        fixHint: "A build-arg this step uses changed. Declare ARGs as late as possible so they invalidate less.",
      };
    default:
      return { cause: "unknown", fixHint: "This layer was rebuilt — inspect its inputs to see what changed." };
  }
}

export function analyzeCache(steps: BuildStep[], ast?: ContainerfileAst): CacheAnalysis {
  const cachedCount = steps.filter((step) => step.cached).length;
  const rebuiltCount = steps.filter((step) => !step.cached).length;
  const firstMissIndex = steps.findIndex((step) => !step.cached);

  if (firstMissIndex === -1) {
    return { cachedCount, rebuiltCount: 0, firstMissIndex, cascadeKeys: [] };
  }

  const miss = steps[firstMissIndex];
  const name = coreInstruction(miss.name) || miss.name;
  const { cause, fixHint } = classify(keyword(miss.name));

  // Enrich the hint when the AST pins the offending instruction to a cross-stage COPY.
  let hint = fixHint;
  if (ast) {
    const match = ast.instructions.find((instruction) => coreInstruction(instruction.raw).startsWith(name));
    if (match?.flags?.from) {
      hint = `This step copies from stage "${match.flags.from}", which rebuilt — fix the cache break there first.`;
    }
  }

  const breaker: CacheBreaker = { stepKey: miss.key, name, likelyCause: cause, fixHint: hint };

  const cascadeKeys = [miss.key];
  for (let i = firstMissIndex + 1; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.cached || isFromStep(step)) {
      break; // cache resumed / new stage → independent, not part of this cascade
    }
    cascadeKeys.push(step.key);
  }

  return { cachedCount, rebuiltCount, firstMissIndex, breaker, cascadeKeys };
}
