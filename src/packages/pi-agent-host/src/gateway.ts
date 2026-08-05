import { createServer } from "node:http";
import { Readable } from "node:stream";

import { createLogger } from "@/logger";
import { decodeProviderCredential, upstreamSecretOf } from "@/pi-bridge/providerCredential";

const logger = createLogger("pi-agent-host.gateway");

// Headers that must not cross the proxy: the caller's credentials (we substitute our own), and
// per-connection headers that belong to the inbound socket rather than the upstream request.
const STRIPPED_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "x-api-key",
  "host",
  "connection",
  "keep-alive",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

// Response headers that must NOT be copied downstream. `fetch` has already decoded the body, so echoing
// the upstream `content-encoding` (or a length/chunking header describing the encoded bytes) makes the
// client try to gunzip plain text and abort the connection.
const STRIPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export function buildDownstreamHeaders(upstream: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(upstream)) {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
  }
  return headers;
}

// Mirrors the app's AIAuthScheme. The gateway cannot import the app's types — it runs inside the container —
// but the vocabulary is deliberately the same one the env file carries, not a second invention.
export type UpstreamAuthScheme = "none" | "bearer" | "basic" | "header";

const UPSTREAM_AUTH_SCHEMES: readonly UpstreamAuthScheme[] = ["none", "bearer", "basic", "header"];

// Absent ⇒ bearer, which is what every OpenAI-shaped upstream wants and what this gateway always did.
export function parseUpstreamAuthScheme(value: string | undefined): UpstreamAuthScheme {
  if (!value) return "bearer";
  if (!UPSTREAM_AUTH_SCHEMES.includes(value as UpstreamAuthScheme)) {
    throw new Error(`CD_UPSTREAM_AUTH_SCHEME must be one of ${UPSTREAM_AUTH_SCHEMES.join(", ")}`);
  }
  return value as UpstreamAuthScheme;
}

// A custom auth header may not be one that belongs to the connection or the proxy itself.
const FORBIDDEN_CUSTOM_AUTH_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "content-length",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "transfer-encoding",
]);

export interface GatewayConfig {
  upstreamBaseUrl: string;
  apiKey: string;
  bridgeToken: string;
  // The upstream's kind and credential shape, composed by the app from the provider's settings. Anthropic
  // authenticates with x-api-key rather than a bearer token, and a keyless local server wants no header at all.
  upstreamKind?: string;
  authScheme?: UpstreamAuthScheme;
  authHeaderName?: string;
  authUsername?: string;
}

// The credential headers to sign the upstream request with, mirroring the app's own
// providerTransport/authenticatedHeaders so one provider cannot mean two different things.
//
// The env value may be a plain key OR the app's stored credential envelope, because a sign-in that returns an
// expiring pair has to keep all three of its fields. Only the ACCESS token ever signs a request; the refresh token
// goes nowhere but the provider's token endpoint, from the one-shot auth container.
export function upstreamCredentialHeaders(config: GatewayConfig): Record<string, string> {
  const scheme = config.authScheme ?? "bearer";
  const secret = upstreamSecret(config);
  switch (scheme) {
    case "none":
      return {};
    case "basic":
      return {
        authorization: `Basic ${Buffer.from(`${config.authUsername ?? ""}:${secret}`).toString("base64")}`,
      };
    case "header": {
      const name = (config.authHeaderName ?? "").trim().toLowerCase();
      if (!name || FORBIDDEN_CUSTOM_AUTH_HEADERS.has(name)) {
        throw new Error("gateway: invalid custom upstream auth header");
      }
      return { [name]: secret };
    }
    default:
      return config.upstreamKind === "anthropic" ? { "x-api-key": secret } : { authorization: `Bearer ${secret}` };
  }
}

function upstreamSecret(config: GatewayConfig): string {
  const stored = decodeProviderCredential(config.apiKey);
  return stored ? upstreamSecretOf(stored) : "";
}

// pi sends the bridge token as its provider credential, so it arrives in whichever header that client shape
// uses: an OpenAI-shaped client signs `authorization`, the Anthropic SDK signs `x-api-key`. Checking only the
// former would 401 every Anthropic turn.
export function isAuthorized(inbound: { headers: Record<string, string> }, config: GatewayConfig): boolean {
  return (
    inbound.headers.authorization === `Bearer ${config.bridgeToken}` ||
    inbound.headers["x-api-key"] === config.bridgeToken
  );
}

export function buildUpstreamRequest(
  inbound: { path: string; headers: Record<string, string> },
  config: GatewayConfig,
): { url: string; headers: Record<string, string> } {
  const base = config.upstreamBaseUrl.replace(/\/+$/, "");
  const suffix = inbound.path.replace(/^\/v1/, "");
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(inbound.headers)) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) headers[key.toLowerCase()] = value;
  }
  return { url: `${base}${suffix}`, headers: { ...headers, ...upstreamCredentialHeaders(config) } };
}

export interface GatewayHandle {
  close(): Promise<void>;
}

// The one route this proxy answers itself: replace the credential it signs with. A session outlives an expiring
// access token, and the app is the only party that can renew one — it exchanges the refresh token in a one-shot auth
// container and pushes the result here, so a long session never has to be restarted to stay signed in. Authorized by
// the same bridge token every other request carries, and the body is the credential ALONE — nothing else is settable.
export const GATEWAY_CREDENTIAL_PATH = "/__cd/credential";

async function readBody(request: {
  on: (event: string, listener: (chunk?: unknown) => void) => void;
}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", (error) => reject(error as Error));
  });
}

export async function startGateway(config: GatewayConfig, port: number): Promise<GatewayHandle> {
  // Mutable on purpose: `config` is captured by the request path, so replacing the field is what makes a rotation
  // take effect on the very next turn without restarting the container.
  const live: GatewayConfig = { ...config };
  const server = createServer(async (request, response) => {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : (value ?? ""),
      ]),
    );
    if (!isAuthorized({ headers }, live)) {
      response.writeHead(401).end();
      return;
    }
    if ((request.url ?? "").split("?")[0] === GATEWAY_CREDENTIAL_PATH) {
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      try {
        const body = await readBody(request);
        const credential = String((JSON.parse(body) as { credential?: unknown }).credential ?? "");
        if (!credential) {
          response.writeHead(400).end();
          return;
        }
        live.apiKey = credential;
        logger.info("gateway credential replaced");
        response.writeHead(204).end();
      } catch (error) {
        logger.error("gateway credential replacement failed", error);
        response.writeHead(400).end();
      }
      return;
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    try {
      // Inside the try: composing the request can itself fail on a misconfigured custom auth header, and an
      // uncaught throw here would take the whole gateway process down instead of failing one request.
      const built = buildUpstreamRequest({ path: request.url ?? "/", headers }, live);
      const upstream = await fetch(built.url, {
        method: request.method,
        headers: built.headers,
        body: hasBody ? (Readable.toWeb(request) as ReadableStream) : undefined,
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      response.writeHead(upstream.status, buildDownstreamHeaders(Object.fromEntries(upstream.headers.entries())));
      if (upstream.body) {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) response.write(chunk);
      }
      response.end();
    } catch (error) {
      // Never echo the upstream error verbatim: it can contain the request headers we just signed.
      logger.error("gateway upstream failed", error);
      response.writeHead(502).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "0.0.0.0", resolve));
  logger.info(`gateway listening on ${port}`);
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
