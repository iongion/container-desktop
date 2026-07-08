import {
  connectionEngineGroupKey,
  connectionEngineGroupName,
  findConnectionConnector,
  resolveConnectionVersion,
} from "@/container-client/connection-display";
import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import type { Connection, Connector } from "@/env/Types";

export interface EngineInventoryEntry {
  id: string;
  connectionName: string;
  engine: string;
  phase: ConnectionRuntimeInfo["phase"];
  running: boolean;
  version?: string;
  error?: string;
}

export interface EngineInventoryGroup {
  id: string;
  name: string;
  engines: EngineInventoryEntry[];
}

export interface EngineInventory {
  groups: EngineInventoryGroup[];
  engineCount: number;
  runningCount: number;
}

export function buildEngineInventory(
  connections: Connection[],
  connectors: Connector[],
  activeRuntime: ConnectionRuntimeInfo[],
): EngineInventory {
  const runtimeById = new Map(activeRuntime.map((info) => [info.id, info]));
  const groups: EngineInventoryGroup[] = [];
  const groupById = new Map<string, EngineInventoryGroup>();

  for (const connection of connections) {
    const runtime = runtimeById.get(connection.id);
    const connector = findConnectionConnector(connection, connectors);
    const groupName = connectionEngineGroupName(connection);
    const id = connectionEngineGroupKey(connection, groupName);
    let group = groupById.get(id);
    if (!group) {
      group = { id, name: groupName, engines: [] };
      groupById.set(id, group);
      groups.push(group);
    }
    group.engines.push({
      id: connection.id,
      connectionName: connection.name,
      engine: runtime?.engine ?? connection.engine,
      phase: runtime?.phase ?? "idle",
      running: !!runtime?.running,
      version: resolveConnectionVersion(connection, {
        connector,
        capabilities: runtime?.capabilities,
        runtimeVersion: runtime?.version,
      }),
      error: runtime?.error,
    });
  }

  const engines = groups.flatMap((group) => group.engines);
  return {
    groups,
    engineCount: engines.length,
    runningCount: engines.filter((engine) => engine.running).length,
  };
}

export function engineInventoryTriggerLabel(inventory: EngineInventory, fallback: string): string {
  const system = inventory.groups.find((item) => item.id === "system-default" || item.name.toLowerCase() === "system");
  const systemLabels =
    system?.engines
      .filter((engine) => engine.running)
      .map((engine) => (engine.version ? `${engine.engine} ${engine.version}` : engine.engine)) ?? [];
  if (systemLabels.length > 0) {
    return systemLabels.join(" / ");
  }

  const labels = new Set<string>();
  for (const group of inventory.groups) {
    if (group === system) {
      continue;
    }
    for (const engine of group.engines) {
      if (engine.running) {
        // Show the detected version (like the system branch + the popover) rather than a bare engine name,
        // so a remote engine (e.g. Windows Docker over SSH) surfaces its version in the footer too.
        labels.add(engine.version ? `${engine.engine} ${engine.version}` : engine.engine);
      }
    }
  }
  return labels.size > 0 ? [...labels].join(" / ") : fallback;
}
