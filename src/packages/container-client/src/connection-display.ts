import type { Connection, Connector, ConnectorCapabilities } from "@/container-client/types/connection";

export interface ConnectionVersionOptions {
  connector?: Connector;
  capabilities?: ConnectorCapabilities;
  runtimeVersion?: string;
}

export function visibleConnectionVersion(version?: string): string | undefined {
  const value = version?.trim();
  return value && value !== "current" ? value : undefined;
}

export function findConnectionConnector(connection: Connection, connectors: Connector[]): Connector | undefined {
  return connectors.find((item) => item.id === connection.id || item.connectionId === connection.id);
}

export function resolveConnectionVersion(
  connection: Connection,
  { connector, capabilities, runtimeVersion }: ConnectionVersionOptions = {},
): string | undefined {
  const usesControllerVersion =
    capabilities?.extensions?.controllerVersion ?? connector?.capabilities?.extensions?.controllerVersion ?? false;
  const candidates = usesControllerVersion
    ? [
        runtimeVersion,
        connector?.settings?.controller?.version,
        connection.settings?.controller?.version,
        connector?.settings?.program?.version,
        connection.settings?.program?.version,
      ]
    : [
        runtimeVersion,
        connector?.settings?.program?.version,
        connection.settings?.program?.version,
        connector?.settings?.controller?.version,
        connection.settings?.controller?.version,
      ];
  return candidates.map(visibleConnectionVersion).find(Boolean);
}

export function connectionEngineGroupName(connection: Connection): string {
  const escaped = connection.engine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutParen = connection.name.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "i"), "");
  const withoutTrailingWord = withoutParen.replace(new RegExp(`\\s+${escaped}\\s*$`, "i"), "");
  return withoutTrailingWord.trim() || connection.name;
}

export function connectionEngineGroupKey(
  connection: Connection,
  groupName = connectionEngineGroupName(connection),
): string {
  const suffix = `.${connection.engine}`;
  if (connection.id.endsWith(suffix)) {
    return connection.id.slice(0, -suffix.length);
  }
  if (groupName !== connection.name) {
    return `name:${groupName}`;
  }
  return connection.id;
}
