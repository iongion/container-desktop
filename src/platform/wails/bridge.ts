// Wails host bridge — the Wails realm's equivalent of the Electron preload / Tauri bridge. It populates the SAME
// window.* globals the renderer already reads (Platform / Path / FS / Command / MessageBus + the receive buses +
// AI), but backed by @wailsio/runtime's Call.ByName over the Go services (PlatformService / FsService / …)
// instead of Electron IPC or Tauri's Rust invoke. Because the surface is identical, everything above it — the
// container-client, the engine layer, the stores, the whole renderer, and registerHostRuntimeFromGlobals()
// (which just reads window.*) — runs unchanged.
//
// This is the ONLY module in src/platform/wails/ that imports @wailsio/runtime: it is the single native seam.
// Every sibling module (command.ts, messageBus.ts, host.ts, the exec/ + capabilities/ modules, …) is a faithful
// clone of its src/platform/tauri/ namesake and receives the transport (invoke / Channel / appWindow / listen /
// dialogs) by dependency injection from here — so the mirror stays byte-close to Tauri, only the seam differs.
//
// State (Phase 1 skeleton): Platform + FileSystem are wired to Go; Path is pure-JS; the RESOURCE_SYNC engine
// layer + the AI subsystem are hosted IN this realm (resourceSyncHost.ts / aiSystemHost.ts), collapsing the
// Electron main↔renderer IPC to direct calls exactly as Tauri does. The engine DATA plane (proxy/process/bridge
// Go commands) and native tray/keychain land in Phase 2+; under CONTAINER_DESKTOP_MOCK the renderer drives the
// full mocked UI through the same gate as Electron/Tauri without any of those Go commands.

import { Application, Call, Dialogs, Events, Window } from "@wailsio/runtime";
import { normalizeAISettings } from "@/ai-system/core";
import { userConfiguration } from "@/container-client/config";
import { normalizeProxyConfig, validateProxy } from "@/container-client/proxy";
import type { IPlatform, IResourceBus } from "@/platform/contract";
import { createEngineOpsAdapter } from "@/platform/engineOpsAdapter";
import { installPlatformGlobals } from "@/platform/globals";
import { createLogger } from "@/platform/logger";
import { shouldOpenExternally } from "@/platform/urlPolicy";
import { createAISystemHost } from "./aiSystemHost";
import { ActivityBus, type CommandProxyStreamEvent, createCommand, type ProcessEventMessage } from "./command";
import { createFileSystem, createPath, createPlatform } from "./host";
import { setWailsLogSink } from "./log/wailsLog";
import { createMessageBus } from "./messageBus";
import { applyProxyAtRuntime, testProxyConnectivity } from "./proxyBootstrap";
import { createRecoveryService as createWailsRecoveryService, writeFallbackErrorPage } from "./recovery";
import { createWailsResourceBus } from "./resourceBus";
import { createResourceSyncHost } from "./resourceSyncHost";
import { createRuntime } from "./runtime";
import { createWailsTrayBus } from "./trayBus";
import { createTrayController } from "./trayController";
import { createWailsWindowManager, type WailsAppWindow } from "./windowManager";

