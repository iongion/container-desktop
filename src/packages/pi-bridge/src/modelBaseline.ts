// What pi's OWN catalogue already knows about a model, so a registration stops inventing one.
//
// pi ships generated per-model data for 37 providers — the window, the completion cap, the rates, and whether the
// model reasons and how hard (`pi-ai/providers/data/*.json`, read through `getBuiltinModel`). Until now none of it
// reached us: `piModelConfig` registers under a synthetic gateway id, so pi's composer finds no base layer and every
// number the app had not probed fell back to `PI_FALLBACK_CONTEXT_WINDOW` and a zero price.
//
// This is the FLOOR, never the answer. A live probe asks a running server what it will actually accept — an LM Studio
// model loaded at 8192 out of a possible 262144 — and no generated snapshot can know that. `adapters/modelWindow`
// layers the two: this underneath, the provider's own reply on top.
//
// Only the FACTS travel. pi's minimax entry speaks `anthropic-messages` while our own minimax provider is
// OpenAI-shaped, so inheriting `api` would hand an Anthropic field to an OpenAI upstream; `baseUrl` is the gateway's
// business and `compat` is `piUpstreamCompat`'s. A model's window, price and reasoning are properties of the MODEL,
// which is why they carry across a different endpoint serving it.

import type { Api, Model } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { BuiltinProvider } from "@earendil-works/pi-ai/providers/all";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { MINIMAX_MODELS } from "@earendil-works/pi-ai/providers/minimax.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { ZAI_MODELS } from "@earendil-works/pi-ai/providers/zai.models";

import { type PiModelReasoning, piThinkingLevels } from "@/pi-bridge/protocol";

// The registration fields a baseline can fill, in `PiModelRegistration`'s own names so they flow into a model window
// and onto the wire without conversion. Declared here rather than imported from `ai-system` because the dependency
// runs the other way: the app reads pi, pi never reads the app.
export interface PiModelBaseline {
  contextWindow?: number;
  maxOutputTokens?: number;
  pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  reasoning?: PiModelReasoning;
}

// Our provider ids onto pi's. Four are the same word; `glm` is pi's `zai`, whose catalogue carries the same GLM ids,
// which is what makes this a reading of pi's data rather than a claim of our own.
//
// Absent on purpose: `lmstudio` and `llamacpp`, which pi does not carry at all, and `openrouter`, whose own listing
// publishes the window, the cap, the price AND the reasoning efforts live — a generated snapshot could only be
// staler, and its data alone is 120K.
//
// Kept beside the catalogues below as the record of WHICH pi provider each one is, and cross-checked against pi's own
// accessor in the test: importing one provider's catalogue under another's name is the mistake this catches.
export const PI_BASELINE_PROVIDERS: Record<string, BuiltinProvider> = {
  anthropic: "anthropic",
  openai: "openai",
  deepseek: "deepseek",
  glm: "zai",
  minimax: "minimax",
};

// The five catalogues themselves, imported one module each. `providers/all` would have been the obvious read, but its
// `MODELS` pulls every one of the 37 generated data files into the graph — 552K of JSON in the renderer bundle to
// answer about five providers. These are the same entries, without the other 32.
const PI_BASELINE_CATALOGUES: Record<string, Record<string, Model<Api>>> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  deepseek: DEEPSEEK_MODELS,
  glm: ZAI_MODELS,
  minimax: MINIMAX_MODELS,
};

function usable(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function rate(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

// pi already defaults every rate to zero, so an all-zero cost is not a published price — the same reading
// `modelWindow`'s own `pricingOf` takes of a provider that charges nothing.
function baselinePricing(cost: Model<Api>["cost"] | undefined): PiModelBaseline["pricing"] {
  const input = rate(cost?.input);
  const output = rate(cost?.output);
  if (!input && !output) return undefined;
  const cacheRead = rate(cost?.cacheRead);
  const cacheWrite = rate(cost?.cacheWrite);
  return {
    input: input ?? 0,
    output: output ?? 0,
    ...(cacheRead ? { cacheRead } : {}),
    ...(cacheWrite ? { cacheWrite } : {}),
  };
}

// pi's own availability rule, reused rather than restated: `getSupportedThinkingLevels` withdraws a level its
// `thinkingLevelMap` maps to null, offers `xhigh`/`max` only when the map names them, and leaves an unnamed level
// standing. A model whose `off` is withdrawn is one that always reasons, which is exactly what `mandatory` says.
function baselineReasoning(model: Model<Api>): PiModelReasoning | undefined {
  if (!model.reasoning) return undefined;
  const supported = getSupportedThinkingLevels(model);
  const levels = piThinkingLevels(supported);
  return {
    ...(levels.length ? { levels } : {}),
    ...(supported.includes("off") ? {} : { mandatory: true }),
  };
}

// A baseline answers with what pi published or with nothing at all: an empty object would read as "asked and
// answered", which is the one thing it must not be confused with.
export function piModelBaselineFacts(model: Model<Api>): PiModelBaseline | undefined {
  const facts: PiModelBaseline = {};
  const contextWindow = usable(model.contextWindow);
  const maxOutputTokens = usable(model.maxTokens);
  const pricing = baselinePricing(model.cost);
  const reasoning = baselineReasoning(model);
  if (contextWindow) facts.contextWindow = contextWindow;
  if (maxOutputTokens) facts.maxOutputTokens = maxOutputTokens;
  if (pricing) facts.pricing = pricing;
  if (reasoning) facts.reasoning = reasoning;
  return Object.keys(facts).length ? facts : undefined;
}

export function piModelBaseline(providerId: string, modelId: string): PiModelBaseline | undefined {
  if (!modelId.trim()) return undefined;
  const model = PI_BASELINE_CATALOGUES[providerId]?.[modelId];
  return model ? piModelBaselineFacts(model) : undefined;
}
