import type { ConnectionRuntimeInfo } from "@/container-client/resourceSyncProtocol";
import { type Connection, type Connector, ContainerEngine, type EngineThemePreference } from "@/env/Types";

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

// Connections connectAll will actually bring up (mirrors engineDataService.connectAll's filter). Known
// before any connection completes, so it predicts the steady-state engine set without a connect-order race.
function autoConnectEngines(connections: Connection[]): string[] {
  return connections.filter((c) => !c.disabled && c.settings?.api?.autoStart).map((c) => c.engine);
}

export function resolveEngineTheme({
  preference,
  activeRuntime,
  connectors,
  connections = [],
}: {
  preference?: EngineThemePreference | string;
  activeRuntime: ConnectionRuntimeInfo[];
  connectors: Connector[];
  connections?: Connection[];
}): ResolvedEngineTheme {
  if (isResolvedEngineTheme(preference)) {
    return preference;
  }

  // While any connection is still idle/starting, the running set is only partial — resolving the theme from
  // it makes the look flicker (unified → docker → unified) as engines connect one at a time during boot.
  // Until detection settles, predict the steady state from every engine family in play: those already
  // running/pending PLUS the connections connectAll is bringing up (known up-front). Only collapse to a
  // single-engine look when that whole set is one family.
  const settling = activeRuntime.some((runtime) => runtime.phase === "starting" || runtime.phase === "idle");
  if (settling) {
    const inPlay = resolveSingleEngine([
      ...activeRuntime.filter((runtime) => runtime.phase !== "failed").map((runtime) => runtime.engine),
      ...autoConnectEngines(connections),
    ]);
    return inPlay ?? "unified";
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
