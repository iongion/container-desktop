// A tiny write coalescer for xterm: batches many small stream chunks into one terminal.write() per ~frame.
// Prevents xterm thrashing (and any residual flicker) under high log volume. Drains on a macrotask timer, NOT
// requestAnimationFrame: WebKitGTK (Tauri) holds pending rAF callbacks while the webview is idle, which would
// leave streamed logs buffered until an input event (the "logs don't paint until I click" freeze). A timer
// fires regardless of compositor idle state. The scheduler is injectable so it is unit-testable without timers.

export interface WriteBuffer {
  push: (data: string) => void;
  flushNow: () => void;
  reset: () => void;
  dispose: () => void;
}

export function createWriteBuffer(
  flush: (joined: string) => void,
  schedule: (cb: () => void) => number = (cb) => setTimeout(cb, 16) as unknown as number,
  cancel: (handle: number) => void = (handle) => clearTimeout(handle),
): WriteBuffer {
  let pending: string[] = [];
  let handle: number | null = null;
  let disposed = false;

  const clearScheduled = () => {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  };

  const drain = () => {
    handle = null;
    if (pending.length === 0) {
      return;
    }
    const joined = pending.join("");
    pending = [];
    flush(joined);
  };

  const reset = () => {
    clearScheduled();
    pending = [];
  };

  return {
    push(data: string) {
      if (disposed || !data) {
        return;
      }
      pending.push(data);
      if (handle === null) {
        handle = schedule(drain);
      }
    },
    flushNow() {
      clearScheduled();
      drain();
    },
    reset,
    dispose() {
      reset();
      disposed = true;
    },
  };
}
