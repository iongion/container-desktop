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
// Known gaps, deliberately not guessed at because they cannot be verified on this machine: Ollama publishes it at
// `POST /api/show` (`model_info["<arch>.context_length"]`) and llama.cpp at `GET /props` (`n_ctx`). Both belong here
// once there is a server to prove them against.

import type { ResolvedProvider } from "@/ai-system/core/providers";

export interface ModelWindow {
  contextWindow: number;
  // Only some providers publish a completion cap. Absent means pi's own default stands.
  maxOutputTokens?: number;
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

function entryFor(payload: unknown, model: string): Record<string, unknown> | undefined {
  const data = (payload as { data?: unknown } | undefined)?.data;
  if (!Array.isArray(data)) return undefined;
  return data.find((item) => (item as { id?: unknown })?.id === model) as Record<string, unknown> | undefined;
}

async function readJSON(
  url: string,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<unknown | undefined> {
  const response = await opts.fetchImpl(url, opts.signal ? { signal: opts.signal } : {});
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

// OpenRouter publishes the window and the completion cap in its own listing, so a cloud model is no different in kind.
async function openRouterWindow(
  resolved: ResolvedProvider,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal },
): Promise<ModelWindow | undefined> {
  const entry = entryFor(await readJSON(`${origin(resolved.baseURL)}/api/v1/models`, opts), resolved.model);
  const window = usable(entry?.context_length);
  if (!window) return undefined;
  const cap = usable((entry?.top_provider as { max_completion_tokens?: unknown } | undefined)?.max_completion_tokens);
  return { contextWindow: window, ...(cap ? { maxOutputTokens: cap } : {}) };
}

const PROBES: Record<string, typeof lmStudioWindow> = {
  lmstudio: lmStudioWindow,
  openrouter: openRouterWindow,
};

export async function fetchModelWindow(
  resolved: ResolvedProvider,
  options?: ModelWindowOptions,
): Promise<ModelWindow | undefined> {
  const probe = PROBES[resolved.id];
  if (!probe || !resolved.model.trim()) return undefined;
  const fetchImpl = options?.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  try {
    return await probe(resolved, { fetchImpl, ...(options?.signal ? { signal: options.signal } : {}) });
  } catch {
    // A provider that cannot be reached must not stop a session from starting: the window is a nicety, the session
    // is the point. Unknown is the honest answer.
    return undefined;
  }
}
