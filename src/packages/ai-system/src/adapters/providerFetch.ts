import type { ResolvedProvider } from "@/ai-system/core/providers";
import type { ProviderCredentialReference, ProviderTransport, ProviderTransportRequest } from "@/ai-system/core/types";

// Transport bounds — this is their sole consumer, so they stay local (single-use consts live beside their use).
const MAX_PROVIDER_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_HEADER_BYTES = 32 * 1024;
const PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

const STANDARD_CREDENTIAL_HEADERS = new Set(["authorization", "proxy-authorization", "x-api-key", "api-key"]);
const SHELL_CONTROLLED_HEADERS = new Set(["anthropic-dangerous-direct-browser-access"]);

function credentialReference(resolved: ResolvedProvider): ProviderCredentialReference {
  const base = new URL(resolved.baseURL);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("AI: provider endpoint must use HTTP or HTTPS");
  }
  if (base.username || base.password) {
    throw new Error("AI: provider endpoint must not contain credentials");
  }
  return {
    providerId: resolved.id,
    providerKind: resolved.kind,
    origin: base.origin,
    auth: resolved.auth,
  };
}

function sanitizedHeaders(headers: Headers, credential: ProviderCredentialReference): Record<string, string> {
  const customCredentialHeader =
    credential.auth.scheme === "header" ? credential.auth.headerName?.trim().toLowerCase() : undefined;
  const result: Record<string, string> = {};
  let totalBytes = 0;
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (
      STANDARD_CREDENTIAL_HEADERS.has(lower) ||
      SHELL_CONTROLLED_HEADERS.has(lower) ||
      lower === customCredentialHeader
    )
      continue;
    totalBytes += name.length + value.length;
    if (totalBytes > MAX_PROVIDER_HEADER_BYTES) throw new Error("AI: provider request headers are too large");
    result[lower] = value;
  }
  return result;
}

async function transportRequest(request: Request, resolved: ResolvedProvider): Promise<ProviderTransportRequest> {
  const credential = credentialReference(resolved);
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AI: provider request must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.origin !== credential.origin) {
    throw new Error("AI: provider request does not match the configured endpoint");
  }
  const body = request.body ? new Uint8Array(await request.arrayBuffer()) : undefined;
  if ((body?.byteLength ?? 0) > MAX_PROVIDER_REQUEST_BYTES) {
    throw new Error("AI: provider request is too large");
  }
  return {
    credential,
    url: url.toString(),
    method: request.method,
    headers: sanitizedHeaders(request.headers, credential),
    body,
    timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
    maxResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
  };
}

// The AI SDK accepts a custom standards-compatible fetch. This adapter is the single conversion point from that
// contract to the configured shell fetch path: it strips credential-bearing SDK placeholder headers, forwards
// only bounded bytes, and reconstructs a streaming Response without buffering the response body.
export function createProviderFetch(transport: ProviderTransport, resolved: ResolvedProvider): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const response = await transport.request(await transportRequest(request, resolved), request.signal);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
