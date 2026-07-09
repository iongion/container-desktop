import { ContainerEngineHost, type EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { getWindowsPipePath } from "@/platform";
import { isEmpty } from "@/utils";
import type { HostContext, HostProfile } from "../composition";
import {
  availableAlways,
  availableOn,
  availableUnless,
  defaultGetAutomaticSettings,
  limaApiConnection,
  sshApiConnection,
} from "./shared";

// docker-vendor's reduced automatic-settings (no scope-program detection) — docker/vendor.ts:84.
async function dockerVendorAutomaticSettings(
  host: HostContext,
  settings: EngineConnectorSettings,
): Promise<EngineConnectorSettings> {
  host.logger.debug(host.id, "Settings are in automatic mode - fetching");
  try {
    // 1.0 - detect program
    if (host.isScoped()) {
      const existingScope = settings.controller?.scope || "";
      const controllerProgram = await host.findHostProgram({ name: host.CONTROLLER, path: "" }, settings);
      settings.controller = controllerProgram;
      settings.controller.scope = existingScope;
    } else {
      const hostProgram = await host.findHostProgram({ name: host.PROGRAM, path: "" }, settings);
      settings.program = hostProgram;
    }
    // 2.0 - detect API connection
    const api = await host.getApiConnection(undefined, settings);
    settings.api.connection.uri = api.uri;
    settings.api.connection.relay = api.relay;
  } catch (error: any) {
    host.logger.error(host.id, "Unable to get automatic settings", error);
  }
  return settings;
}

export const dockerNativeProfile: HostProfile = {
  HOST: ContainerEngineHost.DOCKER_NATIVE,
  LABEL: "Docker Native",
  async getApiConnection(host, _connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    let uri = await host.dialect.resolveNativeURISeed(host, settings);
    try {
      uri = (await host.dialect.readEngineSocket(host, settings)) || "";
    } catch (error: any) {
      host.logger.warn(host.id, "Unable to get context inspect", error);
    }
    return { uri, relay: "" };
  },
  async isEngineAvailable(host) {
    return availableOn(host, OperatingSystem.Linux);
  },
  getAutomaticSettings(host, settings) {
    return defaultGetAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return base;
  },
};

export const dockerVendorProfile: HostProfile = {
  HOST: ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
  LABEL: "Docker Desktop",
  async getApiConnection(host, connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    let relay = "";
    let uri = "";
    if (host.osType === OperatingSystem.Windows) {
      const dockerHost = await Platform.getEnvironmentVariable("DOCKER_HOST");
      if (isEmpty(dockerHost)) {
        let scope = "dockerDesktopLinuxEngine";
        const defaultPipeExists = await FS.isFilePresent(getWindowsPipePath(scope, true));
        if (!defaultPipeExists) {
          scope = "docker_engine";
        }
        uri = getWindowsPipePath(scope, true) || "";
      } else {
        uri = dockerHost || "";
      }
    } else {
      uri = await host.dialect.resolveNativeURISeed(host, settings);
      try {
        uri = ((await host.dialect.readEngineSocket(host, settings)) || uri).replace("unix://", "");
      } catch (error: any) {
        host.logger.warn(host.id, "Unable to get context inspect", error);
      }
    }
    // Inspect machine system info for relay path
    try {
      const systemInfo = await host.getSystemInfo(connection, undefined, customSettings);
      relay = systemInfo?.host?.remoteSocket?.path || relay;
    } catch (error: any) {
      host.logger.error(host.id, "Unable to inspect machine", error);
    }
    return { uri, relay };
  },
  async isEngineAvailable(host) {
    return availableUnless(host, OperatingSystem.Linux);
  },
  getAutomaticSettings(host, settings) {
    return dockerVendorAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return base;
  },
};

export const dockerWSLProfile: HostProfile = {
  HOST: ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
  LABEL: "Docker WSL",
  async getApiConnection(host, _connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    const scope = settings.controller?.scope || "";
    if (!scope) {
      host.logger.error(host.id, "getApiConnection requires a scope");
      return { uri: "", relay: "" };
    }
    const uri = await host.transport.resolveScopeURI(host, settings);
    // Read DOCKER_HOST inside the scope (preserves the `wsl … printenv DOCKER_HOST` spawn); overwritten by the
    // context inspect below when it succeeds, kept as the fallback when it throws.
    let relay = (await host.getScopeEnvironmentVariable(scope, "DOCKER_HOST")) || "";
    try {
      relay = (await host.dialect.readEngineSocket(host, settings)) || "";
    } catch (error: any) {
      host.logger.warn(host.id, "Unable to get context inspect", error);
    }
    return { uri, relay };
  },
  async isEngineAvailable(host) {
    return availableOn(host, OperatingSystem.Windows);
  },
  getAutomaticSettings(host, settings) {
    return defaultGetAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return base;
  },
};

export const dockerLIMAProfile: HostProfile = {
  HOST: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
  LABEL: "Docker LIMA",
  getApiConnection(host, _connection, customSettings) {
    return limaApiConnection(host, customSettings);
  },
  async isEngineAvailable(host) {
    return availableOn(host, OperatingSystem.MacOS);
  },
  getAutomaticSettings(host, settings) {
    return defaultGetAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return base;
  },
};

export const dockerSSHProfile: HostProfile = {
  HOST: ContainerEngineHost.DOCKER_REMOTE,
  LABEL: "Docker SSH",
  getApiConnection(host, _connection, customSettings) {
    return sshApiConnection(host, customSettings);
  },
  async isEngineAvailable() {
    return availableAlways();
  },
  getAutomaticSettings(host, settings) {
    return defaultGetAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return base;
  },
};
