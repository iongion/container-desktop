import { describe, expect, it, vi } from "vitest";

import { createWriteBuffer } from "./terminalWriteBuffer";

function manualScheduler() {
  const queue: Array<(() => void) | null> = [];
  return {
    schedule: (cb: () => void) => queue.push(cb),
    cancel: (handle: number) => {
      queue[handle - 1] = null;
    },
    tick: () => {
      const items = queue.splice(0);
      for (const fn of items) fn?.();
    },
  };
}

describe("createWriteBuffer", () => {
  it("coalesces multiple pushes within a frame into one flush", () => {
    const flush = vi.fn();
    const s = manualScheduler();
    const buf = createWriteBuffer(flush, s.schedule, s.cancel);
    buf.push("a");
    buf.push("b");
    buf.push("c");
    expect(flush).not.toHaveBeenCalled();
    s.tick();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith("abc");
  });

  it("reschedules for pushes in a later frame", () => {
    const flush = vi.fn();
    const s = manualScheduler();
    const buf = createWriteBuffer(flush, s.schedule, s.cancel);
    buf.push("x");
    s.tick();
    buf.push("y");
    s.tick();
    expect(flush.mock.calls).toEqual([["x"], ["y"]]);
  });

  it("flushNow flushes synchronously and clears the schedule", () => {
    const flush = vi.fn();
    const s = manualScheduler();
    const buf = createWriteBuffer(flush, s.schedule, s.cancel);
    buf.push("now");
    buf.flushNow();
    expect(flush).toHaveBeenCalledWith("now");
    s.tick();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reset drops pending without flushing but stays usable", () => {
    const flush = vi.fn();
    const s = manualScheduler();
    const buf = createWriteBuffer(flush, s.schedule, s.cancel);
    buf.push("drop");
    buf.reset();
    s.tick();
    expect(flush).not.toHaveBeenCalled();
    buf.push("keep");
    s.tick();
    expect(flush).toHaveBeenCalledWith("keep");
  });

  it("dispose makes push a no-op", () => {
    const flush = vi.fn();
    const s = manualScheduler();
    const buf = createWriteBuffer(flush, s.schedule, s.cancel);
    buf.dispose();
    buf.push("z");
    s.tick();
    expect(flush).not.toHaveBeenCalled();
  });
});
