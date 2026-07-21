// Tauri-side client for Command.ProxyRequest. This is the named counterpart to
// platform/electron/commandProxyClient.ts; it speaks to Rust proxy commands instead of Electron main IPC.
// The lower-level implementation lives in exec/proxy-request.ts to stay aligned with node/exec/proxy-request.ts.

import { createProxyRequest, type ProxyChannel, type ProxyRequestDeps } from "./exec/proxy-request";

export type { ProxyChannel };

export function createCommandProxyClient(deps: ProxyRequestDeps) {
  return createProxyRequest(deps);
}
