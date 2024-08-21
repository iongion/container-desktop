// project
import { adapters } from "@/container-client";
import { createLogger } from "@/logger";
import { getDefaultDescriptor } from "./descriptor";
// Actions
import { ActionContext, ActionsEnvironment, BridgeApi, BridgeContext } from "@/container-app/bridge/types";
import * as connectActions from "./connect";
import * as controllerActions from "./controller";
import * as generateActions from "./generate";
import * as machineActions from "./machine";
import * as podActions from "./pod";
import * as programActions from "./program";
import * as proxyActions from "./proxy";
import * as registryActions from "./registry";
import * as securityActions from "./security";
import * as settingsActions from "./settings";
import * as setupActions from "./setup";
import * as systemActions from "./system";
import * as testActions from "./test";
import * as windowActions from "./window";
// locals
const { Podman, Docker } = adapters;

const actionsList = [
  connectActions,
  controllerActions,
  generateActions,
  machineActions,
  podActions,
  programActions,
  proxyActions,
  registryActions,
  securityActions,
  setupActions,
  settingsActions,
  systemActions,
  testActions,
  windowActions
];

const adaptersList = [Podman.Adapter, Docker.Adapter];

export const createBridge = async (bridgeOpts: BridgeContext) => {
  const { userConfiguration, osType, version, environment } = bridgeOpts;
  const alternativeConnectorId = "engine.default.podman.virtualized";
  const defaultConnectorId = osType === "Linux" ? "engine.default.podman.native" : alternativeConnectorId;
  const logger = await createLogger("bridge");
  let adapters: any[] = [];
  let engines: any[] = [];
  const connectors: any[] = [];
  let inited = false;
  let currentApi: BridgeApi | undefined | null = {
    provisioned: false,
    running: false,
    started: false,
    connector: undefined,
    engine: undefined,
    destroy: async () => {
      logger.debug("API not started");
      return false;
    }
  };
  let descriptor: any = getDefaultDescriptor({
    osType,
    version,
    environment
  });
  const actionContext: ActionContext = {
    getCurrentApi: () => currentApi!,
    getAdapters: () => adapters,
    getEngines: () => engines,
    getConnectors: () => connectors,
    userConfiguration,
    osType,
    version,
    environment
  };
  const actionsEnvironment: ActionsEnvironment = {
    ipcRenderer: bridgeOpts.ipcRenderer,
    userConfiguration,
    osType,
    version,
    environment,
    defaultConnectorId
  };
  const init = async () => {
    // All logic is done only once at application startup - can be updated during engine changes by the start logic
    if (inited) {
      logger.debug("Init skipping - already initialized");
      return inited;
    }
    try {
      adapters = adaptersList.map((Adapter) => Adapter.create(userConfiguration, osType));
      engines = adapters.reduce((acc, adapter) => {
        const adapterEngines = adapter.createEngines();
        acc.push(...adapterEngines);
        return acc;
      }, []);
      await Promise.all(
        engines.map(async (engine) => {
          try {
            // detect settings
            try {
              await engine.updateSettings();
              // Update cached
            } catch (error: any) {
              logger.error(engine.id, "Init - Unable to complete detection", error.message, error.stack);
            }
            // update upon detection
            const connector = await engine.getConnector();
            connectors.push(connector);
          } catch (error: any) {
            logger.error(engine.id, "Init - Unable to get engine connector", error.message, error.stack);
          }
        })
      );
    } catch (error: any) {
      logger.error("Init - Unable to initialize", error.message, error.stack);
    }
    inited = true;
    return inited;
  };
  const getCurrentConnector = async (opts: any) => {
    // decide current connector
    let connector;
    // if from start function argument
    let userConnectorId = opts?.id;
    // if from saved preferences
    if (!userConnectorId) {
      const connector = await userConfiguration.getKey<any>("connector");
      userConnectorId = connector?.default;
    }
    if (userConnectorId) {
      connector = connectors.find((it) => it.id === userConnectorId);
    }
    // if none found - default
    if (!connector) {
      logger.warn("No default user connector - picking preferred(favor podman)", defaultConnectorId);
      connector = connectors.find(({ id }) => id === defaultConnectorId);
    }
    // if no default found - alternative (this can happen if detection crashes)
    if (!connector) {
      logger.warn("No default user connector - picking preferred(favor podman)", alternativeConnectorId);
      connector = connectors.find(({ id }) => id === alternativeConnectorId);
    }
    // this is last resort - bad
    if (!connector) {
      logger.error("Defaulting to first connector");
      connector = connectors[0];
    }
    if (opts?.settings) {
      logger.debug("Using custom connector settings", opts.settings);
      connector.settings.current = opts.settings;
    }
    return connector;
  };
  const createConnectorEngineApi = async (connector, opts) => {
    logger.debug("Creating connector engine api", connector?.id);
    const startApi = !!opts?.startApi || (await userConfiguration.getKey("startApi", false));
    let provisioned = false;
    let running = false;
    let started = false;
    let engine;
    if (connector) {
      try {
        engine = engines.find((it) => it.id === connector.id);
        if (engine) {
          if (opts?.settings) {
            logger.debug("Using custom current engine settings", opts.settings);
            await engine.setCurrentSettings(connector.settings.current);
          }
          if (startApi) {
            try {
              logger.debug(connector.id, "Creating connector engine api start - trigger");
              started = await engine.startApi();
              // After start - availability must be re-computed
              connector.availability = await engine.getAvailability(connector.settings.current);
              logger.debug(connector.id, "Creating connector engine api post-start", connector);
            } catch (error: any) {
              logger.error(connector.id, "Creating connector engine api start - failed", error.message, error.stack);
            }
          }
        }
        if (typeof connector.availability.controller !== "undefined") {
          provisioned = connector.availability.controller;
        } else {
          provisioned = connector.availability.program;
        }
        running = connector.availability.api;
      } catch (error: any) {
        logger.error("Connector engine api creation error", error.message, error.stack);
      }
    }
    const host = {
      provisioned,
      running,
      started,
      connector,
      engine,
      destroy: async () => {
        if (host.connector && host.started) {
          if (engine) {
            try {
              logger.debug(host.connector?.id, "Stopping existing API");
              await engine.stopApi();
              host.connector.availability.api = false;
              host.running = false;
              host.started = false;
            } catch (error: any) {
              logger.error(host.connector?.id, "Stopping existing API failed", error.message, error.stack);
            }
          } else {
            logger.warn("Stopping existing API- skipped(not engine)");
          }
        } else {
          logger.debug("Stopping existing API- skipped(not started)");
        }
        return true;
      }
    };
    return host;
  };
  const bridge: any = {
    // plugins
    ...actionsList.reduce((acc, it) => {
      const actions = it.createActions(actionContext, actionsEnvironment);
      acc = { ...acc, ...actions };
      return acc;
    }, {}),
    // extras
    async start(opts) {
      logger.debug("Bridge startup - begin", opts);
      try {
        await init();
        if (currentApi) {
          await currentApi.destroy();
          currentApi = undefined;
        }
        logger.debug("Bridge startup - creating current");
        currentApi = await createConnectorEngineApi(await getCurrentConnector(opts), opts);
      } catch (error: any) {
        logger.error("Bridge startup error", error);
      }
      logger.debug("Bridge startup - creating descriptor", opts);
      descriptor = {
        environment,
        version,
        osType,
        provisioned: !!currentApi?.provisioned,
        running: !!currentApi?.running,
        connectors,
        currentConnector: currentApi?.connector,
        userSettings: (await bridge.getGlobalUserSettings()) || {}
      };
      return descriptor;
    }
  };
  return bridge;
};

export async function createContext(opts: BridgeContext) {
  const descriptor: any = getDefaultDescriptor({
    osType: opts.osType,
    version: opts.version,
    environment: opts.environment
  });
  const bridge = await createBridge(opts);
  descriptor.userSettings = await bridge.getGlobalUserSettings();
  const connector = await opts.userConfiguration.getKey<any>("connector");
  return {
    available: true,
    osType: opts.osType,
    defaults: {
      connector: connector?.default,
      // This must not fail - prevents startup failures to put the app in an undefined state
      descriptor
    },
    application: bridge
  };
}

export default {
  createContext,
  createBridge
};
