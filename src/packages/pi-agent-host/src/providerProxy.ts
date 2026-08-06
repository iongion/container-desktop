// The endpoint pi's own provider layer posts inference to, inside this container.
//
// It replaces the gateway container, and what it deletes is the reason it exists: no credential arrives here at all.
// Each request is carried to the APP over the bridge, and the app's native transport resolves the key from the OS
// keychain and attaches it there — so there is no key-bearing env file to write, nothing in this container for plugin
// code to read, and nothing to ship to a remote machine. A renewed sign-in needs no pushing either: the key is read
// per request, so the next turn signs with whatever the vault now holds.
//
// It listens on this container's OWN loopback and is never published, so nothing outside the container can reach it.
// The bridge is what carries it out, and that is measured rather than assumed: the bridge is already published, already
// forwarded with `ssh -NL` for a remote engine and reachable on an `--internal` network, while a listener on the user's
// machine is unreachable from a rootless-podman container unless it binds a LAN-visible address.

import { createServer, type Server } from "node:http";

import { createLogger } from "@/logger";
import type { ProviderProxyRequest, ProviderProxyStreamEvent } from "@/pi-bridge/protocol";
import { PI_PROVIDER_PROXY_PORT } from "@/pi-bridge/providerEndpoint";

const logger = createLogger("pi-agent-host.providerProxy");

// Headers that must not travel to the provider: the caller's own credential — pi signs the bridge token, which
// authorises this socket and means nothing upstream — and the per-connection headers that describe THIS socket rather
// than the request being forwarded.
const STRIPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set([
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

// Response headers that must NOT be copied back to pi. The app's transport already decoded the body, so echoing the
// upstream's `content-encoding` — or a length or chunking header describing the encoded bytes — makes pi's own client
// try to gunzip plain text and abort mid-answer.
const STRIPPED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function withoutHeaders(headers: Record<string, string>, stripped: ReadonlySet<string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!stripped.has(lower)) kept[lower] = value;
  }
  return kept;
}

export function forwardedRequestHeaders(inbound: Record<string, string>): Record<string, string> {
  return withoutHeaders(inbound, STRIPPED_REQUEST_HEADERS);
}

export function forwardedResponseHeaders(upstream: Record<string, string>): Record<string, string> {
  return withoutHeaders(upstream, STRIPPED_RESPONSE_HEADERS);
}

// pi sends the bridge token as its provider credential, so it arrives in whichever header that client shape uses: an
// OpenAI-shaped client signs `authorization`, the Anthropic SDK signs `x-api-key`. Checking only the former would 401
// every Anthropic turn.
export function isProviderProxyAuthorized(headers: Record<string, string>, token: string): boolean {
  return headers.authorization === `Bearer ${token}` || headers["x-api-key"] === token;
}

// Where one request's answer is written. Node's ServerResponse narrowed to what this needs, so the correlation is
// settled by a fake rather than by a live socket.
export interface ProviderProxySink {
  head(status: number, statusText: string, headers: Record<string, string>): void;
  chunk(bytes: Uint8Array): void;
  end(): void;
  // The answer cannot be produced. Distinct from `end` because pi has to see a failed turn, not an empty one.
  fail(message: string): void;
}

export interface ProviderProxyTransport {
  send(request: ProviderProxyRequest): void;
  cancel(requestId: string): void;
}

export interface ProviderProxy {
  // Carry one request to the app and stream its answer into `sink`. Returns the correlation id so the caller can
  // abandon it if its own client goes away first.
  begin(
    request: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array },
    sink: ProviderProxySink,
  ): string;
  // One frame from the app, routed to the request it answers.
  deliver(requestId: string, event: ProviderProxyStreamEvent): void;
  // pi's client went away mid-answer, so the app should stop pulling from the provider.
  abandon(requestId: string): void;
  // The bridge died. Every blocked request has to fail on its own terms, or pi waits on a stream that will never
  // produce another byte.
  failAll(reason: string): void;
  inFlight(): number;
}

