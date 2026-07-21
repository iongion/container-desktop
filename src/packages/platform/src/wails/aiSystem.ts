import type { AIBroker } from "@/ai-system/host/broker";
import { createWailsDnsResolve } from "@/platform/wails/capabilities/dns";
import { createWailsExecuteIsolated } from "@/platform/wails/capabilities/executeIsolated";
import type { WailsInvoke } from "@/platform/wails/capabilities/invoke";
import { createWailsKeychain } from "@/platform/wails/capabilities/keychain";
import { createWailsWorkspaceAccess } from "@/platform/wails/capabilities/workspaceAccess";
import { createWebviewAISystem, type WebviewAISystemDeps } from "@/platform/webviewAISystem";

export type AISystemDeps<TEvent = unknown> = Omit<
  WebviewAISystemDeps<TEvent>,
  "keychain" | "executeIsolated" | "dns" | "env"
> & { invoke: WailsInvoke };

export async function createAISystem<TEvent = unknown>(deps: AISystemDeps<TEvent>): Promise<AIBroker<TEvent>> {
  const keychain = await createWailsKeychain(deps.invoke);
  // TODO(ai-web-search): develop a scoped Go net/http service and replace the shared trusted-webview public fetch
  // fallback with a request that pins one of the addresses approved by the SSRF DNS guard.
  return createWebviewAISystem({
    ...deps,
    keychain,
    executeIsolated: createWailsExecuteIsolated(deps.invoke),
    dns: createWailsDnsResolve(deps.invoke),
    // Confined workspace, enforced natively in Go (workspace_service.go).
    workspaceAccess: createWailsWorkspaceAccess(deps.invoke, async () => (await deps.getAISettings()).workspaceRoot),
  });
}
