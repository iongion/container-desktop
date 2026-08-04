import { sessionWorkspaceRoot } from "@/ai-system/adapters/sessionWorkspace";
import type { AIBroker } from "@/ai-system/host/broker";
import { createWailsDnsResolve } from "@/platform/wails/capabilities/dns";
import { createWailsExecuteIsolated } from "@/platform/wails/capabilities/executeIsolated";
import type { WailsInvoke } from "@/platform/wails/capabilities/invoke";
import { createWailsKeychain } from "@/platform/wails/capabilities/keychain";
import { createWailsWorkspaceAccess } from "@/platform/wails/capabilities/workspaceAccess";
import { createWailsPublicWebFetch, type WailsPublicWebFetchChannel } from "@/platform/wails/publicWebFetch";
import { createWebviewAISystem, type WebviewAISystemDeps } from "@/platform/webviewAISystem";

export type AISystemDeps<TEvent = unknown> = Omit<
  WebviewAISystemDeps<TEvent>,
  "keychain" | "executeIsolated" | "dns" | "env" | "publicWebFetch"
> & {
  invoke: WailsInvoke;
  // The @wailsio seam is bridge.ts only, so the stream channel is injected from there (like newProxyChannel).
  newPublicWebFetchChannel: () => WailsPublicWebFetchChannel;
};

export async function createAISystem<TEvent = unknown>(deps: AISystemDeps<TEvent>): Promise<AIBroker> {
  const keychain = await createWailsKeychain(deps.invoke);
  return createWebviewAISystem({
    ...deps,
    keychain,
    executeIsolated: createWailsExecuteIsolated(deps.invoke),
    dns: createWailsDnsResolve(deps.invoke),
    // Address-pinned public web fetch: the web-search guard's validated addresses are re-checked + pinned in Go
    // (PublicWebFetchService), so the fetch cannot be DNS-rebound after validation.
    publicWebFetch: createWailsPublicWebFetch({ invoke: deps.invoke, newChannel: deps.newPublicWebFetchChannel }),
    // Confined workspace, enforced natively in Go (workspace_service.go). The root follows the RUNNING session's
    // mounted folder, and Settings → AI only when no session is up — the same rule as the Tauri shell.
    workspaceAccess: createWailsWorkspaceAccess(
      deps.invoke,
      sessionWorkspaceRoot(async () => (await deps.getAISettings()).workspaceRoot),
    ),
  });
}
