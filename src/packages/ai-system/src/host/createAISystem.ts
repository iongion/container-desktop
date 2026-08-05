import { listModels } from "@/ai-system/adapters/localModels";
import { createPermissionsStore } from "@/ai-system/adapters/permissionsStoreCore";
import { createProjectContextFileStore } from "@/ai-system/adapters/projectContextFileStore";
import { executeSandboxed } from "@/ai-system/adapters/sandbox";
import { sessionWorkspaceRoot } from "@/ai-system/adapters/sessionWorkspace";
import { sha256Text } from "@/ai-system/adapters/sha256";
import { createSkillTrustFileStore } from "@/ai-system/adapters/skillTrustFileStore";
import { type ResolvedFetch, webSearch } from "@/ai-system/adapters/webSearch";
import { createGitWorkspaceChanges } from "@/ai-system/adapters/workspaceChanges";
import type { AIInvokeChannel, AIInvokeResponse, AIPushChannel, AIPushPayload } from "@/ai-system/core/channels";
import type { ExecutionSelectorFactory } from "@/ai-system/core/ports";
import type { AISettings, EngineOps } from "@/ai-system/core/types";
import { type AIBroker, createAIBroker } from "@/ai-system/host/broker";
import { createProjectContextHost } from "@/ai-system/host/projectContextHost";
import { createSkillHost } from "@/ai-system/host/skillHost";
import { buildAgentPrompt, buildSkillInvocationPrompt } from "@/template/prompts";
import "@/template/templateRegistry.vite";
import type { ProviderTransport } from "@/ai-system/core/types";
import type { IHostCapabilities } from "@/host-contract/capabilities";
import type { IFileDiscoverySystem, IPath } from "@/host-contract/fs";
import type { IWorkspaceAccess } from "@/host-contract/workspaceAccess";
import projectRulesTemplate from "@/resources/prompts/project-rules.md?raw";
import { randomUUID } from "@/utils/randomUUID";

// `TEvent` is the shell's IPC invoke event, a type parameter so this shared composition root never names an
// Tauri/Wails type; each shell supplies its own concrete event through the transport callbacks.
export interface AISystemDeps<TEvent = unknown> {
  // OS app-data dir — where the AI permission, project-context and skill-trust JSON stores live.
  userDataDir: string;
  // The renderer-safe file/path ports (the shell's FS/Path, exposed as window.FS/window.Path).
  // The stores write PRIVATELY (0600 on the Node impl).
  fs: IFileDiscoverySystem;
  path: IPath;
  // Working directory for a sandboxed tool command (userData).
  sandboxCwd: string;
  // Reads + normalizes the persisted AI settings.
  getAISettings: () => Promise<AISettings>;
  // Process-neutral transport (the Tauri/Wails in-webview bus).
  onInvoke: <TChannel extends AIInvokeChannel>(
    channel: TChannel,
    handler: (event: TEvent, payload: unknown) => AIInvokeResponse<TChannel> | Promise<AIInvokeResponse<TChannel>>,
  ) => void;
  send: <TChannel extends AIPushChannel>(event: TEvent, channel: TChannel, payload: AIPushPayload<TChannel>) => void;
  senderId: (event: TEvent) => number | string;
  isAllowedSender: (event: TEvent) => boolean;
  // Shell-specific provider fetch path. Tauri/Wails supply the webview fetch.
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
  // Builds an execution backend from a target (host/remote/container/sandbox). Absent ⇒ everything falls back to
  // the injected engineOps/workspaceAccess, which is the host.
  createExecutionSelector?: ExecutionSelectorFactory;
  // CONTAINER_DESKTOP_MOCK — swap real streamers/stores for scripted mocks.
  mock?: boolean;
  logger?: { error: (...args: unknown[]) => void };
}

// Build, register, and return the AI broker. Async because the store paths are resolved through the async
// IPath port; the caller keeps the handle to reap streams on window close.
export async function createAISystem<TEvent = unknown>(
  caps: IHostCapabilities,
  deps: AISystemDeps<TEvent>,
): Promise<AIBroker> {
  // Mock composition is DEV/TEST-ONLY. The import is gated on a build-time constant so a production build
  // (import.meta.env.ENVIRONMENT === "production") statically drops this branch — the aiMocks module graph
  // (scripted model, mock prompts) never enters the production bundle.
  const mockModule =
    deps.mock && import.meta.env.ENVIRONMENT !== "production" ? await import("@/ai-system/testing/aiMocks") : null;
  const mocks = mockModule ? mockModule.createMockAIDeps() : null;

  const permissionsPath = await deps.path.join(deps.userDataDir, "ai-permissions.json");
  const skillTrustPath = await deps.path.join(deps.userDataDir, "ai-skill-trust.json");
  const projectContextPath = await deps.path.join(deps.userDataDir, "ai-project-context.json");
  const userSkillsRoot = await deps.path.join(deps.userDataDir, "ai-skills");

  // The user-managed allow/reject record. Mock mode: an in-memory store seeded with sample Allow + Reject
  // commands (no disk writes) so the Settings → AI permissions UI is exercisable; otherwise the real FS store.
  const permissionsStore = mockModule
    ? mockModule.createMockPermissionsStore(permissionsPath)
    : createPermissionsStore(permissionsPath, deps.fs, deps.path);

  const skillHost = createSkillHost({
    userRoot: userSkillsRoot,
    // Project skills come from the folder the RUNNING session mounted, like every other workspace read — a skill
    // discovered in a folder the agent cannot see is one it can never act on.
    getWorkspaceRoot: sessionWorkspaceRoot(async () => (await deps.getAISettings()).workspaceRoot),
    trustStore: createSkillTrustFileStore(skillTrustPath, deps.fs, deps.path),
    fs: deps.fs,
    path: deps.path,
    logger: deps.logger,
  });
  await skillHost.ready();

  const projectContextHost = deps.workspaceAccess
    ? createProjectContextHost({
        store: createProjectContextFileStore(projectContextPath, deps.fs, deps.path),
        workspace: deps.workspaceAccess,
        fingerprint: sha256Text,
        nextId: randomUUID,
        now: Date.now,
        rulesTemplate: projectRulesTemplate,
      })
    : undefined;
  await projectContextHost?.ready();

  // Keychain-backed provider keys. Mock mode reports every provider configured so cloud catalogs are browsable
  // and connection-testable without a real key. The dev-key fallback is folded into caps.keychain by the
  // shell root before it reaches here.
  const keyStore = mocks ? mocks.keyStore : caps.keychain;

  // The typed engine surface the assistant's first-class tools execute through after session policy approval.
  const engineOps = mocks ? mocks.engineOps : deps.engineOps;
  const workspaceChanges = deps.workspaceAccess
    ? createGitWorkspaceChanges({
        // The app reads the workspace folder itself, so the change set comes from the app — not from a target.
        origin: { kind: "app" },
        workspace: deps.workspaceAccess,
        exec: caps.executeIsolated,
        baseEnv: caps.env,
      })
    : undefined;

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
    workspaceChanges,
    // Honor the shell's selector factory in every mode. In mock the shell builds it over the in-memory
    // VirtualEngineHost (not a real engine), so a target resolves and runs hermetically. A shell that cannot reach
    // a connection's containers passes undefined, and a workspace call then fails rather than acting here.
    createExecutionSelector: deps.createExecutionSelector,
    permissionsStore,
    skillHost,
    buildSkillInvocationPrompt,
    projectContextHost,
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
    buildAgentPrompt,
    logger: deps.logger,
  });
  broker.register();
  return broker;
}
