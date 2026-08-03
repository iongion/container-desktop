import type { ResolvedFetch } from "@/ai-system/adapters/webSearch";
import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { AIKeyStore, ConnectionExecHost } from "@/ai-system/core/ports";
import type { AISettings, EngineOps, ProviderTransport } from "@/ai-system/core/types";
import type { AIBroker } from "@/ai-system/host/broker";
import { createAISystem } from "@/ai-system/host/createAISystem";
import { compactOmaThreadContext, createOmaAgentSession } from "@/ai-system/runtime/omaAgentSession";
import { createOmaTeamRun } from "@/ai-system/runtime/omaTeamRun";
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
  // Captured exec against any connection — the backend for a worker whose "Runs on" target is a remote host or a
  // container. Absent ⇒ no execution selector is built and every off-host worker falls back to the run-level host
  // workspace (the pre-Runs-on behaviour). Without it, a worker configured for a sandbox silently ran on the host.
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
  // Dev-only, DCE'd from production: under CONTAINER_DESKTOP_MOCK, drive the open-multi-agent engine with a scripted
  // adapter; otherwise the real provider-backed OMA engine. Both run in the webview realm.
  const mockEngine =
    deps.mock && import.meta.env.ENVIRONMENT !== "production" ? await import("@/ai-system/testing/omaMocks") : null;

  // Run-scoped execution selector: a worker's off-host "Runs on"
  // target resolves to its own backend through the connection-exec capability. Under CONTAINER_DESKTOP_MOCK the
  // in-memory VirtualEngineHost stands in for a real engine so mock Team Run workers genuinely resolve/run on their
  // sandbox/container/remote target. Absent connectionExec (and not mock) ⇒ no selector, host-only fallback.
  const mockVirtualHost =
    deps.mock && import.meta.env.ENVIRONMENT !== "production"
      ? (await import("@/ai-system/testing/virtualEngineHost")).createVirtualEngineHost()
      : null;
  const connectionExec = mockVirtualHost ?? deps.connectionExec;

  // Mock-only runtime-proof seam, DCE'd from production with the rest of the mock arm (mockVirtualHost is null
  // otherwise). It drives the REAL execution selector against a sandbox target so a WebKitGTK/WebDriver e2e can
  // prove a worker runs OFF-host in the webview realm: a file written through the container-routed workspace reads
  // back, and the labeled sandbox is created then disposed (liveSandboxes 0 → 1 → 0). This is the Tauri/Wails
  // runtime counterpart to the hermetic executionTargets.mock.test — same real selector, driven in the webview.
  if (mockVirtualHost) {
    const virtualHost = mockVirtualHost;
    (globalThis as { __aiOffHostProbe?: () => Promise<unknown> }).__aiOffHostProbe = async () => {
      const selector = createExecutionSelector({
        runId: "offhost-proof",
        engineOps: deps.engineOps,
        localWorkspace: deps.workspaceAccess,
        connectionExec: virtualHost,
      });
      const before = virtualHost.liveSandboxes().length;
      const resolved = await selector.select({ kind: "sandbox", connectionId: "mock-connection", image: "alpine:3" });
      await resolved.workspaceAccess?.write("offhost-proof.txt", "hello-offhost");
      const readBack = await resolved.workspaceAccess?.read("offhost-proof.txt");
      const during = virtualHost.liveSandboxes().length;
      await resolved.dispose();
      const after = virtualHost.liveSandboxes().length;
      return { before, during, after, readBack };
    };
  }

  // Dev-only, DCE'd from production: the REAL-ENGINE execution-target matrix, driven by a WebDriver spec. Unlike
  // the mock probe above it runs on this shell's SHIPPED adapters — engineOps, connectionExec and workspaceAccess
  // are the ones the app itself uses, so it proves the Rust/Go off-host path against live engines. Returns the
  // shared verification's failures; [] means the matrix passed.
  if (import.meta.env.ENVIRONMENT !== "production" && connectionExec && deps.engineOps && deps.workspaceAccess) {
    const liveConnectionExec = connectionExec;
    const liveEngineOps = deps.engineOps;
    const liveWorkspace = deps.workspaceAccess;
    type MatrixSpec = {
      connectionId: string;
      image: string;
      supportsRemote: boolean;
      supportsEngine?: boolean;
      existingContainerId?: string;
      sandboxLabel: string;
    };
    (globalThis as { __cdExecutionMatrixProbe?: (spec: MatrixSpec) => Promise<string[]> }).__cdExecutionMatrixProbe =
      async (spec) => {
        const { observeExecutionTargets, verifyExecutionTargets } = await import(
          "@/__tests__/support/executionTargetMatrix"
        );
        // Ask the ENGINE how many of this run's sandboxes are still alive, so teardown is proven against reality
        // rather than against bookkeeping.
        const pendingSandboxes = async () => {
          const containers = await liveEngineOps.listContainers({ connectionId: spec.connectionId });
          return containers.filter((container) =>
            JSON.stringify((container as { Labels?: unknown }).Labels ?? {}).includes(spec.sandboxLabel),
          ).length;
        };
        const observations = await observeExecutionTargets("live", {
          connectionId: spec.connectionId,
          connectionExec: liveConnectionExec,
          localWorkspace: liveWorkspace,
          image: spec.image,
          supportsRemote: spec.supportsRemote,
          supportsEngine: spec.supportsEngine,
          existingContainerId: spec.existingContainerId,
          pendingSandboxes,
        });
        return verifyExecutionTargets(observations);
      };
  }

  const createExecutionSelectorFactory = connectionExec
    ? (runId: string) =>
        createExecutionSelector({
          runId,
          engineOps: deps.engineOps,
          localWorkspace: deps.workspaceAccess,
          connectionExec,
        })
    : undefined;

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
      compactThreadContext: mockEngine?.compactMockThreadContext ?? compactOmaThreadContext,
      createTeamRun: mockEngine?.createMockOmaTeamRun ?? createOmaTeamRun,
      onInvoke: deps.onInvoke,
      send: deps.send,
      senderId: deps.senderId,
      isAllowedSender: deps.isAllowedSender,
      providerTransport: deps.nativeProviderTransport
        ? routeByAuthScheme(deps.nativeProviderTransport, webviewTransport)
        : webviewTransport,
      publicWebFetch: deps.publicWebFetch,
      publicWebFetchImpl: globalThis.fetch,
      engineOps: deps.engineOps,
      workspaceAccess: deps.workspaceAccess,
      createExecutionSelector: createExecutionSelectorFactory,
      mock: deps.mock,
      logger: deps.logger,
    },
  );
}
