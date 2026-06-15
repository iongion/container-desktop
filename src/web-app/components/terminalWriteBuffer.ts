// A tiny write coalescer for xterm: batches many small stream chunks into one terminal.write()
// per animation frame. Prevents xterm thrashing (and any residual flicker) under high log volume.
// The scheduler is injectable so it is unit-testable without a real animation frame.

export interface WriteBuffer {
  push: (data: string) => void;
  flushNow: () => void;
  reset: () => void;
  dispose: () => void;
}

export function createWriteBuffer(
  flush: (joined: string) => void,
  schedule: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
  cancel: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
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
