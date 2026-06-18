// web-app/stores/appStore.ts — bootstrap / lifecycle / connections / settings. Folds in `connections`
// + the connection-CRUD thunks from the old Settings sub-model (§B); `connections` (configured list) is distinct from
// `connectors` (the derived availability matrix). `reset` is redefined for the post-EP world.
//
// Preload guard: the bootstrap actions (initialize/startApplication) await waitForPreload() before the
// first Application.getInstance() — Application captures window.MessageBus at construction.

import { Intent } from "@blueprintjs/core";
import { create } from "zustand";

import { OnlineApi } from "@/container-client/Api.clients";
import { Application } from "@/container-client/Application";
import { systemNotifier } from "@/container-client/notifier";
import {
  type AppRuntimeSnapshot,
  RESOURCE_SYNC,
  type ResourceConnectProgress,
} from "@/container-client/resourceSyncProtocol";
import {
  type CommandExecutionResult,
  type Connection,
  type ConnectOptions,
  type Connector,
  type DisconnectOptions,
  type EngineConnectorSettings,
  type EngineUserSettingsOptions,
  type FindProgramOptions,
  type GenerateKubeOptions,
  type GlobalUserSettings,
  type GlobalUserSettingsOptions,
  OperatingSystem,
  type SystemNotification,
} from "@/env/Types";
import { deepMerge, isObject } from "@/utils";
import { t } from "@/web-app/App.i18n";
import { AppBootstrapPhase } from "@/web-app/App.types";
import { queryClient } from "@/web-app/domain/queryClient";
import { waitForPreload } from "@/web-app/Native";
import { Notification } from "@/web-app/Notification";
import { resourceEvents } from "@/web-app/stores/resourceEvents";
import { applyResourceSyncSnapshot, startResourceMirror } from "@/web-app/stores/resourceMirror";
import { useResourceStore } from "@/web-app/stores/resourceStore";
import { useUIStore } from "@/web-app/stores/uiStore";

export const DEFAULT_SYSTEM_CONNECTION_ID = "system-default.podman";

let checkForUpdatePerformed = false;
const BOOTSTRAP_PREVIEW_DELAY_MS = import.meta.env.CONTAINER_DESKTOP_BOOTSTRAP_PREVIEW_DELAY ? 2000 : 0;

async function delayBootstrapPreview(): Promise<void> {
  if (!BOOTSTRAP_PREVIEW_DELAY_MS) {
    return;
  }
  systemNotifier.transmit("startup.phase", { trace: "Development bootstrap preview delay" });
  await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_PREVIEW_DELAY_MS));
}

