import { createLogger } from "@/logger";
import { decodeEvent, encodeCommand } from "@/pi-bridge/codec";
import { type AppThemePalette, type BridgeEvent, PI_BRIDGE_PROTOCOL_VERSION } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

const logger = createLogger("ai.piBridgeClient");

// The DOM WebSocket surface this client needs, narrowed so tests drive it without a real socket.
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
}

export interface HostResponsePayload {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface PiBridgeClient {
  connect(): Promise<void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  // Answers one host_request. The container correlates by requestId, so a late answer is dropped rather
  // than resolving whatever request came next.
  respond(requestId: string, response: HostResponsePayload): Promise<void>;
  // One keystroke for a pi component, already encoded as the terminal bytes pi's key parser reads.
  surfaceInput(surfaceId: string, data: string): Promise<void>;
  surfaceResize(surfaceId: string, columns: number): Promise<void>;
  // The app's `--app-*` colours, so the container can derive a pi theme that matches the running app.
  setTheme(palette: Partial<AppThemePalette>): Promise<void>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  close(): void;
}

// The container's bridge binds its port a few hundred milliseconds AFTER `podman run --detach` returns, so a
// single-shot connect is a coin flip: the first attempt is reset and the session start fails for a reason that
// has nothing to do with the session. Retry until the port answers, then behave exactly as before.
const CONNECT_ATTEMPTS = 40;
const CONNECT_DELAY_MS = 250;

export function createPiBridgeClient(options: {
  url: string;
  token: string;
  socketFactory?: (url: string) => WebSocketLike;
  connectRetry?: { attempts: number; delayMs: number };
}): PiBridgeClient {
  const listeners = new Set<(event: BridgeEvent) => void>();
  let socket: WebSocketLike | undefined;

  const fanout = (event: BridgeEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        // One bad subscriber must not stop the stream for the others.
        logger.error("bridge listener threw", error);
      }
    }
  };

  return {
    connect(): Promise<void> {
      const attempts = options.connectRetry?.attempts ?? CONNECT_ATTEMPTS;
      const delayMs = options.connectRetry?.delayMs ?? CONNECT_DELAY_MS;
      return new Promise<void>((resolve, reject) => {
        let attempt = 0;
        let ready = false;

        const open = () => {
          attempt += 1;
          const created = options.socketFactory
            ? options.socketFactory(options.url)
            : (new WebSocket(options.url) as unknown as WebSocketLike);
          socket = created;
          // One attempt reports one outcome: a refused socket fires both error and close, and each must not
          // schedule its own retry.
          let done = false;
          const failed = (error: Error) => {
            if (ready || done) return;
            done = true;
            if (attempt >= attempts) {
              reject(error);
              return;
            }
            setTimeout(open, delayMs);
          };

          created.onopen = () => {
            created.send(
              encodeCommand({
                id: randomUUID(),
                type: "hello",
                token: options.token,
                protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
              }),
            );
          };
          created.onmessage = (message) => {
            let event: BridgeEvent;
            try {
              event = decodeEvent(String(message.data));
            } catch (error) {
              fanout({ type: "error", message: (error as Error).message });
              return;
            }
            if (event.type === "ready" && !ready) {
              ready = true;
              done = true;
              resolve();
            }
            fanout(event);
          };
          created.onclose = () => failed(new Error("bridge closed before ready"));
          created.onerror = (error) => {
            logger.error("bridge socket error", error);
            failed(new Error("bridge socket error"));
          };
        };

        open();
      });
    },
    async prompt(text: string): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "prompt", text }));
    },
    async abort(): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "abort" }));
    },
    async respond(requestId: string, response: HostResponsePayload): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "host_response", requestId, ...response }));
    },
    async surfaceInput(surfaceId: string, data: string): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "surface_input", surfaceId, data }));
    },
    async surfaceResize(surfaceId: string, columns: number): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "surface_resize", surfaceId, columns }));
    },
    async setTheme(palette: Partial<AppThemePalette>): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "set_theme", palette }));
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      socket?.close();
      listeners.clear();
    },
  };
}
