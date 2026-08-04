// The models this container's gateway provider is registered with, and how the app's view of them becomes pi's.
//
// The app is the authority on what its provider serves: it has just asked the provider's own listing, and it is the
// only side that can ask what a model's budget and rates are — the gateway forwards the completions API and nothing
// else. So what is held here is a cache of what the app said, kept out of `session.ts` because merging a set and
// mapping a shape are decisions worth testing without a live session.

import type { PiModelRegistration } from "@/pi-bridge/protocol";

// pi's own defaults, mirrored because its ProviderModelConfig requires both numbers even when nobody knows them
// (provider-composer.js: `definition.contextWindow ?? 128000`). Used ONLY so pi has something to compact against —
// never reported to the user as this model's budget.
const PI_FALLBACK_CONTEXT_WINDOW = 128000;
const PI_FALLBACK_MAX_OUTPUT_TOKENS = 4096;

export type ModelRegistrations = ReadonlyMap<string, PiModelRegistration>;

// Take the app's set as the registered one, keeping what is already known about a model that survives: the app
// probes a window only when it switches to a model, so a later re-discovery says nothing about the ones it learned
// earlier, and taking that literally would report every window as unknown again.
//
// `liveId` is the model the session is running against. It survives any list, because a set that no longer mentions
// it would leave the conversation pointing at a model its own provider does not register.
export function mergeModelRegistrations(
  held: ModelRegistrations,
  incoming: readonly PiModelRegistration[],
  liveId: string,
): Map<string, PiModelRegistration> {
  if (incoming.length === 0) throw new Error("a registration with no models would leave the session nothing to run");
  const merged = new Map<string, PiModelRegistration>();
  const live = held.get(liveId);
  if (live) merged.set(liveId, live);
  for (const model of incoming) {
    const previous = held.get(model.id);
    merged.set(model.id, previous ? { ...previous, ...model } : model);
  }
  return merged;
}

// One registration as pi's provider composer wants it. `name` is the id: the provider listings carry an id and
// nothing more, and inventing a prettier label would be this app's words in pi's mouth. `reasoning` is false for
// every model — the app knows it only for a couple of OpenAI prefixes, and claiming it elsewhere would be fiction.
export function piModelConfig(model: PiModelRegistration) {
  return {
    id: model.id,
    name: model.id,
    reasoning: false,
    input: ["text" as const],
    // pi multiplies these by the token counts to bill a turn, so all-zero is what made every session report $0.00
    // whatever it really cost. Zero stays the honest answer for a free model.
    cost: {
      input: model.pricing?.input ?? 0,
      output: model.pricing?.output ?? 0,
      cacheRead: model.pricing?.cacheRead ?? 0,
      cacheWrite: model.pricing?.cacheWrite ?? 0,
    },
    // What the PROVIDER said, falling back to pi's own defaults because its ProviderModelConfig requires both
    // numbers. The fallback is NOT passed on to the user: the report carries only what the provider actually
    // published, so the panel says "unknown" rather than repeating a guess.
    contextWindow: model.contextWindow ?? PI_FALLBACK_CONTEXT_WINDOW,
    maxTokens: model.maxOutputTokens ?? PI_FALLBACK_MAX_OUTPUT_TOKENS,
  };
}