async function waitForPendingPaint(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function delayCheckUpdate(osType: OperatingSystem) {
  setTimeout(async () => {
    try {
      const check = await new OnlineApi(import.meta.env.ONLINE_API).checkLatestVersion(osType);
      if (check.hasUpdate) {
        Notification.show({
          message: t("A newer version {{latest}} has been found", check),
          intent: Intent.PRIMARY,
        });
      }
    } catch (error: any) {
      console.error("Unable to read latest version", error);
    }
  }, 1500);
}

// One-time (main window only): follow a tray-initiated connection switch. The tray menu asks main to
// switch; with a main window open, main forwards `tray:switch-connection` here so the app UI tracks the
// same connection via its normal startApplication path. Guarded so it registers exactly once.
let traySwitchListenerRegistered = false;
function registerTraySwitchListener(get: () => AppStore): void {
  if (traySwitchListenerRegistered || typeof window === "undefined" || !window.TrayBus) {
    return;
  }
  traySwitchListenerRegistered = true;
  window.TrayBus.subscribe("tray:switch-connection", (payload: { id?: string }) => {
    const id = payload?.id;
    if (!id) {
      return;
    }
    const state = get();
    if (state.currentConnector?.id === id) {
      return;
    }
    const connection = state.connections.find((item) => item.id === id);
    if (connection) {
      // Multi-connection: make it the primary (persisted create/pull + tray default) and ensure it is up —
      // no full bootstrap reset of the always-merged workspace.
      void state.makePrimary(id);
      void state.connectOne(id);
    }
  });
}

// One-time (main window only): stream main's per-connection connect/reconnect progress lines into the
// bootstrap phase box while the splash is up, labeled per engine so multiple engines interleave.
let connectProgressSubscribed = false;
function subscribeConnectProgress(): void {
  if (connectProgressSubscribed || typeof window === "undefined" || !window.ResourceBus) {
    return;
  }
  connectProgressSubscribed = true;
  window.ResourceBus.subscribe(RESOURCE_SYNC.progress, (progress: ResourceConnectProgress) => {
    if (useAppStore.getState().phase !== AppBootstrapPhase.STARTING) {
      return;
    }
    useAppStore.getState().insertBootstrapPhase({
      guid: `${progress.connectionId}:${progress.ts}`,
      type: "engine.connect",
      date: new Date(progress.ts),
      data: { trace: `${progress.name}: ${progress.trace}` },
    });
  });
}

interface AppState {
  phase: AppBootstrapPhase;
  pending: boolean;
  native: boolean;
  systemNotifications: SystemNotification[];
  // descriptor
  osType: OperatingSystem;
  version: string;
  environment: string;
  provisioned?: boolean;
  running?: boolean;
  connectors: Connector[];
  connections: Connection[]; // configured user+system list (folded from Settings §B) — distinct from connectors
  currentConnector?: Connector;
  nextConnection?: Connection;
  userSettings: GlobalUserSettings;
}

interface AppActions {
  // sync
  setPhase: (phase: AppBootstrapPhase) => void;
  setPending: (flag: boolean) => void;
  setNextConnection: (conn?: Connection) => void;
  insertBootstrapPhase: (phase: SystemNotification) => void;
  resetBootstrapPhases: () => void;
  syncGlobalUserSettings: (values: GlobalUserSettings) => void;
  syncEngineUserSettings: (values: EngineUserSettingsOptions) => void;
  domainUpdate: (opts: Partial<AppState>) => void;
  connectorUpdate: (connector: Connector) => void;
  connectorUpdateSettingsById: (payload: { id: string; settings: EngineConnectorSettings }) => void;
  setConnections: (items: Connection[]) => void;
  // Project main's merged runtime snapshot onto the app-shell phase (single source of truth for readiness).
  applyAppRuntime: (runtime: AppRuntimeSnapshot) => void;
  // async — bootstrap / settings
  initialize: () => Promise<void>;
  reset: (options?: { preserveBootstrapPhases?: boolean }) => Promise<void>;
  startApplication: (options?: ConnectOptions) => Promise<boolean>;
  stopApplication: (options?: DisconnectOptions) => Promise<boolean>;
  getGlobalUserSettings: () => Promise<GlobalUserSettings>;
  setGlobalUserSettings: (options: Partial<GlobalUserSettingsOptions>) => Promise<void>;
  setConnectorSettings: (options: EngineUserSettingsOptions) => Promise<EngineConnectorSettings | undefined>;
  findProgram: (options: FindProgramOptions) => Promise<any>;
  generateKube: (options: GenerateKubeOptions) => Promise<CommandExecutionResult | undefined>;
  // async — connection CRUD (folded from Settings/Model)
  getConnections: () => Promise<Connection[]>;
  createConnection: (connection: Connection) => Promise<Connection>;
  updateConnection: (payload: { id: string; connection: Partial<Connection> }) => Promise<Connection>;
  removeConnection: (id: string) => Promise<boolean>;
  // per-connection lifecycle (always-merged workspace; no global reset)
  connectOne: (connectionId: string) => Promise<void>;
  disconnectOne: (connectionId: string) => Promise<void>;
  makePrimary: (connectionId: string) => Promise<void>;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>()((set, get) => {
  const runPending = async <T>(fn: () => Promise<T>): Promise<T> => {
    set({ pending: true });
    try {
      return await fn();
    } finally {
      set({ pending: false });
    }
  };

  return {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native: true,
    systemNotifications: [],
    osType: (window as any).CURRENT_OS_TYPE || OperatingSystem.Unknown,
    version: import.meta.env.PROJECT_VERSION,
    environment: import.meta.env.ENVIRONMENT,
    provisioned: false,
    running: false,
    connectors: [],
    connections: [],
    currentConnector: undefined,
    nextConnection: undefined,
    userSettings: {} as GlobalUserSettings,

    // ── sync ──
    setPhase: (phase) =>
      set((state) => ({
        phase,
        provisioned: phase === AppBootstrapPhase.CONNECTING ? false : state.provisioned,
        running: phase === AppBootstrapPhase.CONNECTING ? false : state.running,
      })),
    setPending: (flag) => set({ pending: flag }),
    setNextConnection: (conn) => set({ nextConnection: conn }),
    insertBootstrapPhase: (phase) =>
      set((state) => ({
        systemNotifications: [...state.systemNotifications, phase],
      })),
    resetBootstrapPhases: () => set({ systemNotifications: [] }),
    syncGlobalUserSettings: (values) => set({ userSettings: values }),
    syncEngineUserSettings: (values) =>
      set((state) => ({
        currentConnector: state.currentConnector
          ? deepMerge<Connector>(state.currentConnector, {
              settings: deepMerge(state.currentConnector.settings, values.settings),
            })
          : state.currentConnector,
        connectors: state.connectors.map((connector) =>
          connector.id === values.id
            ? deepMerge<Connector>(connector, { settings: deepMerge(connector.settings, values.settings) })
            : connector,
        ),
      })),
    domainUpdate: (opts) =>
      set((state) => {
        const next: Partial<AppState> = {};
        Object.keys(opts).forEach((key) => {
          const value = (opts as any)[key];
          (next as any)[key] = isObject(value) ? deepMerge({}, (state as any)[key] || {}, value) : value;
        });
        return next;
      }),
    connectorUpdate: (connector) =>
      set((state) => ({
        connectors: state.connectors.map((it) => (it.id === connector.id ? deepMerge(it, connector) : it)),
      })),
    connectorUpdateSettingsById: ({ id, settings }) =>
      set((state) => ({
        connectors: state.connectors.map((connector) =>
          connector.id === id ? deepMerge<Connector>(connector, { settings }) : connector,
        ),
      })),
    setConnections: (items) => set({ connections: items }),
    applyAppRuntime: (runtime) =>
      set((state) => {
        const running = !!runtime.running;
        const booting = state.phase === AppBootstrapPhase.INITIAL || state.phase === AppBootstrapPhase.STARTING;
        // The shell blocks on the splash ONLY while booting, and only until the first engine reports ready
        // (or startApplication ends the splash after connectAll settles). Once in the workspace we never
        // re-enter the splash for per-connection churn — failures / reconnects render inline.
        const phase = booting
          ? runtime.phase === "ready"
            ? AppBootstrapPhase.READY
            : AppBootstrapPhase.STARTING
          : AppBootstrapPhase.READY;
        const next: Partial<AppState> = { phase, running, provisioned: true };
        // Hydrate the PRIMARY connector (create/pull target, header, theme) from the merged snapshot — only
        // when the primary actually changes, or when the ready snapshot adds capabilities after a starting
        // snapshot. Those capabilities drive Podman-only sidebar/screens.
        const primaryId = runtime.currentConnector?.id;
        if (primaryId && (primaryId !== state.currentConnector?.id || !!runtime.currentConnector?.capabilities)) {
          const conn = state.connections.find((c) => c.id === primaryId);
          const connector = state.connectors.find((c) => c.id === primaryId || c.connectionId === primaryId);
          if (conn || connector) {
            const merged = deepMerge<Connector>(
              {} as Connector,
              (connector as Connector) ?? ({} as Connector),
              (conn as unknown as Connector) ?? ({} as Connector),
              (runtime.currentConnector as unknown as Connector) ?? ({} as Connector),
            );
            // A primary synthesized from a configured Connection has no availability matrix. Ensure a
            // well-formed one (api tracks the primary's runtime) so the connection-manager callout reads the
            // real state instead of crashing on a missing field.
            if (!merged.availability) {
              const primaryRuntime = runtime.active?.find((r) => r.id === primaryId);
              const up = !!primaryRuntime?.running;
              merged.availability = {
                enabled: true,
                host: up,
                api: up,
                program: up,
                report: { host: "", api: up ? "" : (primaryRuntime?.error ?? ""), program: "" },
              };
            }
            if (!merged.connectionId) {
              merged.connectionId = primaryId;
            }
            next.currentConnector = merged;
          }
        }
        return next;
      }),

    // ── async: bootstrap / settings ──
    initialize: async () => {
      get().resetBootstrapPhases();
      get().setPending(true);
      get().setPhase(AppBootstrapPhase.STARTING);
      systemNotifier.transmit("startup.phase", { trace: "Loading user settings" });
      await waitForPreload();
      registerTraySwitchListener(get);
      subscribeConnectProgress();
      const instance = Application.getInstance();
      const settings = await instance.getGlobalUserSettings();
      instance.setLogLevel(settings?.logging.level || "debug");
      get().syncGlobalUserSettings(settings);
      systemNotifier.transmit("startup.phase", { trace: "User settings loaded" });
    },
    reset: async (options = {}) => {
      // Post-migration there are no screen sub-models to wipe (§B): drop the server cache and UI state.
      await resourceEvents.stopAll();
      if (!options.preserveBootstrapPhases) {
        get().resetBootstrapPhases();
      }
      queryClient.clear();
      useResourceStore.getState().resetAll();
      useUIStore.getState().reset();
    },
    startApplication: async () => {
      await waitForPreload();
      if (get().phase !== AppBootstrapPhase.STARTING) {
        get().resetBootstrapPhases();
      }
      return runPending(async () => {
        const instance = Application.getInstance();
        let userSettings = get().userSettings;
        get().setPhase(AppBootstrapPhase.STARTING);
        try {
          systemNotifier.transmit("startup.phase", { trace: "Starting setup" });
          await delayBootstrapPreview();
          await instance.setup();
          systemNotifier.transmit("startup.phase", { trace: "Setup ready" });
          userSettings = await instance.getGlobalUserSettings();
          await get().reset({ preserveBootstrapPhases: true });
          if (!userSettings?.connector?.default) {
            userSettings.connector = { default: DEFAULT_SYSTEM_CONNECTION_ID };
          }
          get().syncGlobalUserSettings(userSettings);
          // Configured connections (system + user) — drives the connection manager + the first-run gate.
          systemNotifier.transmit("startup.phase", { trace: "Listing connections" });
          const userConnections = await instance.getConnections();
          const systemConnections = await instance.getSystemConnections();
          const connections = [...systemConnections, ...userConnections];
          get().setConnections(connections);
          get().domainUpdate({
            osType: instance.getOsType(),
            version: import.meta.env.PROJECT_VERSION,
            environment: import.meta.env.ENVIRONMENT,
            connectors: instance.getConnectors(),
            provisioned: true,
            userSettings,
          });
          // Mirror main's pushed snapshots BEFORE connecting so no early snapshot/progress is missed; the
          // mirror feeds resourceStore (lists + per-connection runtime) AND projects appRuntime → the shell
          // phase via applyAppRuntime. This is what makes auto-connect AND the Connect button visibly work.
          startResourceMirror();
          // Multi-connection bootstrap: bring up every auto-start connection IN PARALLEL via main (isolated
          // failures — one offline engine never blocks the others or the app). The shell flips to READY as
          // soon as the first engine reports running (applyAppRuntime); a slow/failing engine never blocks it.
          systemNotifier.transmit("startup.phase", { trace: "Connecting engines" });
          await window.MessageBus.invoke(RESOURCE_SYNC.connectAll);
          // Backstop: settle from a direct snapshot in case a push raced our subscription.
          const snapshot = await window.MessageBus.invoke(RESOURCE_SYNC.getSnapshot);
          if (snapshot) {
            applyResourceSyncSnapshot(snapshot);
          }
          // Bootstrap done: leave the splash even if nothing came up (the landing redirect then routes to the
          // connection manager). applyAppRuntime already set READY if an engine connected.
          if (get().phase === AppBootstrapPhase.STARTING) {
            get().setPhase(AppBootstrapPhase.READY);
          }
          if (get()?.userSettings?.checkLatestVersion && !checkForUpdatePerformed) {
            checkForUpdatePerformed = true;
            delayCheckUpdate(get().osType);
          }
        } catch (error: any) {
          console.error("Error during application startup", error);
          // Never trap on the splash — show the workspace; the connection manager handles recovery.
          get().setPhase(AppBootstrapPhase.READY);
        } finally {
          systemNotifier.transmit("startup.phase", { trace: "Startup finished" });
        }
        return get().phase === AppBootstrapPhase.READY;
      });
    },
    stopApplication: async (options) => {
      let nextPhase = AppBootstrapPhase.STOPPING;
      return runPending(async () => {
        const instance = Application.getInstance();
        systemNotifier.transmit("startup.phase", { trace: "Startup entering setup" });
        await instance.setup();
        try {
          get().setPhase(nextPhase);
          await get().reset();
          const environment = import.meta.env.ENVIRONMENT;
          const version = import.meta.env.PROJECT_VERSION;
          const userSettings = await instance.getGlobalUserSettings();
          await instance.stop(options);
          const connectors = instance.getConnectors();
          const running = false;
          const osType = instance.getOsType();
          const provisioned = true;
          nextPhase = AppBootstrapPhase.FAILED;
          get().domainUpdate({
            phase: nextPhase,
            osType,
            version,
            environment,
            provisioned,
            running,
            connectors,
            currentConnector: undefined,
            nextConnection: undefined,
            userSettings,
          });
        } catch (error: any) {
          console.error("Error during application stopping", error);
        }
        return nextPhase === AppBootstrapPhase.READY;
      });
    },
    getGlobalUserSettings: async () =>
      runPending(async () => {
        try {
          const instance = Application.getInstance();
          const userSettings = await instance.getGlobalUserSettings();
          get().syncGlobalUserSettings(userSettings);
          return userSettings;
        } catch (error: any) {
          console.error("Error during global user preferences update", error);
        }
        return {} as GlobalUserSettings;
      }),
    setGlobalUserSettings: async (options) =>
      runPending(async () => {
        try {
          const instance = Application.getInstance();
          instance.setLogLevel(options.logging?.level || "debug");
          const userSettings = await instance.setGlobalUserSettings(options);
          get().syncGlobalUserSettings(userSettings);
          // §B single-home: when the settings import carries a `connections` blob, refresh the
          // authoritative appStore.connections so it never drifts from userSettings.connections.
          if (options.connections) {
            get().setConnections(options.connections);
          }
        } catch (error: any) {
          console.error("Error during global user preferences update", error);
        }
      }),
    setConnectorSettings: async (options) =>
      runPending(async () => {
        try {
          const instance = Application.getInstance();
          const updated = await instance.setConnectorSettings(options.id, options.settings);
          get().syncEngineUserSettings(options);
          return updated;
        } catch (error: any) {
          console.error("Error during host user preferences update", error);
        }
        return undefined;
      }),
    findProgram: async ({ connection, program, insideScope }) =>
      runPending(async () => {
        try {
          const instance = Application.getInstance();
          return await instance.findProgram(connection, program, insideScope);
        } catch (error: any) {
          console.error("Error during connection string test", error);
        }
        return undefined;
      }),
    generateKube: async (options) =>
      runPending(async () => {
        try {
          return await Application.getInstance().generateKube(options.entityId);
        } catch (error: any) {
          console.error("Error during kube generation", error);
        }
        return undefined;
      }),

    // ── async: connection CRUD (folded from Settings/Model) ──
    getConnections: async () =>
      runPending(async () => {
        const instance = Application.getInstance();
        const systemItems = await instance.getSystemConnections();
        const userItems = await instance.getConnections();
        const items = [...systemItems, ...userItems];
        get().setConnections(items);
        return items;
      }),
    createConnection: async (connection) =>
      runPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.createConnection(connection);
        await get().getConnections();
        return info;
      }),
    updateConnection: async ({ id, connection }) =>
      runPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.updateConnection(id, connection);
        await get().getConnections();
        return info;
      }),
    removeConnection: async (id) =>
      runPending(async () => {
        const instance = Application.getInstance();
        const info = await instance.removeConnection(id);
        await get().getConnections();
        return info;
      }),

    // ── async: per-connection lifecycle (always-merged workspace — additive, no global reset) ──
    // connect/disconnect a SINGLE connection via main; main re-pushes a merged snapshot, so the runtime
    // store + merged lists update without a full bootstrap. Used by the header connection manager + Settings.
    connectOne: async (connectionId) =>
      runPending(async () => {
        try {
          await waitForPendingPaint();
          await window.MessageBus.invoke(RESOURCE_SYNC.ensureConnected, { connectionId });
        } catch (error: any) {
          console.error("Unable to connect engine", connectionId, error);
          Notification.show({ message: t("Unable to establish connection"), intent: Intent.DANGER });
        }
      }),
    disconnectOne: async (connectionId) =>
      runPending(async () => {
        try {
          await waitForPendingPaint();
          await window.MessageBus.invoke(RESOURCE_SYNC.disconnect, { connectionId });
        } catch (error: any) {
          console.error("Unable to disconnect engine", connectionId, error);
        }
      }),
    // "Primary" = the default create/pull target (persisted, renderer-owned) — no engine restart.
    makePrimary: async (connectionId) => {
      await get().setGlobalUserSettings({ connector: { default: connectionId } });
    },
  };
});

// Bootstrap-phase listeners (ported from createModel) — append phases to the startup screen while STARTING.
systemNotifier.on("startup.phase", (event: SystemNotification) => {
  if (useAppStore.getState().phase === AppBootstrapPhase.STARTING) {
    useAppStore.getState().insertBootstrapPhase(event);
  }
});
systemNotifier.on("engine.availability", (event: SystemNotification) => {
  if (useAppStore.getState().phase === AppBootstrapPhase.STARTING) {
    useAppStore.getState().insertBootstrapPhase(event);
  }
});
