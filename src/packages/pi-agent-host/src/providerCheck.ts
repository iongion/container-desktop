// Can THIS SESSION reach the model? Asked from inside the agent container, which is the only place that can answer
// it: the app's own diagnostics dial the provider from the app's realm, over the app's network, with the app's
// credential — and every one of those three differs from what a turn actually does. A loopback provider the app
// reaches happily is unreachable from a container.
//
// The probe is a model list through the provider proxy. It costs nothing, and a 200 proves the whole chain the app's
// own check cannot see: pi → the proxy → the bridge → the app's native transport → the upstream, signed with the
// credential only the app can resolve.

import type { SessionProviderCheck } from "@/pi-bridge/protocol";

// Long enough for a cold cloud endpoint, short enough that a diagnostics drawer is not left spinning.
const CHECK_TIMEOUT_MS = 15_000;

export interface ProviderCheckDeps {
  providerBaseUrl: string;
  providerToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function modelCount(payload: unknown): number | undefined {
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data.length : undefined;
}

export async function checkSessionProvider(deps: ProviderCheckDeps): Promise<SessionProviderCheck> {
  // Bound to the caller's realm on purpose: an unbound `fetch` handed on as a value loses `this` and some engines
  // refuse it outright.
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const url = `${deps.providerBaseUrl.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? CHECK_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      // pi signs the proxy with the bridge token, and so does this: the real credential is never in this container.
      headers: { authorization: `Bearer ${deps.providerToken}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      // 502 is the app saying it could not reach the upstream; 401 is the upstream rejecting the credential the app
      // signed with. Both are the answer, so the status travels rather than a single "unreachable".
      return { reachable: false, status: response.status };
    }
    const payload = await response.json().catch(() => null);
    const models = modelCount(payload);
    return { reachable: true, status: response.status, ...(models === undefined ? {} : { models }) };
  } catch (error) {
    return { reachable: false, error: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
