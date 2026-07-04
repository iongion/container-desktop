let engineProxyEnv: Record<string, string> = {};

export function setEngineProxyEnv(env?: Record<string, string>): void {
  engineProxyEnv = Object.freeze({ ...(env ?? {}) });
}

export function getEngineProxyEnv(): Record<string, string> {
  return { ...engineProxyEnv };
}
