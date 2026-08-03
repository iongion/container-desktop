// Tauri-side client for Command.ProxyRequest. This is the named counterpart to
// its Wails peer; it speaks to Rust proxy commands.
// The lower-level implementation lives in exec/proxy-request.ts, mirroring the Wails layout file for file.

import { createProxyRequest, type ProxyChannel, type ProxyRequestDeps } from "./exec/proxy-request";

export type { ProxyChannel };

export function createCommandProxyClient(deps: ProxyRequestDeps) {
  return createProxyRequest(deps);
}
