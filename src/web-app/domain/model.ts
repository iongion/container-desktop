import { Intent } from "@blueprintjs/core";
import { action, thunk } from "easy-peasy";
import produce from "immer";
import { isObject } from "lodash-es";
// project
import { Application } from "@/container-client/Application";
import { systemNotifier } from "@/container-client/notifier";
import { Connector, OperatingSystem } from "@/env/Types";
import { deepMerge } from "@/utils";
import { t } from "@/web-app/App.i18n";
import { registry } from "@/web-app/domain/registry";
import { Notification } from "@/web-app/Notification";
import { AppBootstrapPhase, AppModel, AppModelState, AppRegistry } from "./types";

function delayCheckUpdate() {
  setTimeout(async () => {
    try {
      const check = await registry.getOnlineApi().checkLatestVersion();
      console.debug("Checking for new version", check);
      if (check.hasUpdate) {
        Notification.show({
          message: t("A newer version {{latest}} has been found", check),
          intent: Intent.PRIMARY
        });
      }
    } catch (error: any) {
      console.error("Unable to read latest version", error);
    }
  }, 1500);
}

export const createModel = async (registry: AppRegistry): Promise<AppModel> => {
  const osType = (window as any).CURRENT_OS_TYPE || OperatingSystem.Unknown;
  const instance = Application.getInstance();
  systemNotifier.on("startup.phase", (event) => {
    const state = registry.getStore().getState();
    if (state.phase === AppBootstrapPhase.STARTING) {
      registry.getStore().getActions().insertBootstrapPhase(event);
    }
  });
  systemNotifier.on("engine.availability", (event) => {
    const state = registry.getStore().getState();
    if (state.phase === AppBootstrapPhase.STARTING) {
      registry.getStore().getActions().insertBootstrapPhase(event);
    }
  });
  const model: AppModel = {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native: true,
    systemNotifications: [],
    // descriptor
    environment: import.meta.env.ENVIRONMENT,
    version: import.meta.env.PROJECT_VERSION,
    osType,
    provisioned: false,
    running: false,
    connectors: [],
    currentConnector: undefined,
    userSettings: {} as any,
    // Actions
    setPhase: action((state, phase) => {
      if (phase === AppBootstrapPhase.CONNECTING) {
        state.provisioned = false;
        state.running = false;
      }
      state.phase = phase;
    }),
    setPending: action((state, flag) => {
      state.pending = flag;
    }),
    insertBootstrapPhase: action((state, phase) => {
      state.systemNotifications.push(phase);
    }),
    resetBootstrapPhases: action((state) => {
      state.systemNotifications = [];
    }),
    syncGlobalUserSettings: action((state, values) => {
      if (values?.connector?.default) {
        values.connector = {
          default: "system-default.podman"
        };
      }
      state.userSettings = values;
    }),
    syncEngineUserSettings: action((state, values) => {
      if (state.currentConnector) {
        state.currentConnector.settings = deepMerge(state.currentConnector.settings, values.settings);
      }
      state.connectors = produce(state.connectors, (draft: Connector[]) => {
        const index = draft.findIndex((it) => it.id === values.id);
        if (index !== -1) {
          draft[index].settings = deepMerge(draft[index].settings, values.settings);
        }
      });
    }),
    domainUpdate: action((state, opts: Partial<AppModelState>) => {
      Object.keys(opts).forEach((key) => {
        state[key] = isObject(opts[key]) ? deepMerge({}, state[key] || {}, opts[key]) : opts[key];
      });
    }),
    // Thunks
    reset: thunk(async (actions) => {
      actions.resetBootstrapPhases({});
      actions.container.reset();
      actions.dashboard.reset();
      actions.image.reset();
      actions.machine.reset();
      actions.network.reset();
      actions.registry.reset();
      actions.pod.reset();
      actions.secret.reset();
      actions.settings.reset();
      actions.troubleshoot.reset();
      actions.volume.reset();
    }),
    stopApplication: thunk(async (actions, options, store) => {
      //
      let nextPhase = AppBootstrapPhase.STOPPING;
      return registry.withPending(async () => {
        systemNotifier.transmit("startup.phase", {
          trace: "Startup entering setup"
        });
        await instance.setup();
        await instance.notify("ready");
        try {
          await actions.setPhase(nextPhase);
          await actions.reset();
          // offload
          const environment = import.meta.env.ENVIRONMENT;
          const version = import.meta.env.PROJECT_VERSION;
          const userSettings = await instance.getGlobalUserSettings();
          await instance.stop(options);
          const connectors = instance.getConnectors();
          const running = false;
          const osType = instance.getOsType();
          const provisioned = true;
          nextPhase = AppBootstrapPhase.FAILED;
          await actions.domainUpdate({
            phase: nextPhase,
            osType,
            version,
            environment,
            provisioned,
            running,
            connectors,
            currentConnector: undefined,
            userSettings
          });
        } catch (error: any) {
          console.error("Error during application stopping", error);
        }
        return nextPhase === AppBootstrapPhase.READY;
      });
    }),
    startApplication: thunk(async (actions, options, store) => {
      await actions.resetBootstrapPhases({});
      let nextPhase = AppBootstrapPhase.STARTING;
      const state = store.getState();
      let connection = options?.connection || state.currentConnector;
      let startApi = options?.startApi || connection?.settings?.api?.autoStart || false;
      const app = document.querySelector("body");
      if (app) {
        app.setAttribute("data-runtime", connection?.runtime || "podman");
      }
      return registry.withPending(async () => {
        const instance = Application.getInstance();
        systemNotifier.transmit("startup.phase", {
          trace: "Starting setup"
        });
        await instance.setup();
        systemNotifier.transmit("startup.phase", {
          trace: "Setup ready"
        });
        await instance.notify("ready");
        try {
          await actions.setPhase(nextPhase);
          await actions.reset();
          await instance.stop();
          // offload
          systemNotifier.transmit("startup.phase", {
            trace: "Reading settings"
          });
          const environment = import.meta.env.ENVIRONMENT;
          const version = import.meta.env.PROJECT_VERSION;
          const userSettings = await instance.getGlobalUserSettings();
          if (!connection) {
            systemNotifier.transmit("startup.phase", {
              trace: "Listing connections"
            });
            const userConnections = await instance.getConnections();
            const systemConnections = await instance.getSystemConnections();
            const connections = [...systemConnections, ...userConnections];
            const defaultConnector = connections.find((it) => it.id === userSettings?.connector?.default);
            if (defaultConnector) {
              console.debug("Using default connector", defaultConnector, "in mode", defaultConnector?.settings?.mode);
              connection = defaultConnector;
              startApi = options?.startApi || defaultConnector?.settings?.api?.autoStart || false;
            } else {
              console.debug("No default connector found", userSettings?.connector?.default);
            }
          }
          systemNotifier.transmit("startup.phase", {
            trace: "Establishing connection"
          });
          const currentConnector = await instance.start(connection ? { startApi, connection, skipAvailabilityCheck: false } : undefined);
          const connectors = instance.getConnectors();
          const running = currentConnector?.availability?.api || false;
          const osType = instance.getOsType();
          const provisioned = true;
          if (currentConnector) {
            let nextPhase: any = AppBootstrapPhase.STARTED;
            if (provisioned) {
              if (running) {
                nextPhase = AppBootstrapPhase.READY;
              } else {
                nextPhase = AppBootstrapPhase.FAILED;
              }
            } else {
              nextPhase = AppBootstrapPhase.FAILED;
            }
            await actions.domainUpdate({
              phase: nextPhase,
              osType,
              version,
              environment,
              provisioned,
              running,
              connectors,
              currentConnector,
              userSettings,
              systemNotifications: []
            });
            // check for new version if enabled
            if (nextPhase === AppBootstrapPhase.READY || nextPhase === AppBootstrapPhase.FAILED) {
              const state = store.getState();
              if (state?.userSettings?.checkLatestVersion) {
                delayCheckUpdate();
              }
            }
            if (currentConnector.availability.api) {
              console.debug("Api started - connection is available");
            } else {
              Notification.show({
                message: t("Unable to start the application - current connection API is not available"),
                intent: Intent.DANGER
              });
            }
          } else {
            nextPhase = AppBootstrapPhase.FAILED;
            await actions.domainUpdate({
              phase: nextPhase,
              osType,
              version,
              environment,
              provisioned,
              running,
              connectors,
              currentConnector,
              userSettings
            });
          }
        } catch (error: any) {
          console.error("Error during application startup", error);
          nextPhase = AppBootstrapPhase.FAILED;
          await actions.domainUpdate({
            phase: nextPhase
          });
        } finally {
          systemNotifier.transmit("startup.phase", {
            trace: "Startup finished"
          });
        }
        return nextPhase === AppBootstrapPhase.READY;
      });
    }),
    // Injections
    connectorUpdate: action((state, connector: Connector) => {
      console.debug("Must update connector", connector);
      state.connectors = produce(state.connectors, (draft: Connector[]) => {
        const index = draft.findIndex((it) => it.id === connector.id);
        if (index !== -1) {
          draft[index] = deepMerge(draft[index], connector);
        }
      });
    }),
    connectorUpdateSettingsById: action((state, { id, settings }) => {
      console.debug("Updating connector settings", { id, settings });
      state.connectors = produce(state.connectors, (draft: Connector[]) => {
        const index = draft.findIndex((it) => it.id === id);
        if (index !== -1) {
          draft[index] = deepMerge<Connector>(draft[index], { settings });
        }
      });
    }),
    // Global
    setGlobalUserSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const instance = Application.getInstance();
          const userSettings = await instance.setGlobalUserSettings(options);
          await actions.syncGlobalUserSettings(userSettings);
        } catch (error: any) {
          // TODO: Notify the user
          console.error("Error during global user preferences update", error);
        }
      });
    }),
    getGlobalUserSettings: thunk(async (actions) => {
      return registry.withPending(async () => {
        try {
          const instance = Application.getInstance();
          const userSettings = await instance.getGlobalUserSettings();
          await actions.syncGlobalUserSettings(userSettings);
          return userSettings;
        } catch (error: any) {
          console.error("Error during global user preferences update", error);
        }
        return {} as any;
      });
    }),
    // Engine
    setConnectorSettings: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const instance = Application.getInstance();
          const updated = await instance.setConnectorSettings(options.id, options.settings);
          actions.syncEngineUserSettings(options);
          return updated;
        } catch (error: any) {
          // TODO: Notify the user
          console.error("Error during engine user preferences update", error);
        }
      });
    }),
    // Others
    findProgram: thunk(async (actions, { connection, program, insideScope }, { getState }) => {
      return registry.withPending(async () => {
        try {
          const instance = Application.getInstance();
          const result = await instance.findProgram(connection, program, insideScope);
          return result;
        } catch (error: any) {
          console.error("Error during connection string test", error);
        }
      });
    }),
    // Generators
    generateKube: thunk(async (actions, options, { getState }) => {
      return registry.withPending(async () => {
        try {
          const client = await registry.getContainerClient();
          const program = await client.generateKube(options);
          return program;
        } catch (error: any) {
          console.error("Error during connection string test", error);
        }
      });
    })
  };
  console.debug("Domain model created");
  return model;
};
