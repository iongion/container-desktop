import { describe, expect, it, vi } from "vitest";

import { createEmitterStream } from "./streamEmitter";

describe("createEmitterStream", () => {
  it("on/off/removeListener are chainable and actually add/remove listeners", () => {
    const { emitter, api } = createEmitterStream();
    const seen: string[] = [];
    const fn = (v: string) => seen.push(v);

    expect(api.on("data", fn)).toBe(api);
    emitter.emit("data", "a");
    expect(api.off("data", fn)).toBe(api);
    emitter.emit("data", "b"); // no listener anymore
    expect(seen).toEqual(["a"]);

    const fn2 = (v: string) => seen.push(v);
    expect(api.on("data", fn2)).toBe(api);
    expect(api.removeListener("data", fn2)).toBe(api);
    emitter.emit("data", "c"); // removed
    expect(seen).toEqual(["a"]);
  });

  it("re-emits driven events to subscribers in order", () => {
    const { emitter, api } = createEmitterStream();
    const seen: string[] = [];
    let ended = false;
    api.on("data", (v: string) => seen.push(v));
    api.on("end", () => {
      ended = true;
    });

    emitter.emit("data", "1");
    emitter.emit("data", "2");
    emitter.emit("end");

    expect(seen).toEqual(["1", "2"]);
    expect(ended).toBe(true);
  });

  it("destroy() is idempotent, runs onDestroy exactly once, and removes listeners", () => {
    const onDestroy = vi.fn();
    const { emitter, api } = createEmitterStream({ onDestroy });
    const fn = vi.fn();
    api.on("data", fn);

    api.destroy();
    api.destroy();
    api.close();

    expect(onDestroy).toHaveBeenCalledTimes(1);
    emitter.emit("data", "x"); // listeners gone
    expect(fn).not.toHaveBeenCalled();
  });

  it("close() delegates to destroy()", () => {
    const onDestroy = vi.fn();
    const { api } = createEmitterStream({ onDestroy });

    api.close();
    api.close();

    expect(onDestroy).toHaveBeenCalledTimes(1);
  });
});
