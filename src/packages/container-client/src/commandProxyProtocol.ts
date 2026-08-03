// Shared shapes for engine HTTP (Command.ProxyRequest) — the one Command method that rides a persistent
// connection, so it is the chokepoint that opens the SSH tunnel / WSL relay / socket pool. The other methods
// (Spawn/Execute/SSH) are one-shot CLI and need none of this.
//
// Non-stream requests are a plain request/response call. Streaming responses (container logs) arrive as
// chunked events the caller reassembles into the on/off/destroy emitter Api.clients consumes. Neutral module
// (no shell/Zustand) so both shells' proxy clients and the broker agree on one set of shapes.

// Channel names for a shell that forwards these calls over a bus rather than invoking natively. Only
// CommandProxyBroker reads them today (see docs/todo.md).
export const COMMAND_PROXY = {
  request: "command:proxy-request", // invoke: non-stream → response; stream → handle
  streamEvent: "command:proxy-stream-event", // push: { streamId, type, payload }
  streamDestroy: "command:proxy-stream-destroy", // send: tear a forwarded stream down
} as const;

// The request payload. `req` is a serializable subset of the axios request config; the full Connection rides
// along so each request routes to that connection's host client by `connection.id`, letting several
// connections' HTTP be served at once (falls back to the primary when absent).
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

// Stream reply — the caller rebuilds an emitter keyed by streamId from the pushed events.
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
