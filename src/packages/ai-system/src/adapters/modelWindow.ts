// What the PROVIDER says its context window is, asked of the provider itself.
//
// Nothing else can answer honestly. The OpenAI-shaped `/models` listing every provider serves carries an id and
// nothing more, so the session used to register its model with an invented 128000/4096 — and the Context panel then
// told the user they had 124k of input room on an LM Studio server that refuses anything past what it LOADED. A
// number a server would reject is worse than no number.
//
// Only providers with a documented endpoint are asked, and only for the model in use. Everything else answers
// `undefined`, which the panel renders as "unknown" rather than as a confident fiction.
//
// Under that answer sits what pi's own catalogue published for the model (`pi-bridge/modelBaseline`), so a provider
// with no endpoint to ask — Anthropic, OpenAI, DeepSeek, GLM — is no longer a blank: pi's generated data carries the
// window, the cap, the rates and the thinking levels, and a probe overrides it wherever a server can be asked.
//
// Every probe here was driven against a real server, because the shapes are not guessable: llama.cpp keeps its number
// under `default_generation_settings`, not at the top level of `/props`, where a guess would have looked.

import { getProviderEntry, type ResolvedProvider } from "@/ai-system/core/providers";
import { piModelBaseline } from "@/pi-bridge/modelBaseline";
import { type PiModelReasoning, piThinkingLevels } from "@/pi-bridge/protocol";
import { isEmpty } from "@/utils";

export interface ModelWindow {
  // Absent when the provider publishes no window for this model — including when it published something else about
  // it, which is why this is not the one field that has to be there.
  contextWindow?: number;
  // Only some providers publish a completion cap. Absent means pi's own default stands.
  maxOutputTokens?: number;
  // What the provider charges, in DOLLARS PER MILLION TOKENS — the unit pi's model config takes, which is not the
  // unit any provider publishes. Absent for a free or unpriced model, where pi's own zeroes are already right.
  pricing?: ModelPricing;
  // Whether this model reasons, and how hard it may be asked to. Absent means nobody said so — the thinking control
  // then stays hidden rather than offering a level the provider would ignore.
  reasoning?: PiModelReasoning;
}

