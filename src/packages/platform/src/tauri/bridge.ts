// Tauri host bridge — it populates the window.*
// globals the renderer already reads (Platform / Path / FS / Command / MessageBus + the receive buses + AI),
// backed by @tauri-apps/api `invoke` over the native Rust port. Because the
// surface is identical, everything above it — container-client, the engine layer, the stores, the whole
// renderer, and registerHostRuntimeFromGlobals() (which just reads window.*) — runs unchanged.
//
// State: Platform + FileSystem are fully wired to Rust; Path is pure-JS (no round-trip); window controls
// drive the real frameless Tauri window; and the RESOURCE_SYNC engine layer runs IN this realm — the
// EngineDataService + ResourceSyncBroker are hosted here (see resourceSyncHost.ts) and reached through
// MessageBus/ResourceBus as direct in-realm calls. The Command facade lives
// in command.ts over the exec/ modules; mock mode serves fixtures through the shared gate.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openFileDialog, save as saveFileDialog, message as showDialog } from "@tauri-apps/plugin-dialog";
import { exit as processExit, relaunch as processRelaunch } from "@tauri-apps/plugin-process";
import { normalizeAISettings } from "@/ai-system/core/settings";
import { userConfiguration } from "@/container-client/config";
import { normalizeProxyConfig, validateProxy } from "@/container-client/proxy";
import { createLogger } from "@/logger";
import { createConnectionExecAdapter } from "@/platform/capabilities/connectionExec";
import type { IPlatform, IResourceBus } from "@/platform/contract";
import { createEngineOpsAdapter } from "@/platform/engineOpsAdapter";
import { installPlatformGlobals } from "@/platform/globals";
import { shouldOpenExternally } from "@/platform/urlPolicy";
import { createAISystemHost } from "./aiSystemHost";
import { ActivityBus, type CommandProxyStreamEvent, createCommand, type ProcessEventMessage } from "./command";
import { createFileSystem, createPath, createPlatform } from "./host";
import { createMessageBus } from "./messageBus";
import { applyProxyAtRuntime, testProxyConnectivity } from "./proxyBootstrap";
import { createRecoveryService as createTauriRecoveryService, writeFallbackErrorPage } from "./recovery";
import { createTauriResourceBus } from "./resourceBus";
import { createResourceSyncHost } from "./resourceSyncHost";
import { createRuntime } from "./runtime";
import { createTauriTrayBus } from "./trayBus";
import { createTrayController } from "./trayController";
import { createTauriWindowManager } from "./windowManager";

function installTauriStorageGlobals(
  target: any,
  options: {
    platform: IPlatform;
    path: ReturnType<typeof createPath>;
    fs: ReturnType<typeof createFileSystem>;
    osType: string;
  },
): void {
  // Persisted config is shared code and reads Platform/Path/FS as globals. Tauri has no preload phase, so expose
  // this storage slice before the first userConfiguration read; the full host surface is installed below.
  target.Platform = options.platform;
  target.Path = options.path;
  target.FS = options.fs;
  target.CURRENT_OS_TYPE = options.osType;
}

