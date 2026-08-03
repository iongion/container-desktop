import type { ProviderTransport, ProviderTransportResponse } from "@/ai-system/core/types";

import type { TauriInvoke } from "./capabilities/invoke";

// A Tauri Channel reduced to what this module uses. Body chunks arrive as raw ArrayBuffer frames
// (InvokeResponseBody::Raw); control events arrive as JSON objects.
export interface ProviderTransportChannel {
  onmessage: ((message: unknown) => void) | null;
}

export interface TauriProviderTransportDeps {
  invoke: TauriInvoke;
  newChannel: () => ProviderTransportChannel;
}

interface ProviderResponseHandle {
  streamId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

// A body frame can reach us from another realm, where `instanceof ArrayBuffer` is false for a genuine buffer, so
// identity is confirmed by brand rather than by constructor. Misreading a frame as a control event would silently
// drop response bytes.
function asBytes(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  if (Object.prototype.toString.call(message) === "[object ArrayBuffer]") {
    return new Uint8Array(message as ArrayBuffer);
  }
  return null;
}

// Provider transport for the Tauri webview. The request names a provider id; Rust resolves the key, attaches the
// auth headers and pins the origin, so the secret never enters this realm. Timeout, the response cap and abort
// stay here so there is one implementation of each rather than one per shell.
export function createTauriProviderTransport(deps: TauriProviderTransportDeps): ProviderTransport {
  const active = new Set<string>();

  return {
    async request(request, signal): Promise<ProviderTransportResponse> {
      const channel = deps.newChannel();
      let streamId: string | undefined;
      let received = 0;
      const queue: Uint8Array[] = [];
      let push: (() => void) | null = null;
      let done = false;
      let failure: Error | null = null;

      const wake = () => {
        push?.();
        push = null;
      };
      const destroy = () => {
        if (!streamId) return;
        active.delete(streamId);
        void deps.invoke("provider_transport_destroy", { streamId }).catch(() => undefined);
      };

      channel.onmessage = (message) => {
        const bytes = asBytes(message);
        if (bytes) {
          received += bytes.byteLength;
          if (received > request.maxResponseBytes) {
            failure = new Error("AI: provider response is too large");
            destroy();
          } else {
            queue.push(bytes);
          }
          wake();
          return;
        }
        const event = message as { type?: string; payload?: { message?: string } };
        if (event?.type === "end") done = true;
        else if (event?.type === "error") failure = new Error(event.payload?.message ?? "AI: provider stream error");
        wake();
      };

      const onAbort = () => {
        failure = failure ?? new Error("AI: provider request aborted");
        destroy();
        wake();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const timeout = setTimeout(() => {
        failure = new Error("AI: provider request timed out");
        destroy();
        wake();
      }, request.timeoutMs);
      timeout.unref?.();

      const handle = await deps.invoke<ProviderResponseHandle>("provider_transport_request", {
        payload: {
          credential: request.credential,
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body ? Array.from(request.body) : undefined,
          timeoutMs: request.timeoutMs,
        },
        channel,
      });
      streamId = handle.streamId;
      active.add(streamId);
      if (signal.aborted) onAbort();

      const cleanup = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort);
      };

      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (;;) {
            if (queue.length > 0) {
              controller.enqueue(queue.shift() as Uint8Array);
              return;
            }
            if (failure) {
              cleanup();
              controller.error(failure);
              return;
            }
            if (done) {
              cleanup();
              controller.close();
              return;
            }
            await new Promise<void>((resolve) => {
              push = resolve;
            });
          }
        },
        cancel() {
          destroy();
          cleanup();
        },
      });

      return { status: handle.status, statusText: handle.statusText, headers: handle.headers, body };
    },
    dispose() {
      for (const streamId of active) {
        void deps.invoke("provider_transport_destroy", { streamId }).catch(() => undefined);
      }
      active.clear();
    },
  };
}
