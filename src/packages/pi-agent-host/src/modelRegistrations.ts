// The models this container's gateway provider is registered with, and how the app's view of one becomes pi's.
//
// The set grows by USE: the model the container was started on, plus each one the user has since picked. Nothing
// pre-registers a provider's catalogue — the app's picker is a drill-down precisely so a catalogue is read one level
// at a time, on demand, and a session that registered hundreds of models the user never asked for would undo that.
//
// Kept out of `session.ts` because merging an entry and mapping a shape are decisions worth testing without a live
// session.

import type { ThinkingLevelMap } from "@earendil-works/pi-ai";

import {
  PI_FALLBACK_CONTEXT_WINDOW,
  PI_FALLBACK_MAX_OUTPUT_TOKENS,
  PI_THINKING_LEVELS,
  type PiModelReasoning,
  type PiModelRegistration,
  piThinkingLevels,
} from "@/pi-bridge/protocol";
import { piUpstreamCompat } from "@/pi-bridge/upstreamCompat";

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

// The reasoning the app published, as it arrives in the agent's ENVIRONMENT: the model a container is born on is
// registered before anything has dialled the bridge, so its facts travel as env vars like every other. The flag is
// the capability and the rest is detail — detail on its own is a half-written env file, and inferring the capability
// from it would register a reasoner the app never claimed.
export function reasoningFromEnv(env: Record<string, string | undefined>): PiModelReasoning | undefined {
  if (env.CD_MODEL_REASONING !== "1") return undefined;
  const levels = piThinkingLevels((env.CD_MODEL_REASONING_LEVELS ?? "").split(",").map((level) => level.trim()));
  return {
    ...(levels.length ? { levels } : {}),
    ...(env.CD_MODEL_REASONING_MANDATORY === "1" ? { mandatory: true } : {}),
  };
}

// What pi is to offer as thinking levels. pi resolves availability FROM this map rather than from a list: a level
// mapped to `null` is withdrawn, `xhigh` and `max` are offered ONLY when the map names them, and an unnamed level
// keeps pi's own default availability (pi-ai `getSupportedThinkingLevels`). So a provider that published its efforts
// gets exactly those, and one that published none keeps pi's set untouched rather than a narrower invented one.
function thinkingLevelMap(reasoning: PiModelReasoning): ThinkingLevelMap | undefined {
  // `mandatory` is the model that always reasons: withdrawing `off` is how pi stops offering a mode it has not got.
  const map: ThinkingLevelMap = reasoning.mandatory ? { off: null } : {};
  const published = reasoning.levels;
  if (!published?.length) return reasoning.mandatory ? map : undefined;
  for (const level of PI_THINKING_LEVELS) map[level] = published.includes(level) ? level : null;
  return map;
}

// One registration as pi's provider composer wants it. `name` is the id: the provider listings carry an id and
// nothing more, and inventing a prettier label would be this app's words in pi's mouth.
//
// `upstream` is what pi's own detection would have looked at if the gateway were not in the way — see
// `piUpstreamCompat`. Absent leaves pi's reading of our gateway untouched, which is right for every upstream it
// would have read the same way. The wire shape matters as well as the URL: those fields are pi's
// OpenAI-completions dialect, and its Anthropic client has a compat of its own that no URL feeds.
export function piModelConfig(model: PiModelRegistration, upstream?: { baseUrl?: string; api?: string }) {
  const levels = model.reasoning ? thinkingLevelMap(model.reasoning) : undefined;
  const speaksOpenAI = !upstream?.api || upstream.api === "openai-completions";
  const compat = speaksOpenAI ? piUpstreamCompat(upstream?.baseUrl, model.id) : undefined;
  return {
    id: model.id,
    name: model.id,
    ...(compat ? { compat } : {}),
    // Only what a provider published, or what the app's own catalogue declares about a provider that publishes
    // nothing: pi hides the thinking control for everything else, which is the honest answer for a model nobody
    // called a reasoner.
    reasoning: !!model.reasoning,
    ...(levels ? { thinkingLevelMap: levels } : {}),
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
