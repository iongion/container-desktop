import { createConversationFileStore } from "@/ai-system/adapters/conversationFileStore";
import { createKnowledgeFileStorage } from "@/ai-system/adapters/knowledgeFileStorage";
import { listModels } from "@/ai-system/adapters/localModels";
import { createPermissionsStore } from "@/ai-system/adapters/permissionsStoreCore";
import { executeSandboxed } from "@/ai-system/adapters/sandbox";
import { type ResolvedFetch, webSearch } from "@/ai-system/adapters/webSearch";
import { createWorkerFileStore } from "@/ai-system/adapters/workerFileStore";
import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { AISettings, CreateAgentSession, CreateGoalRun, EngineOps } from "@/ai-system/core/types";
import { type AIBroker, createAIBroker } from "@/ai-system/host/broker";
import { createConversationRepository } from "@/ai-system/host/conversationRepository";
import { createKnowledgeBank } from "@/ai-system/host/knowledgeBank";
import { createWorkerHost } from "@/ai-system/host/workerHost";
import { buildAgentPrompt } from "@/template/prompts";
import "@/template/templateRegistry.vite";
import type { ProviderTransport } from "@/ai-system/core/types";
import type { IHostCapabilities } from "@/host-contract/capabilities";
import type { IFileSystem, IPath } from "@/host-contract/fs";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";

// `TEvent` is the shell's IPC invoke event, a type parameter so this shared composition root never names an
// Electron/Tauri/Wails type; each shell supplies its own concrete event (see AIBroker in broker.ts).
export interface AISystemDeps<TEvent = unknown> {
  // OS app-data dir — where the AI permission + knowledge JSON stores live.
  userDataDir: string;
  // The renderer-safe file/path ports (Electron main → platform/electron/host FS/Path; Tauri webview → window.FS/Path).
  // The stores write PRIVATELY (0600 on the Node impl).
  fs: IFileSystem;
  path: IPath;
  // Working directory for a sandboxed tool command (Electron: os.tmpdir(); Tauri: userData).
  sandboxCwd: string;
  // Reads + normalizes the persisted AI settings.
  getAISettings: () => Promise<AISettings>;
  // Process-neutral transport (Electron ipcMain; Tauri/Wails in-webview bus).
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  // Shell-specific provider fetch path. Electron supplies main-side Undici; Tauri/Wails supply webview fetch.
  providerTransport: ProviderTransport;
  // Optional secure public-web transport. It must connect to one of the addresses validated by the DNS guard.
  // Shells that cannot pin a destination omit it, and the web-search tool is not offered.
  publicWebFetch?: ResolvedFetch;
  // Trusted-webview fallback used by Tauri/Wails. The web-search runtime restricts it to the fixed search origin
  // and same-origin redirects after native DNS validation.
  publicWebFetchImpl?: typeof fetch;
  // Typed container operations the assistant's first-class tools call. Absent ⇒ only generic tools.
  engineOps?: EngineOps;
  // The confined workspace the assistant's file tools act on. Absent ⇒ no workspace tools are offered.
  workspaceAccess?: IWorkspaceAccess;
  // Engine factory, injected by the shell composition root (→ @/ai-system/runtime). REQUIRED: core/ and host/
  // carry no engine of their own since the AI-SDK/robot3 one was retired, so a shell must supply it. The
  // injection is what keeps @open-multi-agent/core out of this layer's dependency graph — do not import runtime/
  // from here to shorten the wiring.
  createAgentSession: CreateAgentSession;
  // Goal mode's multi-agent driver. Optional because a shell may legitimately not offer goal mode; when absent the
  // host rejects a run start with a clear error rather than falling back to anything.
  createGoalRun?: CreateGoalRun;
  // CONTAINER_DESKTOP_MOCK — swap real streamers/stores for scripted mocks.
  mock?: boolean;
  logger?: { error: (...args: unknown[]) => void };
}

