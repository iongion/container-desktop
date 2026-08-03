// Provider-specific bounded model discovery. The supplied fetch is already bound to the resolved provider's
// shell-specific credential adapter, so this layer adds no credentials and never handles a plaintext secret.

import {
  MAX_DISCOVERED_MODELS,
  MAX_MODEL_DISCOVERY_PAGES,
  MAX_MODEL_DISCOVERY_RESPONSE_BYTES,
  MAX_MODEL_ID_CHARS,
  MODEL_DISCOVERY_TIMEOUT_MS,
} from "@/ai-system/core/limits";
import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { ListedModel } from "@/ai-system/core/types";

export interface ModelListOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxModels?: number;
  maxModelIdChars?: number;
  maxPages?: number;
}

interface ModelListPage {
  data?: Array<{ id?: unknown }>;
  has_more?: unknown;
  last_id?: unknown;
}

class ModelDiscoveryHTTPError extends Error {
  constructor(readonly status: number) {
    super(`AI: model list failed (${status})`);
  }
}

function boundedOptions(opts?: ModelListOptions) {
  return {
    fetchImpl: opts?.fetchImpl ?? fetch,
    timeoutMs: opts?.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS,
    maxResponseBytes: opts?.maxResponseBytes ?? MAX_MODEL_DISCOVERY_RESPONSE_BYTES,
    maxModels: opts?.maxModels ?? MAX_DISCOVERED_MODELS,
    maxModelIdChars: opts?.maxModelIdChars ?? MAX_MODEL_ID_CHARS,
    maxPages: opts?.maxPages ?? MAX_MODEL_DISCOVERY_PAGES,
  };
}

function operationSignal(caller: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(caller?.reason ?? new Error("AI: model discovery cancelled"));
  if (caller?.aborted) onCallerAbort();
  else caller?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("AI: model discovery timed out"));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

async function readBoundedJSON(response: Response, maxBytes: number): Promise<ModelListPage> {
  if (!response.ok) throw new ModelDiscoveryHTTPError(response.status);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("AI: model list response is too large");

  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("AI: model list response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as ModelListPage;
  } catch {
    throw new Error("AI: model list returned invalid JSON");
  }
}

function appendModels(
  target: Map<string, ListedModel>,
  page: ModelListPage,
  limits: { maxModels: number; maxModelIdChars: number },
): void {
  if (!Array.isArray(page.data)) return;
  for (const item of page.data) {
    if (typeof item?.id !== "string") continue;
    const id = item.id.trim();
    if (!id) continue;
    if (id.length > limits.maxModelIdChars) throw new Error("AI: model id is too large");
    if (!target.has(id) && target.size >= limits.maxModels) throw new Error("AI: model list has too many models");
    target.set(id, { id });
  }
}

async function listPaginated(
  resolved: ResolvedProvider,
  opts: ReturnType<typeof boundedOptions>,
  signal: AbortSignal,
): Promise<ListedModel[]> {
  const anthropic = resolved.discovery === "anthropic";
  const url = new URL(`${resolved.baseURL.replace(/\/+$/, "")}/models`);
  if (anthropic) url.searchParams.set("limit", "100");
  const models = new Map<string, ListedModel>();

  for (let pageNumber = 0; pageNumber < opts.maxPages; pageNumber += 1) {
    const response = await opts.fetchImpl(url, {
      signal,
      ...(anthropic ? { headers: { "anthropic-version": "2023-06-01" } } : {}),
    });
    const page = await readBoundedJSON(response, opts.maxResponseBytes);
    appendModels(models, page, opts);
    if (page.has_more !== true) return [...models.values()];
    const cursor = typeof page.last_id === "string" ? page.last_id.trim() : "";
    if (!cursor) throw new Error("AI: model list pagination cursor is missing");
    if (pageNumber + 1 >= opts.maxPages) throw new Error("AI: model list has too many pages");
    url.searchParams.set(anthropic ? "after_id" : "after", cursor);
  }
  throw new Error("AI: model list has too many pages");
}

export async function listModels(resolved: ResolvedProvider, options?: ModelListOptions): Promise<ListedModel[]> {
  const opts = boundedOptions(options);
  const configured = resolved.model.trim();
  if (configured.length > opts.maxModelIdChars) throw new Error("AI: model id is too large");
  if (resolved.discovery === "manual") return configured ? [{ id: configured }] : [];

  const operation = operationSignal(options?.signal, opts.timeoutMs);
  try {
    try {
      const models = await listPaginated(resolved, opts, operation.signal);
      if (resolved.discovery === "single")
        return models.length > 0 ? [models[0]] : configured ? [{ id: configured }] : [];
      return models;
    } catch (error) {
      if (
        resolved.discovery === "single" &&
        configured &&
        error instanceof ModelDiscoveryHTTPError &&
        [404, 405, 501].includes(error.status)
      ) {
        return [{ id: configured }];
      }
      throw error;
    }
  } catch (error) {
    if (operation.timedOut()) throw new Error("AI: model discovery timed out");
    throw error;
  } finally {
    operation.cleanup();
  }
}
