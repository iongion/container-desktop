import { Channel } from "@tauri-apps/api/core";
import { sessionWorkspaceRoot } from "@/ai-system/adapters/sessionWorkspace";
import type { AIBroker } from "@/ai-system/host/broker";
import { createTauriDnsResolve } from "@/platform/tauri/capabilities/dns";
import { createTauriExecuteIsolated } from "@/platform/tauri/capabilities/executeIsolated";
import type { TauriInvoke } from "@/platform/tauri/capabilities/invoke";
import { createTauriKeychain } from "@/platform/tauri/capabilities/keychain";
import { createTauriWorkspaceAccess } from "@/platform/tauri/capabilities/workspaceAccess";
import { createTauriProviderTransport } from "@/platform/tauri/providerTransport";
import { createTauriPublicWebFetch } from "@/platform/tauri/publicWebFetch";
import { createWebviewAISystem, type WebviewAISystemDeps } from "@/platform/webviewAISystem";

export type AISystemDeps<TEvent = unknown> = Omit<
  WebviewAISystemDeps<TEvent>,
  "keychain" | "executeIsolated" | "dns" | "env"
> & { invoke: TauriInvoke };

export async function createAISystem<TEvent = unknown>(deps: AISystemDeps<TEvent>): Promise<AIBroker> {
  const keychain = await createTauriKeychain(deps.invoke);
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
    // Address-pinned public web fetch: the web-search guard's validated addresses are re-checked + pinned in Rust
    // (public_web_fetch command), so the fetch cannot be DNS-rebound after validation.
    publicWebFetch: createTauriPublicWebFetch({
      invoke: deps.invoke,
      newChannel: () => new Channel<unknown>(),
    }),
    // Confined workspace, enforced natively in Rust (host.rs workspace_* commands). The root follows the RUNNING
    // session's mounted folder, and Settings → AI only when no session is up: acting on the folder the container
    // never had is wrong however well it is confined.
    workspaceAccess: createTauriWorkspaceAccess(
      deps.invoke,
      sessionWorkspaceRoot(async () => (await deps.getAISettings()).workspaceRoot),
    ),
  });
}
