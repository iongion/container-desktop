import type { ResolvedFetch } from "@/ai-system/adapters/webSearch";

import type { TauriInvoke } from "./capabilities/invoke";
import type { ProviderTransportChannel } from "./providerTransport";

interface PublicFetchHandle {
  streamId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export interface TauriPublicWebFetchDeps {
  invoke: TauriInvoke;
  newChannel: () => ProviderTransportChannel;
}

// A body frame can reach us from another realm, where `instanceof ArrayBuffer` is false for a genuine buffer, so
// identity is confirmed by brand rather than by constructor. Misreading a frame as a control event would silently
// drop response bytes. Copied verbatim from ./providerTransport.ts.
function asBytes(message: unknown): Uint8Array | null {
  if (message instanceof ArrayBuffer) return new Uint8Array(message);
  if (ArrayBuffer.isView(message)) return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  if (Object.prototype.toString.call(message) === "[object ArrayBuffer]") {
    return new Uint8Array(message as ArrayBuffer);
  }
  return null;
}

// A native ResolvedFetch for the Tauri webview: the URL is dialed only at one of the pre-validated PUBLIC IPs
// (Rust re-checks + pins), no redirect is followed (the guard walks them), and the body streams over a Channel.
// The size cap, timeout and abort stay in the JS SSRF guard (webSearch.ts) — this adapter only bridges the stream.
export function createTauriPublicWebFetch(deps: TauriPublicWebFetchDeps): ResolvedFetch {
  return async (url, addresses, init) => {
    const channel = deps.newChannel();
    let streamId: string | undefined;
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
      void deps.invoke("public_web_fetch_destroy", { streamId }).catch(() => undefined);
    };

    channel.onmessage = (message) => {
      const bytes = asBytes(message);
      if (bytes) {
        queue.push(bytes);
        wake();
        return;
      }
      const event = message as { type?: string; payload?: { message?: string } };
      if (event?.type === "end") done = true;
      else if (event?.type === "error") failure = new Error(event.payload?.message ?? "AI: web fetch stream error");
      wake();
    };

    const signal = init.signal ?? undefined;
    const onAbort = () => {
      failure = failure ?? new Error("AI: web fetch aborted");
      destroy();
      wake();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit).forEach((value, key) => {
      headers[key] = value;
    });

    const handle = await deps.invoke<PublicFetchHandle>("public_web_fetch_request", {
      payload: { url, addresses, method: init.method ?? "GET", headers },
      channel,
    });
    streamId = handle.streamId;
    if (signal?.aborted) onAbort();

    const cleanup = () => signal?.removeEventListener("abort", onAbort);
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

    return new Response(body, { status: handle.status, statusText: handle.statusText, headers: handle.headers });
  };
}
