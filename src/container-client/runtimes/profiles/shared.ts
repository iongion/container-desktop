// runtimes/profiles/shared.ts — helpers shared by the 10 thin per-(engine,host) profiles.
//
// The default automatic-settings detection is base.ts:204-249 verbatim; the OS-gates and the LIMA/SSH
// getApiConnection bodies are identical across engines (the engine-specific socket read is delegated to the
// dialect via host.dialect.readEngineSocket), so they live here once.

import type { ApiConnection, AvailabilityCheck, EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { isEmpty } from "@/utils";
import type { HostContext } from "../composition";
import type { CapabilityDescriptor } from "../facade";

// ── availability OS-gates (the leaves' isEngineAvailable bodies) ──

export function availableAlways(): AvailabilityCheck {
  return { success: true, details: "Engine is available" };
}

export function availableOn(host: HostContext, os: OperatingSystem): AvailabilityCheck {
  const result: AvailabilityCheck = { success: true, details: "Engine is available" };
  if (host.osType !== os) {
    result.success = false;
    result.details = `Engine is not available on ${host.osType}`;
  }
  return result;
}

export function availableUnless(host: HostContext, os: OperatingSystem): AvailabilityCheck {
  const result: AvailabilityCheck = { success: true, details: "Engine is available" };
  if (host.osType === os) {
    result.success = false;
    result.details = `Engine is not available on ${host.osType}`;
  }
  return result;
}

// ── capability host-adjustment (Finding B): machines is real only on Podman native/vendor ──

export function withMachines(base: CapabilityDescriptor, machines: boolean): CapabilityDescriptor {
  return { ...base, extensions: { ...base.extensions, machines } };
}

export function withControllerVersion(base: CapabilityDescriptor, controllerVersion: boolean): CapabilityDescriptor {
  return { ...base, extensions: { ...base.extensions, controllerVersion } };
}

/**
 * Returns a COPY of the descriptor with resources.networks overridden. Copy (not in-place) so the per-host
 * capability object never aliases the shared dialect singleton — callers may later mutate it per connection.
 */
export function withNetworks(base: CapabilityDescriptor, networks: boolean): CapabilityDescriptor {
  return { ...base, resources: { ...base.resources, networks } };
}

// ── shared getApiConnection bodies (engine-agnostic; the socket read is the dialect's) ──

/** LIMA: the API socket is ~/.lima/<scope>/sock/<scope>.sock (podman-lima + docker-lima are identical). */
export async function limaApiConnection(
  host: HostContext,
  customSettings?: EngineConnectorSettings,
): Promise<ApiConnection> {
  const settings = customSettings || (await host.getSettings());
  const scope = settings.controller?.scope;
  if (!scope) {
    host.logger.error(host.id, "getApiConnection requires a scope");
    return { uri: "", relay: "" };
  }
  const uri = await host.transport.resolveScopeURI(host, settings);
  return { uri, relay: "" };
}

/** SSH: uri is the windows-pipe (or the settings fallback); relay is the engine socket read over the link. */
export async function sshApiConnection(
  host: HostContext,
  customSettings?: EngineConnectorSettings,
): Promise<ApiConnection> {
  const settings = customSettings || (await host.getSettings());
  const uri = await host.transport.resolveScopeURI(host, settings);
  let relay = "";
  const scope = settings.controller?.scope || "";
  if (!scope) {
    host.logger.error(host.id, "getApiConnection requires a scope");
    return {
      uri: uri || settings?.api?.connection?.uri || "",
      relay: relay || settings?.api?.connection?.relay || "",
    };
  }
  try {
    relay = (await host.dialect.readEngineSocket(host, settings)) || "";
  } catch (error: any) {
    host.logger.warn(host.id, "Unable to get system info", error);
  }
  return {
    uri: uri || settings?.api?.connection?.uri || "",
    relay: relay || settings?.api?.connection?.relay || "",
  };
}

// ── default automatic-settings detection (base.ts:204-249) ──

export async function defaultGetAutomaticSettings(
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
      if (isEmpty(existingScope)) {
        const defaultScope = await host.getControllerDefaultScope(settings);
        host.logger.debug(host.id, "Default scope is", defaultScope);
        if (defaultScope) {
          settings.controller.scope = defaultScope.Name;
          if (defaultScope.Usable) {
            const scopeProgram = await host.findScopeProgram({ name: host.PROGRAM, path: "" }, settings);
            settings.program = scopeProgram;
          } else {
            host.logger.warn(host.id, "Default scope is not usable - program will not be detected");
          }
        } else {
          host.logger.error(host.id, "No default scope found - program will not be detected");
        }
      } else {
        try {
          const scopeProgram = await host.findScopeProgram({ name: host.PROGRAM, path: "" }, settings);
          settings.program = scopeProgram;
        } catch (error: any) {
          host.logger.error(host.id, "Unable to get scope program", error);
        }
      }
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
