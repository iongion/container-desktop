// OpenAI-compatible model lister. Runs in main (behind the broker) so the egress gate
// applies — a "local" provider pointed at a remote host is treated like cloud. Used by the chat
// composer's smart model selector. No Electron imports.

import { type AIAuthSettings, buildAuthHeaders, type ListedModel } from "@/ai-system/core";

export type { ListedModel };

// Auth headers for raw discovery fetches — mirrors the chat path so a key-gated server lists the same way it
// chats: bearer → Authorization: Bearer (built here, since a raw fetch has no native apiKey arg); basic /
// custom-header → buildAuthHeaders; none → nothing.
function discoveryHeaders(auth?: AIAuthSettings, secret?: string): Record<string, string> {
  if (!auth) {
    return {};
  }
  if (auth.scheme === "bearer") {
    return secret ? { authorization: `Bearer ${secret}` } : {};
  }
  return buildAuthHeaders(auth, secret);
}

// List models from an OpenAI-compatible server (llama.cpp / LM Studio / cloud). fetch is injectable for tests.
export async function listModels(
  baseURL: string,
  opts?: { auth?: AIAuthSettings; secret?: string; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<ListedModel[]> {
  const f = opts?.fetchImpl ?? fetch;
  const url = `${baseURL.replace(/\/+$/, "")}/models`;
  const res = await f(url, {
    headers: discoveryHeaders(opts?.auth, opts?.secret),
    signal: opts?.signal,
  });
  if (!res.ok) {
    throw new Error(`AI: model list failed (${res.status})`);
  }
  const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
  const data = Array.isArray(json?.data) ? json.data : [];
  return data.map((m) => ({ id: String(m?.id ?? "") })).filter((m) => m.id.length > 0);
}