export function createProviderProxy(options: {
  token: string;
  transport: ProviderProxyTransport;
  newRequestId: () => string;
}): ProviderProxy {
  const live = new Map<string, ProviderProxySink>();

  // Settling removes the entry FIRST: a long session would otherwise keep one per turn for the life of the container,
  // and a duplicate frame would write into a response that has already ended.
  const settle = (requestId: string): ProviderProxySink | undefined => {
    const sink = live.get(requestId);
    if (sink) live.delete(requestId);
    return sink;
  };

  return {
    begin(request, sink) {
      const requestId = options.newRequestId();
      live.set(requestId, sink);
      try {
        options.transport.send({
          requestId,
          method: request.method,
          path: request.path,
          headers: request.headers,
          ...(request.body?.length ? { body: Buffer.from(request.body).toString("base64") } : {}),
        });
      } catch (error) {
        // A request with nowhere to go has to fail AS a request. Left in flight it would block pi on a stream nothing
        // is ever going to write to, which reads as a model that stopped answering.
        settle(requestId)?.fail(error instanceof Error ? error.message : String(error));
      }
      return requestId;
    },
    deliver(requestId, event) {
      const sink = live.get(requestId);
      // Dropped rather than thrown on: the client aborted and there is nothing left to write to, which is ordinary.
      if (!sink) return;
      switch (event.kind) {
        case "head":
          sink.head(event.status, event.statusText, event.headers);
          return;
        case "chunk":
          sink.chunk(Buffer.from(event.data, "base64"));
          return;
        case "end":
          settle(requestId)?.end();
          return;
        case "error":
          settle(requestId)?.fail(event.message);
          return;
      }
    },
    abandon(requestId) {
      if (!live.has(requestId)) return;
      live.delete(requestId);
      options.transport.cancel(requestId);
    },
    failAll(reason) {
      for (const requestId of [...live.keys()]) settle(requestId)?.fail(reason);
    },
    inFlight: () => live.size,
  };
}

export interface ProviderProxyHandle {
  proxy: ProviderProxy;
  close(): Promise<void>;
}

// The whole inbound body, read before the request is carried. pi's request bodies are one JSON document — a
// conversation, not a stream — so there is nothing to gain from chunking one and a frame per body is what keeps the
// correlation trivial.
async function readBody(request: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function startProviderProxy(options: {
  token: string;
  transport: ProviderProxyTransport;
  newRequestId: () => string;
  port?: number;
}): Promise<ProviderProxyHandle> {
  const proxy = createProviderProxy(options);
  const server = createServer((request, response) => {
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : (value ?? ""),
      ]),
    );
    if (!isProviderProxyAuthorized(headers, options.token)) {
      response.writeHead(401).end();
      return;
    }
    void (async () => {
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await readBody(request);
      let requestId: string | undefined;
      const sink: ProviderProxySink = {
        head: (status, statusText, responseHeaders) => response.writeHead(status, statusText, responseHeaders),
        chunk: (bytes) => response.write(bytes),
        end: () => response.end(),
        fail: (message) => {
          // Logged, not echoed: the app's message is the app's, and a socket destroyed without a status is what tells
          // pi's client the answer failed rather than ended early.
          logger.error(`inference failed: ${message}`);
          if (response.headersSent) response.destroy();
          else response.writeHead(502).end();
        },
      };
      requestId = proxy.begin(
        {
          method: request.method ?? "GET",
          path: request.url ?? "/",
          headers: forwardedRequestHeaders(headers),
          ...(body ? { body } : {}),
        },
        sink,
      );
      // pi aborts a turn by dropping this socket. `close` fires for a finished response too, which is why `abandon`
      // is a no-op once the request has settled.
      response.on("close", () => proxy.abandon(requestId as string));
    })();
  });
  const port = options.port ?? PI_PROVIDER_PROXY_PORT;
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  logger.info(`the provider proxy is listening on 127.0.0.1:${port}`);
  return {
    proxy,
    close: () =>
      new Promise<void>((resolve) => {
        proxy.failAll("the session stopped");
        (server as Server).close(() => resolve());
      }),
  };
}
