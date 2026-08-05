import type { ResolvedFetch } from "@/ai-system/adapters/webSearch";
import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { AIKeyStore, ConnectionExecHost } from "@/ai-system/core/ports";
import type { AISettings, EngineOps, ProviderTransport } from "@/ai-system/core/types";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem } from "@/ai-system/host/createAISystem";
import type { DnsResolve, ExecuteIsolated, HostEnv } from "@/host-contract/capabilities";
import type { IFileDiscoverySystem, IPath } from "@/host-contract/fs";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import { createExecutionSelector } from "@/platform/capabilities/executionSelector";
import { createFetchProviderTransport } from "@/platform/providerTransport/fetchProviderTransport";

export interface WebviewAISystemDeps<TEvent = unknown> {
  keychain: AIKeyStore;
  executeIsolated: ExecuteIsolated;
  dns: DnsResolve;
  env?: HostEnv;
  fs: IFileDiscoverySystem;
  path: IPath;
  userDataDir: string;
  getAISettings: () => Promise<AISettings>;
  engineOps?: EngineOps;
  // Confined workspace for the file tools (Tauri/Wails supply an invoke-backed, host-confined impl).
  workspaceAccess?: IWorkspaceAccess;
  // Captured exec against any connection — the backend for a session whose execution target is a container the
  // connection already runs, or a disposable sandbox it creates. Absent ⇒ no execution selector is built and a
  // workspace call is ANSWERED WITH A FAILURE rather than served here, so a session that chose a container can
  // never quietly act on this machine instead.
  connectionExec?: ConnectionExecHost;
  mock?: boolean;
  // Supplied by a shell that can reach the provider from outside this realm (Tauri). Requests needing a key are
  // routed to it so the secret is never resolved here.
  nativeProviderTransport?: ProviderTransport;
  // Address-pinned public web fetch (Tauri Rust / Wails Go). Absent ⇒ the web-search guard falls back to the
  // in-webview fetch (publicWebFetchImpl), which cannot pin and is DNS-rebinding vulnerable.
  publicWebFetch?: ResolvedFetch;
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

export async function createWebviewAISystem<TEvent = unknown>(deps: WebviewAISystemDeps<TEvent>): Promise<AIBroker> {
  // Run-scoped execution selector: an execution target resolves to its own backend through the connection-exec
  // capability. Under CONTAINER_DESKTOP_MOCK the in-memory VirtualEngineHost stands in for a real engine so the
  // probe below genuinely resolves and runs on its sandbox target. Absent connectionExec (and not mock) ⇒ no
  // selector, and every workspace call fails instead.
  const mockVirtualHost =
    deps.mock && import.meta.env.ENVIRONMENT !== "production"
      ? (await import("@/ai-system/testing/virtualEngineHost")).createVirtualEngineHost()
      : null;
  const connectionExec = mockVirtualHost ?? deps.connectionExec;

  // Mock-only runtime-proof seam, DCE'd from production with the rest of the mock arm (mockVirtualHost is null
  // otherwise). It drives the REAL execution selector against a sandbox target so a WebKitGTK/WebDriver e2e can
  // prove, in the webview realm, that the session's files live IN the container: a file written through the
  // container-routed workspace reads back, and the labeled sandbox is created then disposed (liveSandboxes
  // 0 → 1 → 0). The Tauri/Wails runtime counterpart to the hermetic executionTargets.mock.test — same real
  // selector, driven in the webview.
  if (mockVirtualHost) {
    const virtualHost = mockVirtualHost;
    (globalThis as { __aiSandboxExecProbe?: () => Promise<unknown> }).__aiSandboxExecProbe = async () => {
      const selector = createExecutionSelector({
        runId: "sandbox-proof",
        engineOps: deps.engineOps,
        connectionExec: virtualHost,
      });
      const before = virtualHost.liveSandboxes().length;
      const resolved = await selector.select({ kind: "sandbox", connectionId: "mock-connection", image: "alpine:3" });
      await resolved.workspaceAccess?.write("sandbox-proof.txt", "hello-sandbox");
      const readBack = await resolved.workspaceAccess?.read("sandbox-proof.txt");
      const during = virtualHost.liveSandboxes().length;
      await resolved.dispose();
      const after = virtualHost.liveSandboxes().length;
      return { before, during, after, readBack };
    };
  }

  // Dev-only, DCE'd from production: the REAL-ENGINE execution-target matrix, driven by a WebDriver spec. Unlike
  // the mock probe above it runs on this shell's SHIPPED adapters — engineOps, connectionExec and workspaceAccess
  // are the ones the app itself uses, so it proves the Rust/Go container-exec path against live engines. Returns
  // the shared verification's failures; [] means the matrix passed.

  const createExecutionSelectorFactory = connectionExec
    ? (runId: string) =>
        createExecutionSelector({
          runId,
          engineOps: deps.engineOps,
          connectionExec,
        })
    : undefined;

  // This path really is a browser realm, so it keeps the Anthropic direct-browser-access header. The native
  // transport is not one and deliberately omits it.
  // `fetch` must stay BOUND to its realm: handed over bare and invoked as `fetchImpl(...)` it loses `this`,
  // and WebKit refuses it outright ("Can only call Window.fetch on instances of Window").
  const boundFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
  const webviewTransport = createFetchProviderTransport({
    keychain: deps.keychain,
    fetchImpl: boundFetch,
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
      onInvoke: deps.onInvoke,
      send: deps.send,
      senderId: deps.senderId,
      isAllowedSender: deps.isAllowedSender,
      providerTransport: deps.nativeProviderTransport
        ? routeByAuthScheme(deps.nativeProviderTransport, webviewTransport)
        : webviewTransport,
      publicWebFetch: deps.publicWebFetch,
      publicWebFetchImpl: boundFetch,
      engineOps: deps.engineOps,
      workspaceAccess: deps.workspaceAccess,
      createExecutionSelector: createExecutionSelectorFactory,
      mock: deps.mock,
      logger: deps.logger,
    },
  );
}
