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
import { RESOURCE_SYNC } from "@/container-client/resourceSyncProtocol";
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
import { useResourceStore } from "@/web-app/stores/resourceStore";
import { useUIStore } from "@/web-app/stores/uiStore";

export const DEFAULT_SYSTEM_CONNECTION_ID = "system-default.podman";

let checkForUpdatePerformed = false;

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

// One-time (authority window only): follow a tray-initiated connection switch. The tray popover asks main
// to switch; with a main window open, main forwards `tray:switch-connection` here so the app UI tracks the
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
      void state.startApplication({ connection, startApi: false, skipAvailabilityCheck: false });
    }
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
  // async — bootstrap / settings
  initialize: () => Promise<void>;
  reset: () => Promise<void>;
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

    // ── async: bootstrap / settings ──
    initialize: async () => {
      await waitForPreload();
      registerTraySwitchListener(get);
      const instance = Application.getInstance();
      const settings = await instance.getGlobalUserSettings();
      instance.setLogLevel(settings?.logging.level || "debug");
      get().syncGlobalUserSettings(settings);
    },
    reset: async () => {
      // Post-migration there are no screen sub-models to wipe (§B): drop the server cache and UI state.
      await resourceEvents.stopAll();
      get().resetBootstrapPhases();
      queryClient.clear();
      useResourceStore.getState().resetAll();
      useUIStore.getState().reset();
    },
    startApplication: async (options) => {
      await waitForPreload();
      get().resetBootstrapPhases();
      let nextPhase = AppBootstrapPhase.STARTING;
      const state = get();
      let connection = options?.connection || state.currentConnector;
      let startApi = options?.startApi || connection?.settings?.api?.autoStart || false;
      get().setNextConnection(connection);
      return runPending(async () => {
        const instance = Application.getInstance();
        systemNotifier.transmit("startup.phase", { trace: "Starting setup" });
        await instance.setup();
        systemNotifier.transmit("startup.phase", { trace: "Setup ready" });
        const userSettings = await instance.getGlobalUserSettings();
        await instance.notify("ready", userSettings);
        try {
          get().setPhase(nextPhase);
          await get().reset();
          await instance.stop();
          systemNotifier.transmit("startup.phase", { trace: "Reading settings" });
          const environment = import.meta.env.ENVIRONMENT;
          const version = import.meta.env.PROJECT_VERSION;
          const userSettings = await instance.getGlobalUserSettings();
          if (!userSettings?.connector?.default) {
            userSettings.connector = { default: DEFAULT_SYSTEM_CONNECTION_ID };
          }
          if (!connection) {
            systemNotifier.transmit("startup.phase", { trace: "Listing connections" });
            const userConnections = await instance.getConnections();
            const systemConnections = await instance.getSystemConnections();
            const connections = [...systemConnections, ...userConnections];
            get().setConnections(connections);
            const defaultConnector = connections.find((it) => it.id === userSettings?.connector?.default);
            if (defaultConnector) {
              connection = defaultConnector;
              startApi = options?.startApi || defaultConnector?.settings?.api?.autoStart || false;
            }
          }
          systemNotifier.transmit("startup.phase", { trace: "Establishing connection" });
          // Single connection: main owns the engine connection the renderer's forwarded HTTP rides on, so
          // make main connect FIRST (idempotent, awaited) before instance.start() issues any engine request.
          if (connection?.id) {
            await window.MessageBus.invoke(RESOURCE_SYNC.ensureConnected, { connectionId: connection.id });
          }
          const currentConnector = await instance.start(
            connection ? { startApi, connection, skipAvailabilityCheck: false } : undefined,
          );
          const connectors = instance.getConnectors();
          const running = currentConnector?.availability?.api || false;
          const osType = instance.getOsType();
          const provisioned = true;
          if (currentConnector) {
            nextPhase = provisioned
              ? running
                ? AppBootstrapPhase.READY
                : AppBootstrapPhase.FAILED
              : AppBootstrapPhase.FAILED;
            get().domainUpdate({
              phase: nextPhase,
              osType,
              version,
              environment,
              provisioned,
              running,
              connectors,
              currentConnector,
              userSettings,
              systemNotifications: [],
            });
            if (nextPhase === AppBootstrapPhase.READY || nextPhase === AppBootstrapPhase.FAILED) {
              if (get()?.userSettings?.checkLatestVersion) {
                if (!checkForUpdatePerformed) {
                  checkForUpdatePerformed = true;
                  delayCheckUpdate(osType);
                }
              }
            }
            if (currentConnector.availability.api) {
              // Main already owns this connection (ensureConnected ran before any engine request above);
              // begin mirroring its pushed snapshots into the resource store.
              await resourceEvents.start(currentConnector.id);
              Notification.show({
                message: t("You are now connected to {{name}}", currentConnector),
                intent: Intent.SUCCESS,
              });
            } else {
              Notification.show({
                message: t("Unable to establish connection"),
                intent: Intent.DANGER,
              });
            }
          } else {
            nextPhase = AppBootstrapPhase.FAILED;
            get().domainUpdate({
              phase: nextPhase,
              osType,
              version,
              environment,
              provisioned,
              running,
              connectors,
              currentConnector,
              userSettings,
            });
          }
        } catch (error: any) {
          console.error("Error during application startup", error);
          nextPhase = AppBootstrapPhase.FAILED;
          get().domainUpdate({ phase: nextPhase });
        } finally {
          systemNotifier.transmit("startup.phase", { trace: "Startup finished" });
        }
        return nextPhase === AppBootstrapPhase.READY;
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
