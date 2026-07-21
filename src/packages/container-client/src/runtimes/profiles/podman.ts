// runtimes/profiles/podman.ts — the 5 Podman per-(engine,host) profiles.
//
// Each holds the verbatim per-host getApiConnection (composed from transport scope-URI ∘ dialect socket read),
// the OS availability gate, the automatic-settings detection, and the capability host-adjustment (machines is
// real only on native/vendor — false on WSL/LIMA/SSH, Finding B).

import { ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import { isEmpty } from "@/utils";
import type { HostProfile } from "../composition";
import { isWindowsNamedPipe } from "../dialects/podman-machine-pipe";
import {
  availableAlways,
  availableOn,
  defaultGetAutomaticSettings,
  limaApiConnection,
  sshApiConnection,
  withControllerVersion,
  withMachines,
} from "./shared";

export const podmanNativeProfile: HostProfile = {
  HOST: ContainerEngineHost.PODMAN_NATIVE,
  LABEL: "Podman Native",
  async getApiConnection(host, _connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    let uri = await host.dialect.resolveNativeURISeed(host, settings);
    try {
      uri = (await host.dialect.readEngineSocket(host, settings)) || uri;
    } catch (error: any) {
      host.logger.error(host.id, "Unable to retrieve system info", error);
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
    return base; // machines:true stays (native)
  },
};

export const podmanVendorProfile: HostProfile = {
  HOST: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
  LABEL: "Podman Machine",
  async getApiConnection(host, _connection, customSettings) {
    let relay = "";
    const settings = customSettings || (await host.getSettings());
    const scope = settings.controller?.scope;
    if (isEmpty(scope)) {
      host.logger.error(host.id, "Unable to get api connection - no machine");
      return { uri: "", relay: "" };
    }
    const uri = await host.transport.resolveScopeURI(host, settings);
    // A native Windows named pipe (newer Podman) is dialed directly — no relay/bridge. Reading the in-VM
    // engine socket for a relay is only for the bridged cases (WSL/LIMA/SSH), so skip it when we have a pipe.
    if (host.isScoped() && !isWindowsNamedPipe(uri)) {
      try {
        relay = (await host.dialect.readEngineSocket(host, settings)) || "";
      } catch (error: any) {
        host.logger.warn(host.id, "Unable to get system info", error);
      }
    }
    return { uri, relay };
  },
  async isEngineAvailable() {
    return availableAlways();
  },
  getAutomaticSettings(host, settings) {
    return defaultGetAutomaticSettings(host, settings);
  },
  adjustCapabilities(base) {
    return withControllerVersion(base, true); // machines:true stays (vendor)
  },
};

export const podmanWSLProfile: HostProfile = {
  HOST: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
  LABEL: "Podman WSL",
  async getApiConnection(host, _connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    const scope = settings.controller?.scope || "";
    if (!scope) {
      host.logger.error(host.id, "getApiConnection requires a scope");
      return { uri: "", relay: "" };
    }
    const uri = await host.transport.resolveScopeURI(host, settings);
    let relay = "";
    try {
      relay = (await host.dialect.readEngineSocket(host, settings)) || "";
    } catch (error: any) {
      host.logger.warn(host.id, "Unable to get system info", error);
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
    return withMachines(base, false);
  },
};

export const podmanLIMAProfile: HostProfile = {
  HOST: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
  LABEL: "Podman LIMA",
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
    return withMachines(base, false);
  },
};

export const podmanSSHProfile: HostProfile = {
  HOST: ContainerEngineHost.PODMAN_REMOTE,
  LABEL: "Podman SSH",
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
    return withMachines(base, false);
  },
};
