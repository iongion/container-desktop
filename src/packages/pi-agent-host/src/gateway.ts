import { createServer } from "node:http";
import { Readable } from "node:stream";

import { createLogger } from "@/logger";

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

export interface GatewayConfig {
  upstreamBaseUrl: string;
  apiKey: string;
  bridgeToken: string;
}

export function isAuthorized(inbound: { headers: Record<string, string> }, config: GatewayConfig): boolean {
  return inbound.headers.authorization === `Bearer ${config.bridgeToken}`;
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
  headers.authorization = `Bearer ${config.apiKey}`;
  return { url: `${base}${suffix}`, headers };
}

export interface GatewayHandle {
  close(): Promise<void>;
}

export async function startGateway(config: GatewayConfig, port: number): Promise<GatewayHandle> {
  const server = createServer(async (request, response) => {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : (value ?? ""),
      ]),
    );
    if (!isAuthorized({ headers }, config)) {
      response.writeHead(401).end();
      return;
    }
    const built = buildUpstreamRequest({ path: request.url ?? "/", headers }, config);
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    try {
      const upstream = await fetch(built.url, {
        method: request.method,
        headers: built.headers,
        body: hasBody ? (Readable.toWeb(request) as ReadableStream) : undefined,
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit);
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
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