export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelWindowOptions {
  // Bound on purpose — a bare `fetch` reference loses its realm and WebKit rejects the call.
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

// A window has to be a positive whole number of tokens; 0 is LM Studio's way of saying it does not know yet.
function usable(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function origin(baseURL: string): string {
  // The native endpoints sit on the ORIGIN, beside the OpenAI-shaped `/v1`, not under it.
  try {
    return new URL(baseURL).origin;
  } catch {
    return baseURL.replace(/\/v\d+\/?$/, "").replace(/\/+$/, "");
  }
}

// A probe answers with what it learned or with nothing at all: an empty object would read as "asked and answered",
// which is the one thing it must not be confused with.
function learned(facts: ModelWindow): ModelWindow | undefined {
  return isEmpty(facts) ? undefined : facts;
}

function entryFor(payload: unknown, model: string): Record<string, unknown> | undefined {
  const data = (payload as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return undefined;
  return data.find((item) => (item as { id?: unknown })?.id === model) as Record<string, unknown> | undefined;
}

async function readJSON(
  url: string,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal; body?: unknown },
): Promise<unknown | undefined> {
  const init: RequestInit = {
    ...(opts.signal ? { signal: opts.signal } : {}),
    // A body means the endpoint takes the model as an argument rather than listing every model it knows.
    ...(opts.body === undefined
      ? {}
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(opts.body) }),
  };
  const response = await opts.fetchImpl(url, init);
  if (!response.ok) return undefined;
  return await response.json();
}

// LM Studio's own REST surface. `loaded_context_length` is what the running instance will actually accept and is
// usually a fraction of the model's maximum — a 4B model that can do 262144 is commonly loaded at 8192.
async function lmStudioWindow(
  resolved: ResolvedProvider,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<ModelWindow | undefined> {
  const entry = entryFor(await readJSON(`${origin(resolved.baseURL)}/api/v0/models`, opts), resolved.model);
  const window = usable(entry?.loaded_context_length) ?? usable(entry?.max_context_length);
  return window ? { contextWindow: window } : undefined;
}

// Dollars per token, as a string, into dollars per million, as a number. pi divides its rate by 1e6 before applying
// it (`pi-ai/models.js`: `(rates.input / 1000000) * usage.input`), so passing a per-token price straight through
// under-reports a real bill by a factor of a million.
function perMillion(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1_000_000 : undefined;
}

// The rates ride along with the window because they come from the same entry. A model that charges nothing yields
// nothing: pi already defaults every rate to zero, so there is no difference to carry.
function pricingOf(entry: Record<string, unknown> | undefined): ModelPricing | undefined {
  const published = entry?.pricing as Record<string, unknown> | undefined;
  const input = perMillion(published?.prompt);
  const output = perMillion(published?.completion);
  if (!input && !output) return undefined;
  const cacheRead = perMillion(published?.input_cache_read);
  const cacheWrite = perMillion(published?.input_cache_write);
  return {
    input: input ?? 0,
    output: output ?? 0,
    ...(cacheRead ? { cacheRead } : {}),
    ...(cacheWrite ? { cacheWrite } : {}),
  };
}

// OpenRouter is the one provider that publishes reasoning per model, and it publishes it twice over: the capability
// in `supported_parameters`, and the detail in an entry of its own — the efforts it accepts, and whether reasoning
// can be turned off at all. 213 of 338 models carried it when this was written; a model that does not reason carries
// neither, which is what tells the two apart.
function openRouterReasoning(entry: Record<string, unknown> | undefined): PiModelReasoning | undefined {
  const published = entry?.reasoning as { mandatory?: unknown; supported_efforts?: unknown } | undefined;
  const parameters = Array.isArray(entry?.supported_parameters) ? (entry.supported_parameters as unknown[]) : [];
  if (!published && !parameters.includes("reasoning")) return undefined;
  // `none` is OpenRouter's word for not reasoning at all, which is pi's `off` rather than a level of its own.
  const efforts = Array.isArray(published?.supported_efforts) ? published.supported_efforts.map(String) : [];
  const levels = piThinkingLevels(efforts);
  return { ...(levels.length ? { levels } : {}), ...(published?.mandatory === true ? { mandatory: true } : {}) };
}

// OpenRouter publishes the window, the completion cap, the price and the reasoning in its own listing, so a cloud
// model is no different in kind.
async function openRouterWindow(
  resolved: ResolvedProvider,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<ModelWindow | undefined> {
  const entry = entryFor(await readJSON(`${origin(resolved.baseURL)}/api/v1/models`, opts), resolved.model);
  const window = usable(entry?.context_length);
  const cap = usable((entry?.top_provider as { max_completion_tokens?: unknown } | undefined)?.max_completion_tokens);
  const pricing = pricingOf(entry);
  const reasoning = openRouterReasoning(entry);
  return learned({
    ...(window ? { contextWindow: window } : {}),
    ...(cap ? { maxOutputTokens: cap } : {}),
    ...(pricing ? { pricing } : {}),
    ...(reasoning ? { reasoning } : {}),
  });
}

// llama.cpp serves ONE model at whatever `-c` it was started with, so the model id plays no part. The number lives
// under the default generation settings and NOT at the top level of `/props`, where a guess would have looked.
async function llamaCppWindow(
  resolved: ResolvedProvider,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<ModelWindow | undefined> {
  const props = (await readJSON(`${origin(resolved.baseURL)}/props`, opts)) as
    | { default_generation_settings?: Record<string, unknown> }
    | undefined;
  const window = usable(props?.default_generation_settings?.n_ctx);
  return window ? { contextWindow: window } : undefined;
}

const PROBES: Record<string, typeof lmStudioWindow> = {
  lmstudio: lmStudioWindow,
  openrouter: openRouterWindow,
  llamacpp: llamaCppWindow,
};

// The one fact here that is not read off a provider. OpenAI serves an id-only listing, so the models it reasons with
// are known by the prefixes `provider-catalog.json` declares — the app's own curated claim, kept as data so widening
// it to another provider is an entry rather than a code change. Nothing about the levels: the catalogue names which
// models think, not how hard, and pi's own set is right for the ones it names.
function declaredReasoning(resolved: ResolvedProvider): PiModelReasoning | undefined {
  const prefixes = getProviderEntry(resolved.id)?.reasoning?.modelPrefixes;
  return prefixes?.some((prefix) => resolved.model.startsWith(prefix)) ? {} : undefined;
}

export async function fetchModelWindow(
  resolved: ResolvedProvider,
  options?: ModelWindowOptions,
): Promise<ModelWindow | undefined> {
  if (!resolved.model.trim()) return undefined;
  // Three sources, weakest first: what pi's catalogue published about this model, then the app's own curated claim,
  // then what the provider itself answers. The curated claim names WHICH models think and nothing more, so it must
  // not displace published levels — a bare `{}` over `{levels, mandatory}` would lose the detail pi had.
  const baseline = piModelBaseline(resolved.id, resolved.model) ?? {};
  const declared = baseline.reasoning ? undefined : declaredReasoning(resolved);
  const known: ModelWindow = { ...baseline, ...(declared ? { reasoning: declared } : {}) };
  const probe = PROBES[resolved.id];
  if (!probe) return learned(known);
  const fetchImpl = options?.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  try {
    // The provider's own answer wins over the app's declaration: it is the one that can change without a release.
    return learned({
      ...known,
      ...(await probe(resolved, { fetchImpl, ...(options?.signal ? { signal: options.signal } : {}) })),
    });
  } catch {
    // A provider that cannot be reached must not stop a session from starting: the window is a nicety, the session
    // is the point. Unknown is the honest answer — but what the app already knew stands, having cost no request.
    return learned(known);
  }
}
