import type { IHostRuntime } from "./contract";

const DEFAULT_TIMEOUT_MS = 10_000;

interface Waiter {
  resolve: (runtime: IHostRuntime) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

let current: IHostRuntime | undefined;
let waiters: Waiter[] = [];

// Register (or replace) the host runtime and satisfy everything waiting on it.
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

// True once a runtime has been registered.
export function isHostRuntimeReady(): boolean {
  return current !== undefined;
}

// Synchronous accessor — throws if the runtime is not registered yet. Prefer awaitHostRuntime() during boot.
export function getHostRuntime(): IHostRuntime {
  if (!current) {
    throw new Error("Host runtime not registered — call registerHostRuntime() from the shell bootstrap first");
  }
  return current;
}

// Resolve with the runtime as soon as it is registered (immediately if already), rejecting after timeoutMs.
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

// Clear the registered runtime + drop pending waiters. For tests and dev/HMR re-bootstrap only.
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
