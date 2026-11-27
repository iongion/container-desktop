// Tauri-side client for Command.ProxyRequest; it speaks to Rust proxy commands.
// The lower-level implementation lives in exec/proxy-request.ts.

import { createProxyRequest, type ProxyChannel, type ProxyRequestDeps } from "./exec/proxy-request";

export type { ProxyChannel };

export function createCommandProxyClient(deps: ProxyRequestDeps) {
  return createProxyRequest(deps);
}
