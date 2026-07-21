import { afterEach, describe, expect, it, vi } from "vitest";

import type { IHostRuntime } from "./contract";
import {
  awaitHostRuntime,
  getHostRuntime,
  isHostRuntimeReady,
  registerHostRuntime,
  resetHostRuntime,
} from "./provider";

// The provider only stores/returns the object — it never inspects its shape — so a tagged stand-in is enough.
const makeRuntime = (tag = "runtime") => ({ tag }) as unknown as IHostRuntime;

describe("host-runtime provider", () => {
  afterEach(() => {
    resetHostRuntime();
    vi.useRealTimers();
  });

  it("throws from getHostRuntime before anything is registered", () => {
    expect(isHostRuntimeReady()).toBe(false);
    expect(() => getHostRuntime()).toThrow(/not registered/i);
  });

  it("returns the exact runtime after registration", () => {
    const runtime = makeRuntime();
    registerHostRuntime(runtime);
    expect(isHostRuntimeReady()).toBe(true);
    expect(getHostRuntime()).toBe(runtime);
  });

  it("awaitHostRuntime resolves immediately when already registered", async () => {
    const runtime = makeRuntime();
    registerHostRuntime(runtime);
    await expect(awaitHostRuntime()).resolves.toBe(runtime);
  });

  it("awaitHostRuntime resolves when registration happens later", async () => {
    const runtime = makeRuntime();
    const pending = awaitHostRuntime();
    registerHostRuntime(runtime);
    await expect(pending).resolves.toBe(runtime);
  });

  it("awaitHostRuntime rejects after the timeout when never registered", async () => {
    vi.useFakeTimers();
    const pending = awaitHostRuntime({ timeoutMs: 1500 });
    // Attach the rejection assertion synchronously so it isn't flagged unhandled while timers advance.
    const assertion = expect(pending).rejects.toThrow(/within 1500ms/i);
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
  });

  it("late registration cancels a pending timeout (no spurious rejection)", async () => {
    vi.useFakeTimers();
    const runtime = makeRuntime();
    const pending = awaitHostRuntime({ timeoutMs: 1000 });
    registerHostRuntime(runtime);
    await expect(pending).resolves.toBe(runtime);
    // Advancing past the original deadline must NOT reject anything.
    await vi.advanceTimersByTimeAsync(2000);
  });

  it("re-registration replaces the runtime and satisfies waiters with the newest", async () => {
    const first = makeRuntime("first");
    const second = makeRuntime("second");
    registerHostRuntime(first);
    registerHostRuntime(second);
    expect(getHostRuntime()).toBe(second);
    await expect(awaitHostRuntime()).resolves.toBe(second);
  });

  it("resetHostRuntime clears the registered runtime", () => {
    registerHostRuntime(makeRuntime());
    resetHostRuntime();
    expect(isHostRuntimeReady()).toBe(false);
    expect(() => getHostRuntime()).toThrow();
  });
});
