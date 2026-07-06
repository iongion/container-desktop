// Shared protocol for forwarding the renderer's engine HTTP (Command.ProxyRequest) to the MAIN process,
// so a SINGLE engine connection (one SSH tunnel / WSL relay / socket pool) lives only in main. The renderer
// keeps the other Command methods local (Spawn/Execute/SSH are one-shot CLI, not persistent connections);
// only ProxyRequest — the one chokepoint that opens the tunnel/relay — is forwarded.
//
// Non-stream requests are a plain request/response invoke. Streaming responses (container logs) can't cross
// IPC as a Node stream, so main opens the stream and forwards chunked events the preload reassembles into
// the same on/off/destroy emitter Api.clients already consumes. Neutral module (no Electron/Zustand) so the
// preload, the main broker, and the shared types all agree.

export const COMMAND_PROXY = {
  request: "command:proxy-request", // renderer → main (invoke): non-stream → response; stream → handle
  streamEvent: "command:proxy-stream-event", // main → renderer (push): { streamId, type, payload }
  streamDestroy: "command:proxy-stream-destroy", // renderer → main (send): tear a forwarded stream down
} as const;

// What the preload sends to main. `req` is a serializable subset of the axios request config; the full
// Connection rides along — main routes each request to that connection's host client by `connection.id`,
// so several connections' forwarded HTTP can be served at once (falls back to the primary when absent).
export interface CommandProxyRequestPayload {
  req: Record<string, unknown>;
  connection?: ({ id?: string } & Record<string, unknown>) | null;
}

// Non-stream reply. On failure the engine's error response (status + body) is carried so the renderer can
// rebuild an axios-like error and the adapters' status checks behave exactly as for a local request.
export interface CommandProxyResponse {
  stream: false;
  ok: boolean;
  status?: number;
  statusText?: string;
  headers?: Record<string, unknown>;
  data?: unknown;
  message?: string;
}

// Stream reply — the preload rebuilds an emitter keyed by streamId from the pushed events.
export interface CommandProxyStreamHandle {
  stream: true;
  streamId: string;
  status?: number;
  headers?: Record<string, unknown>;
}

export type CommandProxyResult = CommandProxyResponse | CommandProxyStreamHandle;

export interface CommandProxyStreamEvent {
  streamId: string;
  type: "data" | "end" | "error";
  payload?: unknown;
}

export interface CommandProxyStreamDestroyRequest {
  streamId: string;
}

const SERIALIZABLE_REQUEST_KEYS = [
  "method",
  "url",
  "baseURL",
  "params",
  "data",
  "headers",
  "responseType",
  "timeout",
] as const;

export function pickSerializableRequest(request: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SERIALIZABLE_REQUEST_KEYS) {
    const value = request?.[key];
    if (value !== undefined) {
      out[key] = key === "headers" ? plainHeaders(value) : value;
    }
  }
  return out;
}

export function pickConnection(connection: any): Record<string, unknown> {
  const api = connection?.settings?.api ?? {};
  return {
    id: connection?.id,
    host: connection?.host,
    settings: {
      api: {
        baseURL: api.baseURL,
        connection: {
          uri: api.connection?.uri,
          relay: api.connection?.relay,
        },
      },
    },
  };
}

export function shapeBufferedResponse(response: any): any {
  const headers = response?.headers ?? {};
  if (response?.ok) {
    return { data: response.data, status: response.status, statusText: response.statusText ?? "", headers };
  }
  return {
    __proxyError: true,
    status: response?.status ?? 0,
    statusText: response?.statusText ?? "",
    data: response?.data,
    headers,
    message: response?.message,
  };
}

function plainHeaders(headers: any): Record<string, string> {
  const source = headers && typeof headers.toJSON === "function" ? headers.toJSON() : headers;
  const out: Record<string, string> = {};
  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      if (value == null) {
        continue;
      }
      const type = typeof value;
      if (type === "string" || type === "number" || type === "boolean") {
        out[key] = String(value);
      }
    }
  }
  return out;
}
