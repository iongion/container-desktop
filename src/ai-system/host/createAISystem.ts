import type { AISettings, EngineOps } from "@/ai-system/core";
import { AIBroker } from "@/ai-system/host/broker";
import { KnowledgeBank } from "@/ai-system/host/knowledgeBank";
import { buildAgentPrompt, buildGeneratePrompt } from "@/ai-system/prompt/prompts";
import { createAgentRunner } from "@/ai-system/runtimes/agent/agent";
import { executeContainerTool } from "@/ai-system/runtimes/agent/containerTools";
import { executeSandboxed } from "@/ai-system/runtimes/agent/sandbox";
import { createAgentTools } from "@/ai-system/runtimes/agent/tools";
import { webSearch } from "@/ai-system/runtimes/agent/webSearch";
import { createKnowledgeFileStorage } from "@/ai-system/runtimes/knowledgeFileStorage";
import { listModels } from "@/ai-system/runtimes/localModels";
import { createPermissionsStore } from "@/ai-system/runtimes/permissionsStoreCore";
import "@/ai-system/prompt/templateRegistry.vite";
import { createMockAIDeps, createMockPermissionsStore } from "@/ai-system/testing/aiMocks";
import type { IHostCapabilities } from "@/platform/capabilities";
import type { IFileSystem, IPath } from "@/platform/contract";

export interface AISystemDeps {
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
  // Process-neutral transport (Electron ipcMain; Tauri in-webview bus) — the AIBroker's 5-function shape.
  onInvoke: (channel: string, handler: (event: any, payload: any) => unknown) => void;
  onMessage: (channel: string, handler: (event: any, payload: any) => void) => void;
  send: (event: any, channel: string, payload: unknown) => void;
  senderId: (event: any) => number | string;
  isAllowedSender: (event: any) => boolean;
  // Typed container operations the assistant's first-class tools call. Absent ⇒ only generic tools.
  engineOps?: EngineOps;
  // CONTAINER_DESKTOP_MOCK — swap real streamers/runner/stores for scripted mocks.
  mock?: boolean;
  logger?: { error: (...args: any[]) => void };
}

// Build, register, and return the AI broker. Async because the store paths are resolved through the async
// IPath port; the caller keeps the handle to reap streams on window close.
export async function createAISystem(caps: IHostCapabilities, deps: AISystemDeps): Promise<AIBroker> {
  // One mock instance shared across every dep when CONTAINER_DESKTOP_MOCK is set.
  const mocks = deps.mock ? createMockAIDeps() : null;

  const permissionsPath = await deps.path.join(deps.userDataDir, "ai-permissions.json");
  const knowledgePath = await deps.path.join(deps.userDataDir, "ai-knowledge.json");

  // The user-managed allow/reject record. Mock mode: an in-memory store seeded with sample Allow + Reject
  // commands (no disk writes) so the Settings → AI permissions UI is exercisable; otherwise the real FS store.
  const permissionsStore = mocks
    ? createMockPermissionsStore(permissionsPath)
    : createPermissionsStore(permissionsPath, deps.fs, deps.path);

  const knowledgeBank = new KnowledgeBank({
    storage: createKnowledgeFileStorage(knowledgePath, deps.fs, deps.path),
  });
  void knowledgeBank.init().catch((error) => deps.logger?.error("AI knowledge bank init failed", error));

  // Keychain-backed provider keys. Mock mode reports every provider configured so cloud catalogs are browsable
  // and connection-testable without a real key. Dev-key fallback (Electron) is folded into caps.keychain by the
  // shell root before it reaches here.
  const keyStore = mocks ? mocks.keyStore : caps.keychain;

  // The typed engine surface the assistant's first-class tools call (and the broker re-runs on approval).
  const engineOps = mocks ? mocks.engineOps : deps.engineOps;

  const broker = new AIBroker({
    keyStore,
    getAISettings: deps.getAISettings,
    onInvoke: deps.onInvoke,
    onMessage: deps.onMessage,
    send: deps.send,
    senderId: deps.senderId,
    isAllowedSender: deps.isAllowedSender,
    listModels: mocks
      ? (baseURL, opts) => mocks.listModels(baseURL, opts)
      : (baseURL, opts) => listModels(baseURL, opts),
    agentRunner: mocks ? mocks.agentRunner : createAgentRunner(),
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
    buildAgentTools: createAgentTools,
    engineOps,
    runEngineTool: engineOps ? (name, args) => executeContainerTool(engineOps, name, args) : undefined,
    permissionsStore,
    knowledgeBank: mocks ? mocks.knowledgeBank : knowledgeBank,
    webSearcher: mocks
      ? (query) => mocks.webSearcher(query)
      : (query) => webSearch(query, { resolve: caps.dns }).then((r) => ({ text: r.text })),
    buildGeneratePrompt,
    buildAgentPrompt,
    logger: deps.logger,
  });
  broker.register();
  return broker;
}
