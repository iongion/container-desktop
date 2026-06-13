// runtimes/transports/shared.ts — helpers shared by the concrete transports.
//
// The "Current" connection object + the plain raw driver are byte-for-byte what the legacy
// getContainerApiClient() built; only SSH wraps it with the getSSHConnection establishment hook.

import type { AxiosInstance } from "axios";

import type { Connection, EngineConnectorSettings } from "@/env/Types";
import { createApplicationApiDriver } from "../../Api.clients";
import type { HostContext } from "../composition";

/** The "Current" connection the legacy getContainerApiClient built — preserved byte-for-byte. */
export function buildCurrentConnection(host: HostContext, settings: EngineConnectorSettings): Connection {
  return {
    name: "Current",
    label: "Current",
    settings,
    engine: host.ENGINE,
    host: host.HOST,
    id: host.id,
  };
}

/** Plain raw Axios driver (no SSH establishment hook) — used by every transport except SSH. */
export function createPlainApiDriver(host: HostContext, settings: EngineConnectorSettings): AxiosInstance {
  return createApplicationApiDriver(buildCurrentConnection(host, settings));
}
