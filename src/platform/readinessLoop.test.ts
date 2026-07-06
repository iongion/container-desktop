import { afterEach, describe, expect, it, vi } from "vitest";
import { superviseReadiness } from "./readinessLoop";

describe("superviseReadiness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits status checks and calls onReady once a probe succeeds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const checkStatus = vi.fn(async () => {
      attempts += 1;
      return attempts >= 2;
    });
    const onStatusCheck = vi.fn();
    const onReady = vi.fn();

    superviseReadiness(
      { pid: 123, retry: { count: 5, wait: 1000 } },
      { checkStatus, onStatusCheck, onReady, onError: vi.fn() },
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(onReady).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);

    expect(checkStatus).toHaveBeenCalledTimes(2);
    expect(checkStatus).toHaveBeenCalledWith({ pid: 123, started: true });
    expect(onStatusCheck).toHaveBeenNthCalledWith(1, { retries: 4, maxRetries: 5 });
    expect(onStatusCheck).toHaveBeenNthCalledWith(2, { retries: 3, maxRetries: 5 });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("calls onError after all retries are exhausted", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();

    superviseReadiness(
      { pid: 1, retry: { count: 2, wait: 1000 } },
      { checkStatus: async () => false, onStatusCheck: vi.fn(), onReady: vi.fn(), onError },
    );

    await vi.advanceTimersByTimeAsync(3000);

    expect(onError).toHaveBeenCalledWith({ type: "domain.max-retries", code: undefined });
  });

  it("does not start another probe while the previous probe is pending", async () => {
    vi.useFakeTimers();
    let releaseFirstProbe: ((value: boolean) => void) | undefined;
    const onStatusCheck = vi.fn();
    const checkStatus = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          releaseFirstProbe = resolve;
        }),
    );

    superviseReadiness(
      { pid: 9, retry: { count: 4, wait: 1000 } },
      { checkStatus, onStatusCheck, onReady: vi.fn(), onError: vi.fn() },
    );

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStatusCheck).toHaveBeenCalledTimes(1);

    releaseFirstProbe?.(false);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(onStatusCheck).toHaveBeenCalledTimes(2);
  });

  it("cancels future probes when the returned disposer is called", async () => {
    vi.useFakeTimers();
    const checkStatus = vi.fn(async () => false);

    const dispose = superviseReadiness(
      { pid: 7, retry: { count: 5, wait: 1000 } },
      { checkStatus, onStatusCheck: vi.fn(), onReady: vi.fn(), onError: vi.fn() },
    );

    await vi.advanceTimersByTimeAsync(1000);
    dispose();
    await vi.advanceTimersByTimeAsync(4000);

    expect(checkStatus).toHaveBeenCalledTimes(1);
  });
});