// Map the Tauri-style snake_case command names (used verbatim by the mirrored host/command/exec modules) to the
// Wails "main.<Service>.<Method>" binding names. Call.ByName needs NO generated bindings (only Call.ByID does),
// so this hand-authored table is the whole contract. Names not yet backed by a Go service (proxy/process/bridge/
// keychain/dns/tray/shell) land in Phase 2+ — they are only invoked on their code path, never during boot/mock.
const COMMAND_TO_METHOD: Record<string, string> = {
  // PlatformService (built) — the Go analog of src-tauri/src/host.rs.
  get_os_type: "main.PlatformService.GetOsType",
  get_os_arch: "main.PlatformService.GetOsArch",
  get_env_var: "main.PlatformService.GetEnvVar",
  get_home_dir: "main.PlatformService.GetHomeDir",
  get_darwin_major: "main.PlatformService.GetDarwinMajor",
  is_flatpak: "main.PlatformService.IsFlatpak",
  get_user_data_path: "main.PlatformService.GetUserDataPath",
  get_ssh_config: "main.PlatformService.GetSSHConfig",
  // FsService (built).
  fs_read_text_file: "main.FsService.ReadTextFile",
  fs_write_text_file: "main.FsService.WriteTextFile",
  fs_write_private_text_file: "main.FsService.WritePrivateTextFile",
  fs_is_file_present: "main.FsService.IsFilePresent",
  fs_mkdir: "main.FsService.Mkdir",
  fs_rename: "main.FsService.Rename",
  // ExecService / ProxyService / BridgeService / ProcessService (Phase 2 — engine data plane).
  command_execute: "main.ExecService.Execute",
  dns_lookup: "main.ExecService.DNSLookup",
  proxy_request: "main.ProxyService.Request",
  proxy_request_stream: "main.ProxyService.RequestStream",
  proxy_stream_destroy: "main.ProxyService.StreamDestroy",
  proxy_test_connectivity: "main.ProxyService.TestConnectivity",
  proxy_bridge_stop: "main.BridgeService.Stop",
  process_spawn: "main.ProcessService.Spawn",
  process_kill: "main.ProcessService.Kill",
  // KeychainService (Phase 3) / ShellService + TrayService (Phase 4).
  keychain_status: "main.KeychainService.Status",
  keychain_has: "main.KeychainService.Has",
  keychain_get: "main.KeychainService.Get",
  keychain_set: "main.KeychainService.Set",
  keychain_clear: "main.KeychainService.Clear",
  open_external: "main.ShellService.OpenExternal",
  open_storage_folder: "main.ShellService.OpenStorageFolder",
  toggle_devtools: "main.ShellService.ToggleDevtools",
  launch_terminal: "main.ShellService.LaunchTerminal",
  logging_apply: "main.ShellService.LoggingApply",
  logging_open: "main.ShellService.LoggingOpen",
  logging_reveal: "main.ShellService.LoggingReveal",
  logging_write: "main.ShellService.LogWrite",
  application_relaunch: "main.ShellService.Relaunch",
  tray_update: "main.TrayService.Update",
};

/**
 * The injected `invoke` shim: the Tauri `invoke(cmd, args)` seam re-expressed over Wails Call.ByName. Every
 * mirrored caller passes a single request-struct object (or nothing) — forwarded as the one Call.ByName arg,
 * matching the Go services' single-params-struct methods (the analog of Tauri's single-object payloads).
 */
function createWailsInvoke() {
  return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const method = COMMAND_TO_METHOD[command];
    if (!method) {
      throw new Error(`Wails bridge: no binding mapped for command "${command}"`);
    }
    return (args === undefined ? Call.ByName(method) : Call.ByName(method, args)) as Promise<T>;
  };
}

