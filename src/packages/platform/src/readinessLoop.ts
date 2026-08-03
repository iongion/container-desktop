export const DEFAULT_RETRIES_COUNT = 10;

export interface ReadinessRetryOptions {
  count?: number;
  wait?: number;
}

export interface ReadinessLoopOptions {
  pid?: number | null;
  retry?: ReadinessRetryOptions;
}

export interface ReadinessStatus {
  retries: number;
  maxRetries: number;
}

export interface ReadinessCheckStatus {
  pid: number | null;
  started: boolean;
}

export interface ReadinessLoopHooks {
  checkStatus?: (status: ReadinessCheckStatus) => boolean | Promise<boolean>;
  onStatusCheck?: (status: ReadinessStatus) => void;
  onReady: () => void;
  onError: (error: { type: "domain.max-retries"; code: undefined }) => void;
  onProbeError?: (error: unknown) => void;
  onPendingSkip?: () => void;
}

export function superviseReadiness(options: ReadinessLoopOptions, hooks: ReadinessLoopHooks): () => void {
  const maxRetries = options.retry?.count || DEFAULT_RETRIES_COUNT;
  const wait = options.retry?.wait || 2000;
  let retries = maxRetries;
  let pending = false;
  const interval = setInterval(async () => {
    if (pending) {
      hooks.onPendingSkip?.();
      return;
    }
    if (retries === 0) {
      clearInterval(interval);
      hooks.onError({ type: "domain.max-retries", code: undefined });
      return;
    }
    retries -= 1;
    pending = true;
    let running = false;
    try {
      hooks.onStatusCheck?.({ retries, maxRetries });
      running = hooks.checkStatus ? await hooks.checkStatus({ pid: options.pid ?? null, started: true }) : false;
    } catch (error) {
      hooks.onProbeError?.(error);
    } finally {
      pending = false;
    }
    if (running) {
      clearInterval(interval);
      hooks.onReady();
    }
  }, wait);
  return () => clearInterval(interval);
}