// Install the Tauri-backed host globals + mark the host bridge ready.
export async function installTauriHostBridge(): Promise<void> {
  const target = window as any;
  const recovery = createTauriRecoveryService({
    showMessage: showDialog,
    relaunch: processRelaunch,
    exit: (code = 0) => processExit(code),
    openDevTools: () => invoke("toggle_devtools"),
    showFallbackPage: (title, detail) => writeFallbackErrorPage(document, title, detail),
    logger: createLogger("tauri.recovery"),
  });
  target.__recoveryService = recovery; // teardown/live-debug handle (no CDP under WebKitGTK)
  recovery.installWebviewGuards(window);

  try {
    const runtime = createRuntime({ appWindow: getCurrentWindow() });
    runtime.tuneWebviewRendering();
    // The window stays hidden until the renderer's "ready" signal (messageBus.showWindow) fires from
    // AppBootstrapReadySignal, after React has mounted the real AppHeader chrome.
    const osType = await invoke<string>("get_os_type");
    // Expose CONTAINER_DESKTOP_MOCK BEFORE createCommand() reads it via isMockMode() (mode.ts reads the
    // globalThis-exposed flag in the webview realm).
    target.CONTAINER_DESKTOP_MOCK =
      (await invoke<string | null>("get_env_var", { name: "CONTAINER_DESKTOP_MOCK" })) ?? "";
    // Expose the Runs-at-scale knob to the webview realm (no `process` here) so readMockScaleSpec seeds the
    // scaled run set under Tauri. Absent ⇒ "" ⇒ no scaled seed (the default).
    target.CONTAINER_DESKTOP_MOCK_SWARM =
      (await invoke<string | null>("get_env_var", { name: "CONTAINER_DESKTOP_MOCK_SWARM" })) ?? "";
    // The same flag that turns the single-instance guard off (lib.rs) so the harness runs beside a dev app. The
    // webview needs it because work that assumes "only this app is running" — reaping orphaned agent sessions —
    // must stand down when a second instance may hold a live one.
    target.CONTAINER_DESKTOP_E2E =
      (await invoke<string | null>("get_env_var", { name: "CONTAINER_DESKTOP_E2E" })) ?? "";
    // CURRENT_DARWIN_MAJOR (uname-derived natively) so macOS Apple-Container network gating
    // (container-client runtime profiles) works under Tauri too; null/undefined off Darwin.
    const darwinMajor = (await invoke<number | null>("get_darwin_major")) ?? undefined;
    const platform = createPlatform(invoke, osType);
    const path = createPath(osType);
    const fs = createFileSystem(invoke);
    installTauriStorageGlobals(target, { platform, path, fs, osType });
    const storedProxy = normalizeProxyConfig(await userConfiguration.getKey("proxy"));
    const startupProxy = validateProxy(storedProxy).ok ? storedProxy : normalizeProxyConfig();
    applyProxyAtRuntime(startupProxy);
    const windowManager = createTauriWindowManager({
      appWindow: runtime.appWindow,
      invoke,
      shouldOpenExternally,
      appOrigin: runtime.appOrigin,
    });
    const command = createCommand({
      invoke,
      newProcessChannel: () => new Channel<ProcessEventMessage>(),
      newProxyChannel: () => new Channel<CommandProxyStreamEvent>(),
      osType,
    });
    // Host the engine service + resource-sync broker IN this realm — no separate process to cross.
    // MessageBus.invoke/send + ResourceBus.subscribe drive it directly; the renderer's stores are unchanged.
    const resourceSyncHost = createResourceSyncHost();
    target.__resourceSyncHost = resourceSyncHost; // handle for teardown/live-debug (no CDP under WebKitGTK)
    const messageBus = createMessageBus({
      resourceSyncHost,
      invoke,
      appWindow: windowManager.appWindow,
      openFileDialog,
      saveFileDialog,
      exit: () => processExit(0),
      relaunch: processRelaunch,
      applyProxy: async (options) => {
        const validation = validateProxy(options);
        if (!validation.ok) {
          return { ok: false, errors: validation.errors };
        }
        await userConfiguration.setProxyConfig(validation.value);
        const proxy = applyProxyAtRuntime(validation.value);
        return { ok: true, proxy };
      },
      testProxy: async (options) => {
        const validation = validateProxy(options);
        if (!validation.ok) {
          return { ok: false, errors: validation.errors };
        }
        return await testProxyConnectivity(validation.value, { invoke });
      },
      logger: createLogger("tauri.app-control"),
    });
    const resourceBus: IResourceBus = createTauriResourceBus(resourceSyncHost);
    // window.Command must be set before the hub's engine service dials through it (mock fixtures or Rust exec).
    installPlatformGlobals(target, {
      command,
      platform,
      path,
      fs,
      osType: osType as IPlatform["OPERATING_SYSTEM"],
      darwinMajor,
      messageBus,
      extras: { ActivityBus, TrayBus: createTauriTrayBus(), ResourceBus: resourceBus },
    });
    // Host the AI subsystem IN this realm too: the shared AIBroker +
    // runtimes run here, reached through window.AI / window.AIBus. engineOps binds to
    // the SAME in-realm engine service so the assistant's container tools act on live connections.
    const aiHost = await createAISystemHost({
      invoke,
      fs: target.FS,
      path: target.Path,
      userDataDir: await invoke<string>("get_user_data_path"),
      getAISettings: async () => normalizeAISettings(await userConfiguration.getKey("ai")),
      engineOps: createEngineOpsAdapter(resourceSyncHost.service as any),
      // Container execution: bind the AI system to the SAME in-realm engine service so a session's container or
      // sandbox target runs where it should, not silently on this machine.
      connectionExec: createConnectionExecAdapter(resourceSyncHost.service as any),
      mock: !!target.CONTAINER_DESKTOP_MOCK,
      logger: createLogger("tauri.ai"),
    });
    target.__aiSystemHost = aiHost; // teardown/live-debug handle (no CDP under WebKitGTK)
    target.AI = aiHost.ai;
    target.AIBus = aiHost.aiBus;
    // Native system tray, projected from the SAME in-realm engine service (rebuilds on change, routes clicks
    // back to performAction). Its presence also arms hide-to-tray on window close (lib.rs). Kept on the window
    // so a live-debug/teardown can reach it (no CDP under WebKitGTK).
    target.__trayController = createTrayController({
      service: resourceSyncHost.service as any,
      invoke,
      listen,
      showApp: () => windowManager.showMainWindow(),
      quit: () => {
        void processExit(0);
      },
    });
    // The renderer blocks on window.Preloaded (Native.ts:waitForPreload) — set it LAST, once the surface is up.
    target.Preloaded = true;
    // Custom-chrome behaviors WebKitGTK doesn't give a frameless window for free: drag + resize.
    windowManager.installChrome();
    // External links → the OS browser (policy-gated).
    windowManager.installExternalLinkHandler(target);
  } catch (error) {
    // The window may still be hidden (we failed before/around the reveal above) — show it so the recovery
    // fallback page written into the document is actually visible.
    try {
      await getCurrentWindow().show();
    } catch {
      // best-effort; the recovery dialog is a native window regardless
    }
    await recovery.showRecoveryDialog("Container Desktop failed to start", error, { fallbackPage: true });
    throw error;
  }
}
