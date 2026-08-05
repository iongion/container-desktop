// What pi's OWN catalogue already knows about a model, so a registration stops inventing one.
//
// pi ships generated per-model data for 37 providers — the window, the completion cap, the rates, and whether the
// model reasons and how hard (`providers/data/*.json`, reached through `piProviderCatalogue`). Until now none of it
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

import { piProvider } from "@/pi-bridge/piProviderCatalogue";
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

// Where our provider id is not pi's word for the same thing. Ours is `glm`; pi's is `zai`, whose catalogue carries
// the same GLM ids — which is what makes this a reading of pi's data rather than a claim of our own. Every other id
// we ship either matches pi's or has no pi entry at all (`lmstudio`, `llamacpp`), and an unmapped id simply finds
// nothing, so a wrong guess answers nothing rather than wrongly.
const PI_PROVIDER_ALIASES: Record<string, string> = { glm: "zai" };

export function piProviderIdFor(providerId: string): string {
  return PI_PROVIDER_ALIASES[providerId] ?? providerId;
}

// An AGGREGATOR's terms are the aggregator's, not the underlying model's: the same model is served at different
// windows, caps and prices per route, and several are free where the vendor charges. Its own listing publishes all
// of that live, so a snapshot underneath could only contradict it — a price reported for a route that serves the
// model free is exactly the fiction the probe exists to avoid. Detected the way pi's own ids show it: an
// aggregator's model ids carry the vendor prefix.
function isAggregator(pi: { models: readonly Model<Api>[] }): boolean {
  return pi.models.some((model) => model.id.includes("/"));
}

function catalogueModel(providerId: string, modelId: string): Model<Api> | undefined {
  const pi = piProvider(piProviderIdFor(providerId));
  if (!pi || isAggregator(pi)) return undefined;
  return pi.models.find((model) => model.id === modelId);
}

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

// The models pi publishes for one of our providers, in pi's own order. A provider with no key configured is browsed
// from this instead of being the dead end it used to be, and a provider pi does not carry answers with nothing —
// which is what keeps the picker's own "couldn't reach it" state meaningful.
export function piProviderModelIds(providerId: string): string[] {
  return (piProvider(piProviderIdFor(providerId))?.models ?? []).map((model) => model.id);
}

export function piModelBaseline(providerId: string, modelId: string): PiModelBaseline | undefined {
  if (!modelId.trim()) return undefined;
  const model = catalogueModel(providerId, modelId);
  return model ? piModelBaselineFacts(model) : undefined;
}