// Build, register, and return the AI broker. Async because the store paths are resolved through the async
// IPath port; the caller keeps the handle to reap streams on window close.
export async function createAISystem<TEvent = unknown>(
  caps: IHostCapabilities,
  deps: AISystemDeps<TEvent>,
): Promise<AIBroker<TEvent>> {
  // Mock composition is DEV/TEST-ONLY. The import is gated on a build-time constant so a production build
  // (import.meta.env.ENVIRONMENT === "production") statically drops this branch — the aiMocks module graph
  // (scripted model, mock prompts) never enters the production bundle.
  const mockModule =
    deps.mock && import.meta.env.ENVIRONMENT !== "production" ? await import("@/ai-system/testing/aiMocks") : null;
  const mocks = mockModule ? mockModule.createMockAIDeps() : null;

  const permissionsPath = await deps.path.join(deps.userDataDir, "ai-permissions.json");
  const knowledgePath = await deps.path.join(deps.userDataDir, "ai-knowledge.json");
  const conversationsPath = await deps.path.join(deps.userDataDir, "ai-conversations.json");
  const workersPath = await deps.path.join(deps.userDataDir, "ai-workers.json");
  const conversationRepository = createConversationRepository({
    store: createConversationFileStore(conversationsPath, deps.fs, deps.path),
    logger: deps.logger,
  });
  await conversationRepository.ready();

  // The user-managed allow/reject record. Mock mode: an in-memory store seeded with sample Allow + Reject
  // commands (no disk writes) so the Settings → AI permissions UI is exercisable; otherwise the real FS store.
  const permissionsStore = mockModule
    ? mockModule.createMockPermissionsStore(permissionsPath)
    : createPermissionsStore(permissionsPath, deps.fs, deps.path);

  // The workers library — reusable agent definitions goal runs draw their roster from. Read once at startup;
  // writes go through the broker so a definition (which carries a tool policy) is never renderer-writable.
  // Mock mode swaps the file store for an in-memory one seeded with sample workers, as permissions does above.
  const workerHost = createWorkerHost({
    store: mockModule
      ? mockModule.createMockWorkerStore(workersPath)
      : createWorkerFileStore(workersPath, deps.fs, deps.path),
    logger: deps.logger,
  });
  await workerHost.ready();

  const knowledgeBank = createKnowledgeBank({
    storage: createKnowledgeFileStorage(knowledgePath, deps.fs, deps.path),
  });
  void knowledgeBank.init().catch((error) => deps.logger?.error("AI knowledge bank init failed", error));

  // Keychain-backed provider keys. Mock mode reports every provider configured so cloud catalogs are browsable
  // and connection-testable without a real key. Dev-key fallback (Electron) is folded into caps.keychain by the
  // shell root before it reaches here.
  const keyStore = mocks ? mocks.keyStore : caps.keychain;

  // The typed engine surface the assistant's first-class tools execute through after session policy approval.
  const engineOps = mocks ? mocks.engineOps : deps.engineOps;

  const broker = createAIBroker({
    keyStore,
    getAISettings: deps.getAISettings,
    onInvoke: deps.onInvoke,
    send: deps.send,
    senderId: deps.senderId,
    isAllowedSender: deps.isAllowedSender,
    providerTransport: deps.providerTransport,
    listModels: mocks
      ? (provider, opts) => mocks.listModels(provider, opts)
      : (provider, opts) => listModels(provider, opts),
    createAgentSession: deps.createAgentSession,
    createGoalRun: deps.createGoalRun,
    // The sandbox POLICY (floor/redaction/timeout/cap + the scrubbed-env allowlist) is reused as-is; only the
    // executor + base env are the shell's ExecuteIsolated capability, and the cwd is the shell's sandbox root.
    runSandboxed: mocks
      ? (cmd, opts) => mocks.runSandboxed(cmd, opts)
      : (cmd, opts) =>
          executeSandboxed(cmd, {
            exec: caps.executeIsolated,
            cwd: deps.sandboxCwd,
            baseEnv: caps.env,
            enforceFloor: opts?.enforceFloor,
          }),
    engineOps,
    workspaceAccess: deps.workspaceAccess,
    permissionsStore,
    workerHost,
    seedRuns: mockModule ? mockModule.createMockGoalRuns() : undefined,
    knowledgeBank: mocks ? mocks.knowledgeBank : knowledgeBank,
    webSearcher: mocks
      ? (query) => mocks.webSearcher(query)
      : deps.publicWebFetch || deps.publicWebFetchImpl
        ? (query) =>
            webSearch(query, {
              resolve: caps.dns,
              fetchResolved: deps.publicWebFetch,
              fetchImpl: deps.publicWebFetchImpl,
            }).then((r) => ({ text: r.text }))
        : undefined,
    conversationRepository,
    buildAgentPrompt,
    logger: deps.logger,
  });
  broker.register();
  return broker;
}