// Tauri exposes a per-invoke Channel<T> (messages arrive on `.onmessage`); Wails has only app-level Events. This
// shim mimics the Channel API the mirrored command/exec modules consume: it generates an id, listens on the
// matching "stream://<id>" event, and serializes (toJSON) to that id so the Go streaming command knows which
// event to emit to. Dormant until a Go data-plane command emits — only exercised by real engines (Phase 2);
// under CONTAINER_DESKTOP_MOCK createGoCommand is skipped, so no WailsChannel is ever constructed.
// Decode a base64 string to bytes in the webview (atob is present under both WebKitGTK and WebView2). Used only
// for binary container-log frames, which cross the JSON-only Events transport base64-encoded — see WailsChannel.
function base64ToBytes(base64Text: string): Uint8Array {
  const binary = atob(base64Text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

let channelSeq = 0;
class WailsChannel<T> {
  onmessage: ((message: T) => void) | null = null;
  readonly id: number = channelSeq++;
  private readonly off: () => void;
  constructor() {
    this.off = Events.On(`stream://${this.id}`, (event: { data: any }) => {
      const data = event.data;
      // A binary log frame arrives base64-encoded with binary:true (Wails Events can't carry raw bytes). Decode
      // to a Uint8Array so the consumer's applyStreamEvent hits its ArrayBufferView branch — identical to the raw
      // bytes Tauri delivered over its native Channel. Text/JSON events (/events, process I/O) pass through as-is.
      if (data && typeof data === "object" && data.binary === true && typeof data.payload === "string") {
        this.onmessage?.(base64ToBytes(data.payload) as unknown as T);
        return;
      }
      this.onmessage?.(data as T);
    });
  }
  // Serialized as the bare id when passed as an invoke arg → the Go command emits stream events to "stream://id".
  toJSON(): number {
    return this.id;
  }
  close(): void {
    this.off?.();
  }
}

/** Install the Wails-backed host globals + mark the preload bridge ready, mirroring the Electron preload. */
export async function installWailsHostBridge(): Promise<void> {
  const target = window as any;
  const invoke = createWailsInvoke();

  // Wire the persistent log file sink: forward the façade's already level-gated records to the Go
  // ShellService.LogWrite, which appends them to userData/logs/container-desktop.log — the SAME file
  // logging_open / logging_reveal reveal (the Wails analog of tauri-plugin-log's webview-target file). This is the
  // single Wails seam, so the DI'd sink keeps @wailsio/runtime out of wailsLog.ts. Fire-and-forget; a file-write
  // failure never breaks a log call.
  setWailsLogSink((level, message) => {
    void invoke("logging_write", { level, message }).catch(() => undefined);
  });

  // Adapt the current Wails window (@wailsio/runtime default export) to the WailsAppWindow the mirrored
  // windowManager/messageBus consume (min/max/close/focus). Window DRAG is CSS-driven (`--wails-draggable` in the
  // shared renderer CSS, like Electron's `-webkit-app-region`) — not a JS call — so there is no startDragging here.
  const appWindow: WailsAppWindow = {
    minimize: () => Window.Minimise(),
    toggleMaximize: () => Window.ToggleMaximise(),
    unmaximize: () => Window.UnMaximise(),
    close: () => Window.Close(),
    show: () => Window.Show(),
    unminimize: () => Window.UnMinimise(),
    setFocus: () => Window.Focus(),
  };
  // Tauri `listen(event, cb)` → Wails Events.On (which returns its unregister fn synchronously). Re-shape the
  // event payload to Tauri's `{ payload }` so trayController's clone stays byte-identical.
  const listen = (event: string, handler: (e: { payload: any }) => void): Promise<() => void> =>
    Promise.resolve(Events.On(event, (e: { data: any }) => handler({ payload: e.data })));
  // Tauri plugin-dialog `open()` → Wails Dialogs.OpenFile. Normalize the cancelled result to null (Tauri's shape).
  const openFileDialog = async (options: {
    directory: boolean;
    multiple: boolean;
    filters?: any;
    defaultPath?: string;
  }): Promise<string | string[] | null> => {
    const selected = await Dialogs.OpenFile({
      CanChooseDirectories: options.directory,
      CanChooseFiles: !options.directory,
      AllowsMultipleSelection: options.multiple,
      Directory: options.defaultPath,
    });
    if (Array.isArray(selected)) {
      return selected.length ? selected : null;
    }
    return selected || null;
  };
  // Tauri plugin-dialog `message()` → Wails Dialogs. Returns the clicked button's Label (recovery maps it to a
  // RecoveryChoice); a plain fatal-error dialog resolves to its OK label (ignored).
  const showMessage = async (
    message: string,
    options?: string | { title?: string; kind?: "info" | "warning" | "error"; buttons?: Record<string, string> },
  ): Promise<string> => {
    const opts = typeof options === "string" ? undefined : options;
    const buttons: Array<{ Label: string; IsDefault?: boolean; IsCancel?: boolean }> = [];
    if (opts?.buttons?.yes) {
      buttons.push({ Label: opts.buttons.yes, IsDefault: true });
    }
    if (opts?.buttons?.no) {
      buttons.push({ Label: opts.buttons.no });
    }
    if (opts?.buttons?.cancel) {
      buttons.push({ Label: opts.buttons.cancel, IsCancel: true });
    }
    const dialogOptions = {
      Title: opts?.title ?? "Container Desktop",
      Message: message,
      Buttons: opts?.buttons ? buttons : undefined,
    };
    if (opts?.buttons) {
      return Dialogs.Question(dialogOptions);
    }
    if (opts?.kind === "warning") {
      return Dialogs.Warning(dialogOptions);
    }
    return Dialogs.Error(dialogOptions);
  };

  const recovery = createWailsRecoveryService({
    showMessage,
    // True process restart via the Go ShellService.Relaunch — the Wails analog of Tauri's plugin-process relaunch
    // / Electron's app.relaunch (start a fresh instance, then quit this one). The recovery flow calls relaunch()
    // then exit(0); the redundant exit is harmless (the app is already quitting).
    relaunch: () => invoke("application_relaunch"),
    exit: () => Application.Quit(),
    openDevTools: () => Window.OpenDevTools(),
    showFallbackPage: (title, detail) => writeFallbackErrorPage(document, title, detail),
    logger: createLogger("wails.recovery"),
  });
  target.__recoveryService = recovery; // teardown/live-debug handle (no CDP under WebKitGTK)
  recovery.installWebviewGuards(window);

  try {
    const runtime = createRuntime({ appWindow });
    runtime.tuneWebviewRendering();
    const osType = await invoke<string>("get_os_type");
    // Expose CONTAINER_DESKTOP_MOCK BEFORE createCommand() reads it via isMockMode() (mode.ts reads the
    // globalThis-exposed flag in the webview realm, mirroring the Electron preload's contextBridge value).
    target.CONTAINER_DESKTOP_MOCK =
      (await invoke<string | null>("get_env_var", { name: "CONTAINER_DESKTOP_MOCK" })) ?? "";
    // Mirror Electron's CURRENT_DARWIN_MAJOR (uname-derived natively) so macOS Apple-Container network gating
    // works under Wails too; null/undefined off Darwin.
    const darwinMajor = (await invoke<number | null>("get_darwin_major")) ?? undefined;
    const platform = createPlatform(invoke, osType);
    const path = createPath(osType);
    const fs = createFileSystem(invoke);
    // Persisted config is shared code that reads Platform/Path/FS as globals. Wails has no preload phase, so expose
    // this storage slice before the first userConfiguration read; the full host surface is installed below.
    target.Platform = platform;
    target.Path = path;
    target.FS = fs;
    target.CURRENT_OS_TYPE = osType;
    const storedProxy = normalizeProxyConfig(await userConfiguration.getKey("proxy"));
    const startupProxy = validateProxy(storedProxy).ok ? storedProxy : normalizeProxyConfig();
    applyProxyAtRuntime(startupProxy);
    const windowManager = createWailsWindowManager({
      appWindow,
      invoke,
      shouldOpenExternally,
      appOrigin: runtime.appOrigin,
    });
    const command = createCommand({
      invoke,
      newProcessChannel: () => new WailsChannel<ProcessEventMessage>(),
      newProxyChannel: () => new WailsChannel<CommandProxyStreamEvent>(),
      osType,
    });
    // Host the engine service + resource-sync broker IN this realm — the Electron main↔renderer IPC collapse.
    const resourceSyncHost = createResourceSyncHost();
    target.__resourceSyncHost = resourceSyncHost; // handle for teardown/live-debug (no CDP under WebKitGTK)
    const messageBus = createMessageBus({
      resourceSyncHost,
      invoke,
      appWindow,
      openFileDialog,
      exit: () => Application.Quit(),
      relaunch: () => invoke("application_relaunch"),
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
      logger: createLogger("wails.app-control"),
    });
    const resourceBus: IResourceBus = createWailsResourceBus(resourceSyncHost);
    // window.Command must be set before the hub's engine service dials through it (mock fixtures or Go exec).
    installPlatformGlobals(target, {
      command,
      platform,
      path,
      fs,
      osType: osType as IPlatform["OPERATING_SYSTEM"],
      darwinMajor,
      messageBus,
      extras: { ActivityBus, TrayBus: createWailsTrayBus(), ResourceBus: resourceBus },
    });
    // Host the AI subsystem IN this realm too: the shared AIBroker + runtimes run here, reached through window.AI
    // / window.AIBus exactly as under Electron. engineOps binds to the SAME in-realm engine service.
    const aiHost = await createAISystemHost({
      invoke,
      fs: target.FS,
      path: target.Path,
      userDataDir: await invoke<string>("get_user_data_path"),
      getAISettings: async () => normalizeAISettings(await userConfiguration.getKey("ai")),
      engineOps: createEngineOpsAdapter(resourceSyncHost.service as any),
      mock: !!target.CONTAINER_DESKTOP_MOCK,
      logger: createLogger("wails.ai"),
    });
    target.__aiSystemHost = aiHost; // teardown/live-debug handle (no CDP under WebKitGTK)
    target.AI = aiHost.ai;
    target.AIBus = aiHost.aiBus;
    // Native system tray, projected from the SAME in-realm engine service (rebuilds on change, routes clicks back
    // to performAction). tray_update is a Phase-4 Go command; the controller no-ops safely until then.
    target.__trayController = createTrayController({
      service: resourceSyncHost.service as any,
      invoke,
      listen,
      showApp: () => windowManager.showMainWindow(),
      quit: () => {
        void Application.Quit();
      },
    });
    // The renderer blocks on window.Preloaded (Native.ts:waitForPreload) — set it LAST, once the surface is up.
    target.Preloaded = true;
    // installChrome is a no-op under Wails (drag is CSS-driven like Electron); the external-link handler routes
    // external links to the OS browser, matching Electron's window-open policy.
    windowManager.installChrome();
    windowManager.installExternalLinkHandler(target);
  } catch (error) {
    try {
      await Window.Show();
    } catch {
      // best-effort; the recovery dialog is a native window regardless
    }
    await recovery.showRecoveryDialog("Container Desktop failed to start", error, { fallbackPage: true });
    throw error;
  }
}
