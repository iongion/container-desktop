import type { BridgeEvent, BridgeHostMethod } from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

export interface HostResponse {
  ok: boolean;
  value?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  fallback?: unknown;
  timer?: ReturnType<typeof setTimeout>;
  abandon?: () => void;
}

export interface HostRequestOptions<T> {
  timeoutMs?: number;
  fallback?: T;
  // pi lets an extension dismiss its own dialog. Aborting settles the agent side with the fallback; a late
  // answer from the app then lands on an unknown id and is dropped.
  signal?: AbortSignal;
}

export interface HostRpc {
  request<T>(method: BridgeHostMethod, payload: Record<string, unknown>, options?: HostRequestOptions<T>): Promise<T>;
  notify(method: BridgeHostMethod, payload: Record<string, unknown>): void;
  settle(requestId: string, response: HostResponse): void;
}

// A blocked dialog must never hang the agent forever: an unanswered request resolves to its fallback,
// which mirrors pi's own dialog timeout semantics rather than inventing new ones. Nothing rejects — a
// refusal is a value, so callers need no error path.
export function createHostRpc(emit: (event: BridgeEvent) => void): HostRpc {
  const pending = new Map<string, PendingRequest>();

  const finish = (requestId: string, value: unknown) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.abandon?.();
    entry.resolve(value);
  };

  return {
    request<T>(
      method: BridgeHostMethod,
      payload: Record<string, unknown>,
      options?: HostRequestOptions<T>,
    ): Promise<T> {
      const requestId = randomUUID();
      return new Promise<T>((resolve) => {
        const entry: PendingRequest = {
          resolve: resolve as (value: unknown) => void,
          fallback: options?.fallback,
        };
        if (options?.timeoutMs !== undefined) {
          entry.timer = setTimeout(() => finish(requestId, options.fallback), options.timeoutMs);
        }
        const signal = options?.signal;
        if (signal) {
          const onAbort = () => finish(requestId, options?.fallback);
          signal.addEventListener("abort", onAbort, { once: true });
          entry.abandon = () => signal.removeEventListener("abort", onAbort);
        }
        pending.set(requestId, entry);
        emit({ type: "host_request", requestId, method, payload, timeoutMs: options?.timeoutMs });
        if (signal?.aborted) finish(requestId, options?.fallback);
      });
    },
    notify(method: BridgeHostMethod, payload: Record<string, unknown>) {
      emit({ type: "host_request", requestId: randomUUID(), method, payload });
    },
    settle(requestId: string, response: HostResponse) {
      const entry = pending.get(requestId);
      if (!entry) return;
      finish(requestId, response.ok ? response.value : entry.fallback);
    },
  };
}
