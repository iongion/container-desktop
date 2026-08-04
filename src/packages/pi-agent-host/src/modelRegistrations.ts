// The models this container's gateway provider is registered with, and how the app's view of one becomes pi's.
//
// The set grows by USE: the model the container was started on, plus each one the user has since picked. Nothing
// pre-registers a provider's catalogue — the app's picker is a drill-down precisely so a catalogue is read one level
// at a time, on demand, and a session that registered hundreds of models the user never asked for would undo that.
//
// Kept out of `session.ts` because merging an entry and mapping a shape are decisions worth testing without a live
// session.

import type { PiModelRegistration } from "@/pi-bridge/protocol";

// pi's own defaults, mirrored because its ProviderModelConfig requires both numbers even when nobody knows them
// (provider-composer.js: `definition.contextWindow ?? 128000`). Used ONLY so pi has something to compact against —
// never reported to the user as this model's budget.
const PI_FALLBACK_CONTEXT_WINDOW = 128000;
const PI_FALLBACK_MAX_OUTPUT_TOKENS = 4096;

export type ModelRegistrations = ReadonlyMap<string, PiModelRegistration>;

// Add a model to the registered set, or update the one already there. What the app has learned survives what it did
// not say this time: a later switch back to a model carries only its id when the provider published nothing new, and
// taking that literally would report a window it had already answered as unknown again.
//
// Position is kept for a model already in the set, so the list a picker or `/scoped-models` renders does not reshuffle
// under the user every time they switch.
export function withModelRegistration(
  held: ModelRegistrations,
  model: PiModelRegistration,
): Map<string, PiModelRegistration> {
  const next = new Map(held);
  next.set(model.id, { ...next.get(model.id), ...model });
  return next;
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
