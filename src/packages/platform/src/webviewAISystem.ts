import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { AIKeyStore } from "@/ai-system/core/ports";
import type { AISettings, EngineOps, ProviderTransport } from "@/ai-system/core/types";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem } from "@/ai-system/host/createAISystem";
import { createOmaAgentSession } from "@/ai-system/runtime/omaAgentSession";
import { createOmaGoalRun } from "@/ai-system/runtime/omaGoalRun";
import type { DnsResolve, ExecuteIsolated, HostEnv } from "@/host-contract/capabilities";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { createFetchProviderTransport } from "@/platform/providerTransport/fetchProviderTransport";

export interface WebviewAISystemDeps<TEvent = unknown> {
  keychain: AIKeyStore;
  executeIsolated: ExecuteIsolated;
  dns: DnsResolve;
  env?: HostEnv;
  fs: IFileSystem;
  path: IPath;
  userDataDir: string;
  getAISettings: () => Promise<AISettings>;
  engineOps?: EngineOps;
  // Confined workspace for the file tools (Tauri/Wails supply an invoke-backed, host-confined impl).
  workspaceAccess?: IWorkspaceAccess;
  mock?: boolean;
  // Supplied by a shell that can reach the provider from outside this realm (Tauri). Requests needing a key are
  // routed to it so the secret is never resolved here.
  nativeProviderTransport?: ProviderTransport;
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  logger?: { error: (...args: unknown[]) => void };
}

// Keyless providers (auth.scheme "none") never read the keychain, so they stay on the in-webview fetch. Anything
// with a real scheme goes to the native transport, where the secret lives. The split is per request rather than
// per shell because a hardened local provider can require a key.
function routeByAuthScheme(native: ProviderTransport, webview: ProviderTransport): ProviderTransport {
  return {
    request: (request, signal) =>
      request.credential.auth.scheme === "none" ? webview.request(request, signal) : native.request(request, signal),
    dispose() {
      native.dispose();
      webview.dispose();
    },
  };
}

export async function createWebviewAISystem<TEvent = unknown>(
  deps: WebviewAISystemDeps<TEvent>,
): Promise<AIBroker<TEvent>> {
  // Dev-only, DCE'd from production: under CONTAINER_DESKTOP_MOCK, drive the open-multi-agent engine with a scripted
  // adapter; otherwise the real provider-backed engine. Both run the same owned loop in the webview realm.
  const mockEngine =
    deps.mock && import.meta.env.ENVIRONMENT !== "production" ? await import("@/ai-system/testing/omaMocks") : null;
  // This path really is a browser realm, so it keeps the Anthropic direct-browser-access header. The native
  // transport is not one and deliberately omits it.
  const webviewTransport = createFetchProviderTransport({
    keychain: deps.keychain,
    fetchImpl: globalThis.fetch,
    anthropicDirectBrowserAccess: true,
  });
  return createAISystem(
    {
      keychain: deps.keychain,
      executeIsolated: deps.executeIsolated,
      dns: deps.dns,
      env: deps.env ?? {},
    },
    {
      userDataDir: deps.userDataDir,
      fs: deps.fs,
      path: deps.path,
      sandboxCwd: deps.userDataDir,
      getAISettings: deps.getAISettings,
      createAgentSession: mockEngine?.createMockOmaAgentSession ?? createOmaAgentSession,
      createGoalRun: mockEngine?.createMockOmaGoalRun ?? createOmaGoalRun,
      onInvoke: deps.onInvoke,
      send: deps.send,
      senderId: deps.senderId,
      isAllowedSender: deps.isAllowedSender,
      providerTransport: deps.nativeProviderTransport
        ? routeByAuthScheme(deps.nativeProviderTransport, webviewTransport)
        : webviewTransport,
      publicWebFetchImpl: globalThis.fetch,
      engineOps: deps.engineOps,
      workspaceAccess: deps.workspaceAccess,
      mock: deps.mock,
      logger: deps.logger,
    },
  );
}
