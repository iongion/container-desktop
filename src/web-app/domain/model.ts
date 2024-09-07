import { Intent } from "@blueprintjs/core";
import { action, thunk } from "easy-peasy";
import produce from "immer";
import { isObject } from "lodash-es";

// project
import { Application } from "@/container-client/Application";
import { Connector, OperatingSystem } from "@/env/Types";
import { deepMerge } from "@/utils";
import { t } from "@/web-app/App.i18n";
import { registry } from "@/web-app/domain/registry";
import { Notification } from "@/web-app/Notification";
import { AppBootstrapPhase, AppModel, AppModelState, AppRegistry } from "./types";

function delayCheckUpdate() {
  setTimeout(async () => {
    try {
      const check = await registry.onlineApi.checkLatestVersion();
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
  const model: AppModel = {
    phase: AppBootstrapPhase.INITIAL,
    pending: false,
    native: true,
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
    syncGlobalUserSettings: action((state, values) => {
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
        const instance = Application.getInstance();
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
        await instance.setup();
        await instance.notify("ready");
        try {
          await actions.setPhase(nextPhase);
          await actions.reset();
          await instance.stop();
          // offload
          const environment = import.meta.env.ENVIRONMENT;
          const version = import.meta.env.PROJECT_VERSION;
          const userSettings = await instance.getGlobalUserSettings();
          if (!connection) {
            const connections = await instance.getConnections();
            const defaultConnector = connections.find((it) => it.id === userSettings?.connector?.default);
            if (defaultConnector) {
              console.debug("Using default connector", defaultConnector, "in mode", defaultConnector?.settings?.mode);
              connection = defaultConnector;
              startApi = options?.startApi || defaultConnector?.settings?.api?.autoStart || false;
            } else {
              console.debug("No default connector found", userSettings?.connector?.default);
            }
          }
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
              userSettings
            });
            // check for new version if enabled
            if (nextPhase === AppBootstrapPhase.READY || nextPhase === AppBootstrapPhase.FAILED) {
              const state = store.getState();
              if (state?.userSettings?.checkLatestVersion) {
                delayCheckUpdate();
              }
            }
            if (!currentConnector.availability.api) {
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
          const program = await registry.getApi().generateKube(options);
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
