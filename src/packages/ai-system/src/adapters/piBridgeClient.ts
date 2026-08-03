import { createLogger } from "@/logger";
import { decodeEvent, encodeCommand } from "@/pi-bridge/codec";
import { type BridgeEvent, PI_BRIDGE_PROTOCOL_VERSION } from "@/pi-bridge/protocol";
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

export interface PiBridgeClient {
  connect(): Promise<void>;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
  close(): void;
}

export function createPiBridgeClient(options: {
  url: string;
  token: string;
  socketFactory?: (url: string) => WebSocketLike;
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
      return new Promise<void>((resolve, reject) => {
        const created = options.socketFactory
          ? options.socketFactory(options.url)
          : (new WebSocket(options.url) as unknown as WebSocketLike);
        socket = created;
        let ready = false;
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
            resolve();
          }
          fanout(event);
        };
        created.onclose = () => {
          if (!ready) reject(new Error("bridge closed before ready"));
        };
        created.onerror = (error) => {
          logger.error("bridge socket error", error);
          if (!ready) reject(new Error("bridge socket error"));
        };
      });
    },
    async prompt(text: string): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "prompt", text }));
    },
    async abort(): Promise<void> {
      socket?.send(encodeCommand({ id: randomUUID(), type: "abort" }));
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
