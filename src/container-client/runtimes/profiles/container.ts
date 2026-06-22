// runtimes/profiles/container.ts — the 2 Apple per-(engine,host) profiles.
//
// Apple NATIVE: local macOS Apple-silicon, socktainer socket directly.
// Apple REMOTE: remote macOS Apple-silicon over SSH, forwarding the remote socktainer socket.
//
// Networks are macOS-gated: full on macOS 26 (Darwin ≥ 25); off on macOS 15 (degraded — no
// `container network`). Native gates synchronously at construction from the LOCAL Darwin major; remote
// gates after the scoped `sw_vers` probe (the remote macOS version isn't known at construction).
//
// socktainer presence/version/compat is owned by the dialect (`describeApiBridge` → availability.report.api),
// not these profiles — so detection here only finds the `container` engine binary + scope.

import { ContainerEngineHost, type EngineConnectorSettings, OperatingSystem } from "@/env/Types";
import { isEmpty } from "@/utils";
import { APPLE_PROGRAM } from "../../connection";
import type { HostContext, HostProfile } from "../composition";
import { isScopedMacOS, runScopedSocketCommand } from "../dialects/shared";
import type { CapabilityDescriptor } from "../facade";
import { availableAlways, sshApiConnection, withNetworks } from "./shared";

// Per-host OS-availability gate (exported for testing)

export async function availableOnAppleContainer(host: HostContext): Promise<{ success: boolean; details: string }> {
  if (host.osType !== OperatingSystem.MacOS) {
    return { success: false, details: `Apple Container requires macOS (current: ${host.osType})` };
  }
  try {
    const arch = await Platform.getOsArch();
    if (arch !== "arm64") {
      return { success: false, details: `Apple Container requires Apple silicon (arm64), got ${arch}` };
    }
  } catch {
    return { success: false, details: "Apple Container requires Apple silicon (unable to detect architecture)" };
  }
  return { success: true, details: "Apple Container is available" };
}

// Networks capability gating by macOS version (Apple Container needs macOS 26 / Darwin ≥ 25)

const APPLE_NETWORKS_MIN_DARWIN = 25; // macOS 26 "Tahoe"; macOS 15 = Darwin 24 (degraded, no `container network`)
const APPLE_NETWORKS_MIN_MACOS = 26;

/** Pure gate (exported for testing): networks only on macOS ≥ 26. Off-platform / unknown major → keep on. */
export function appleNetworksEnabled(osType: OperatingSystem, darwinMajor: number | undefined): boolean {
  if (osType !== OperatingSystem.MacOS) {
    return true; // off-platform the engine is unavailable anyway — don't over-restrict the base
  }
  if (darwinMajor == null) {
    return true; // unknown version — don't disable on a guess
  }
  return darwinMajor >= APPLE_NETWORKS_MIN_DARWIN;
}

/** Returns a COPY of base with networks gated by the local macOS version (used by the native profile). */
export function gateNetworksForMacOS(
  base: CapabilityDescriptor,
  osType: OperatingSystem,
  darwinMajor: number | undefined,
): CapabilityDescriptor {
  return withNetworks(base, appleNetworksEnabled(osType, darwinMajor));
}

/** Maps a `sw_vers -productVersion` string ("26.0", "15.5", …) to its major; undefined if unparseable. */
export function parseMacOsProductMajor(productVersion: string): number | undefined {
  const major = Number.parseInt(`${productVersion}`.trim().split(".")[0], 10);
  return Number.isNaN(major) ? undefined : major;
}

// Native automatic-settings (detects the `container` engine binary; socktainer is the dialect's job)

async function appleNativeDetectSettings(
  host: HostContext,
  settings: EngineConnectorSettings,
): Promise<EngineConnectorSettings> {
  host.logger.debug(host.id, "Apple native settings — automatic detection");
  try {
    const containerProgram = await host.findHostProgram({ name: APPLE_PROGRAM, path: "" }, settings);
    settings.program = containerProgram;
    const api = await host.getApiConnection(undefined, settings);
    settings.api.connection.uri = api.uri;
    settings.api.connection.relay = api.relay;
  } catch (error: any) {
    host.logger.error(host.id, "Unable to get automatic settings for Apple native", error);
  }
  return settings;
}

