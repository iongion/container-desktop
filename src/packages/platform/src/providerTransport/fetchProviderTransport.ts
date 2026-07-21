import type {
  ProviderCredentialReference,
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "@/ai-system/core/types";
import type { IKeychain } from "@/host-contract/capabilities";

const FORBIDDEN_CUSTOM_AUTH_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
]);
const STRIPPED_AUTH_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key"]);

export interface FetchProviderTransportDeps {
  keychain: IKeychain;
  fetchImpl: typeof fetch;
  anthropicDirectBrowserAccess?: boolean;
}

function assertBoundEndpoint(request: ProviderTransportRequest): URL {
  const url = new URL(request.url);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("AI: invalid provider endpoint");
  }
  if (url.origin !== request.credential.origin) {
    throw new Error("AI: provider request does not match the configured endpoint");
  }
  return url;
}

function customHeaderName(credential: ProviderCredentialReference): string {
  const name = credential.auth.headerName?.trim();
  if (!name || FORBIDDEN_CUSTOM_AUTH_HEADERS.has(name.toLowerCase())) {
    throw new Error("AI: invalid custom provider auth header");
  }
  const probe = new Headers();
  probe.set(name, "value");
  return name;
}

async function authenticatedHeaders(
  keychain: IKeychain,
  request: ProviderTransportRequest,
  anthropicDirectBrowserAccess: boolean,
): Promise<Headers> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (!STRIPPED_AUTH_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  const { credential } = request;
  if (anthropicDirectBrowserAccess && credential.providerKind === "anthropic") {
    headers.set("anthropic-dangerous-direct-browser-access", "true");
  }
  if (credential.auth.scheme === "none") return headers;
  const secret = await keychain.getKey(credential.providerId);
  if (!secret) throw new Error("AI: no credential stored for this provider");
  switch (credential.auth.scheme) {
    case "bearer":
      if (credential.providerKind === "anthropic") headers.set("x-api-key", secret);
      else headers.set("authorization", `Bearer ${secret}`);
      break;
    case "basic":
      headers.set("authorization", `Basic ${btoa(`${credential.auth.username ?? ""}:${secret}`)}`);
      break;
    case "header":
      headers.set(customHeaderName(credential), secret);
      break;
  }
  return headers;
}

function responseHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

// Fetch-backed provider transport used in Electron main (Undici injected) and in the explicitly trusted
// Tauri/Wails webview realm (global fetch injected). Credentials are transient request-local values and never
// enter actor context, persistence, inspection events, or transport DTOs.
export function createFetchProviderTransport(deps: FetchProviderTransportDeps): ProviderTransport {
  const active = new Map<number, AbortController>();
  let counter = 0;

  return {
    async request(request, signal): Promise<ProviderTransportResponse> {
      const url = assertBoundEndpoint(request);
      counter += 1;
      const id = counter;
      const abort = new AbortController();
      active.set(id, abort);
      const onAbort = () => abort.abort(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      const timeout = setTimeout(() => abort.abort(new Error("AI: provider request timed out")), request.timeoutMs);
      timeout.unref?.();
      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
        active.delete(id);
      };

      let response: Response;
      try {
        response = await deps.fetchImpl(url, {
          method: request.method,
          headers: await authenticatedHeaders(deps.keychain, request, deps.anthropicDirectBrowserAccess === true),
          body: request.body ? new Uint8Array(request.body).buffer : undefined,
          signal: abort.signal,
          redirect: "manual",
        });
      } catch (error) {
        cleanup();
        throw error;
      }

      if (!response.body) {
        cleanup();
        return {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders(response.headers),
          body: null,
        };
      }

      const reader = response.body.getReader();
      let received = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              cleanup();
              controller.close();
              return;
            }
            received += chunk.value.byteLength;
            if (received > request.maxResponseBytes) {
              abort.abort(new Error("AI: provider response is too large"));
              await reader.cancel().catch(() => undefined);
              cleanup();
              controller.error(new Error("AI: provider response is too large"));
              return;
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            cleanup();
            controller.error(error);
          }
        },
        async cancel(reason) {
          abort.abort(reason);
          await reader.cancel(reason).catch(() => undefined);
          cleanup();
        },
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response.headers),
        body,
      };
    },
    dispose() {
      for (const abort of active.values()) abort.abort(new Error("AI: provider transport disposed"));
      active.clear();
    },
  };
}
