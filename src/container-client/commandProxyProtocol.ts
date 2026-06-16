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
// Connection rides along, though main proxies via its own active host client (single connection).
export interface CommandProxyRequestPayload {
  req: Record<string, unknown>;
  connection: unknown;
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
