import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import { type Connector, ContainerEngine, type EngineThemePreference } from "@/env/Types";

export type ResolvedEngineTheme = "unified" | ContainerEngine.PODMAN | ContainerEngine.DOCKER;

const ENGINE_THEME_VALUES = new Set<string>(["unified", ContainerEngine.PODMAN, ContainerEngine.DOCKER]);

function isResolvedEngineTheme(value: string | undefined): value is ResolvedEngineTheme {
  return !!value && ENGINE_THEME_VALUES.has(value);
}

function resolveSingleEngine(engines: Iterable<string | undefined>): ResolvedEngineTheme | undefined {
  const detected = new Set<ResolvedEngineTheme>();
  for (const engine of engines) {
    if (engine === ContainerEngine.PODMAN || engine === ContainerEngine.DOCKER) {
      detected.add(engine);
    }
  }
  return detected.size === 1 ? Array.from(detected)[0] : undefined;
}

function connectorIsAvailable(connector: Connector): boolean {
  return (
    connector.availability?.api === true ||
    connector.availability?.program === true ||
    connector.availability?.host === true
  );
}

export function resolveEngineTheme({
  preference,
  activeRuntime,
  connectors,
}: {
  preference?: EngineThemePreference | string;
  activeRuntime: ConnectionRuntimeInfo[];
  connectors: Connector[];
}): ResolvedEngineTheme {
  if (isResolvedEngineTheme(preference)) {
    return preference;
  }

  const runningEngine = resolveSingleEngine(
    activeRuntime.filter((runtime) => runtime.running).map((runtime) => runtime.engine),
  );
  if (runningEngine) {
    return runningEngine;
  }

  const availableEngine = resolveSingleEngine(
    connectors.filter(connectorIsAvailable).map((connector) => connector.engine),
  );
  return availableEngine ?? "unified";
}
