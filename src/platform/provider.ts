// Realm-agnostic accessor for the assembled IHostRuntime — the ONE place the portable app (renderer +
// container-client + the main-owned engine layer) reaches the host-capability port, regardless of which shell
// provides it.
//
// Electron: the renderer bootstrap assembles the runtime from the contextBridge'd window.* globals and calls
// registerHostRuntime(); Tauri: the webview bootstrap builds it from @tauri-apps/api over the Rust backend and
// registers the same way. Consumers then use getHostRuntime()/awaitHostRuntime() instead of poking window.*
// directly — this is what replaces waitForPreload (polling window.Preloaded) and the scattered
// `if (!window.X)` guards, and it gives the Tauri binding a single, typed hand-off point.

import type { IHostRuntime } from "./contract";

const DEFAULT_TIMEOUT_MS = 10_000;

interface Waiter {
  resolve: (runtime: IHostRuntime) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

let current: IHostRuntime | undefined;
let waiters: Waiter[] = [];

/** Register (or replace) the host runtime and satisfy everything waiting on it. */
export function registerHostRuntime(runtime: IHostRuntime): void {
  current = runtime;
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) {
    if (waiter.timer !== undefined) {
      clearTimeout(waiter.timer);
    }
    waiter.resolve(runtime);
  }
}

/** True once a runtime has been registered. */
export function isHostRuntimeReady(): boolean {
  return current !== undefined;
}

/** Synchronous accessor — throws if the runtime is not registered yet. Prefer awaitHostRuntime() during boot. */
export function getHostRuntime(): IHostRuntime {
  if (!current) {
    throw new Error("Host runtime not registered — call registerHostRuntime() from the shell bootstrap first");
  }
  return current;
}

/** Resolve with the runtime as soon as it is registered (immediately if already), rejecting after timeoutMs. */
export function awaitHostRuntime(options?: { timeoutMs?: number }): Promise<IHostRuntime> {
  if (current) {
    return Promise.resolve(current);
  }
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise<IHostRuntime>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => {
      waiters = waiters.filter((entry) => entry !== waiter);
      reject(new Error(`Host runtime not registered within ${timeoutMs}ms`));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

/** Clear the registered runtime + drop pending waiters. For tests and dev/HMR re-bootstrap only. */
export function resetHostRuntime(): void {
  const pending = waiters;
  waiters = [];
  for (const waiter of pending) {
    if (waiter.timer !== undefined) {
      clearTimeout(waiter.timer);
    }
  }
  current = undefined;
}
