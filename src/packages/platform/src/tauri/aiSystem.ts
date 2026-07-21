import { Channel } from "@tauri-apps/api/core";
import type { AIBroker } from "@/ai-system/host/broker";
import { createTauriDnsResolve } from "@/platform/tauri/capabilities/dns";
import { createTauriExecuteIsolated } from "@/platform/tauri/capabilities/executeIsolated";
import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";
import { createTauriKeychain } from "@/platform/tauri/capabilities/keychain";
import { createTauriWorkspaceAccess } from "@/platform/tauri/capabilities/workspaceAccess";
import { createTauriProviderTransport } from "@/platform/tauri/providerTransport";
import { createWebviewAISystem, type WebviewAISystemDeps } from "@/platform/webviewAISystem";

export type AISystemDeps<TEvent = unknown> = Omit<
  WebviewAISystemDeps<TEvent>,
  "keychain" | "executeIsolated" | "dns" | "env"
> & { invoke: TauriInvoke };

export async function createAISystem<TEvent = unknown>(deps: AISystemDeps<TEvent>): Promise<AIBroker<TEvent>> {
  const keychain = await createTauriKeychain(deps.invoke);
  // TODO(ai-web-search): install Tauri's scoped Rust HTTP client and replace the shared trusted-webview public
  // fetch fallback with a request that pins one of the addresses approved by the SSRF DNS guard.
  return createWebviewAISystem({
    ...deps,
    keychain,
    executeIsolated: createTauriExecuteIsolated(deps.invoke),
    dns: createTauriDnsResolve(deps.invoke),
    // The provider key is resolved in Rust and attached there, so it never reaches this realm.
    nativeProviderTransport: createTauriProviderTransport({
      invoke: deps.invoke,
      newChannel: () => new Channel<unknown>(),
    }),
    // Confined workspace, enforced natively in Rust (host.rs workspace_* commands).
    workspaceAccess: createTauriWorkspaceAccess(deps.invoke, async () => (await deps.getAISettings()).workspaceRoot),
  });
}