// Remote automatic-settings (scoped: SSH controller + remote container + macOS/arch verification)

async function appleRemoteDetectSettings(
  host: HostContext,
  settings: EngineConnectorSettings,
): Promise<EngineConnectorSettings> {
  host.logger.debug(host.id, "Apple remote settings — automatic detection");
  try {
    // Controller (SSH) + scope
    const existingScope = settings.controller?.scope || "";
    const controllerProgram = await host.findHostProgram({ name: host.CONTROLLER, path: "" }, settings);
    settings.controller = controllerProgram;
    settings.controller.scope = existingScope;
    if (isEmpty(existingScope)) {
      const defaultScope = await host.getControllerDefaultScope(settings);
      if (defaultScope) {
        settings.controller.scope = defaultScope.Name;
      }
    }

    if (settings.controller?.scope) {
      // Verify the remote is Apple-silicon macOS — clearer diagnostics than a bare "container not found",
      // and the signal for gating remote networks. Non-fatal: the program check still fails closed below.
      try {
        const isMac = await isScopedMacOS(host, settings);
        const archProbe = await runScopedSocketCommand(host, settings, "uname", ["-m"]);
        const arch = `${archProbe.stdout || ""}`.trim();
        if (!isMac || arch !== "arm64") {
          host.logger.warn(host.id, `Remote is not Apple silicon macOS (darwin=${isMac}, arch=${arch || "?"})`);
        }
        const verProbe = await runScopedSocketCommand(host, settings, "sw_vers", ["-productVersion"]);
        const major = verProbe.success ? parseMacOsProductMajor(verProbe.stdout || "") : undefined;
        if (major != null) {
          // Mutating the per-host capabilities is safe: appleSSHProfile.adjustCapabilities returns a COPY
          // (never the shared dialect singleton), and connectOne snapshots capabilities AFTER this runs.
          host.capabilities.resources.networks = major >= APPLE_NETWORKS_MIN_MACOS;
        }
      } catch (error: any) {
        host.logger.warn(host.id, "Remote macOS/arch probe failed — continuing", error);
      }

      // Remote `container` engine binary
      try {
        const scopeProgram = await host.findScopeProgram({ name: APPLE_PROGRAM, path: "" }, settings);
        settings.program = scopeProgram;
      } catch (error: any) {
        host.logger.error(host.id, "Unable to detect remote container", error);
      }
    }

    const api = await host.getApiConnection(undefined, settings);
    settings.api.connection.uri = api.uri;
    settings.api.connection.relay = api.relay;
  } catch (error: any) {
    host.logger.error(host.id, "Unable to get automatic settings for Apple remote", error);
  }
  return settings;
}

// Profiles

export const appleNativeProfile: HostProfile = {
  HOST: ContainerEngineHost.APPLE_NATIVE,
  LABEL: "Container",
  async getApiConnection(host, _connection, customSettings) {
    const settings = customSettings || (await host.getSettings());
    const uri = await host.dialect.readEngineSocket(host, settings);
    return { uri, relay: "" };
  },
  async isEngineAvailable(host) {
    return await availableOnAppleContainer(host);
  },
  getAutomaticSettings(host, settings) {
    return appleNativeDetectSettings(host, settings);
  },
  adjustCapabilities(base) {
    // The local client IS the Mac for a native connection — gate networks synchronously by the local
    // Darwin major. Returns a COPY (via withNetworks), never the shared dialect singleton.
    return gateNetworksForMacOS(base, Platform.OPERATING_SYSTEM, CURRENT_DARWIN_MAJOR);
  },
};

export const appleSSHProfile: HostProfile = {
  HOST: ContainerEngineHost.APPLE_REMOTE,
  LABEL: "Container SSH",
  getApiConnection(host, _connection, customSettings) {
    return sshApiConnection(host, customSettings);
  },
  async isEngineAvailable() {
    return availableAlways();
  },
  getAutomaticSettings(host, settings) {
    return appleRemoteDetectSettings(host, settings);
  },
  adjustCapabilities(base) {
    // Remote macOS version is unknown at construction — start networks:true on a COPY (never the shared
    // singleton), then appleRemoteDetectSettings narrows it from the scoped `sw_vers` probe.
    return withNetworks(base, true);
  },
};
