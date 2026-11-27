// runtimes/profiles/container.ts — the 2 Apple per-(engine,host) profiles.
//
// Apple NATIVE: local macOS Apple-silicon, socktainer socket directly.
// Apple REMOTE: remote macOS Apple-silicon over SSH, forwarding the remote socktainer socket.
//
// Apple Container needs macOS 26: socktainer, its only API, runs on nothing older, and Apple no longer fixes macOS 15.
//
// socktainer presence/version/compat is owned by the dialect (`describeApiBridge` → availability.report.api),
// not these profiles — so detection here only finds the `container` engine binary + scope.

import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { OperatingSystem } from "@/container-client/types/os";
import { isEmpty } from "@/utils";
import { APPLE_PROGRAM } from "../../connection";
import type { HostContext, HostProfile } from "../composition";
import { isScopedMacOS, runScopedSocketCommand } from "../dialects/shared";
import { availableAlways, sshApiConnection, withMachines } from "./shared";

// macOS 26 "Tahoe" is Darwin 25.
const APPLE_MIN_DARWIN = 25;

// Per-host OS-availability gate (exported for testing)

export async function availableOnAppleContainer(host: HostContext): Promise<{ success: boolean; details: string }> {
  if (host.osType !== OperatingSystem.MacOS) {
    return { success: false, details: `Apple Container requires macOS (current: ${host.osType})` };
  }
  if (CURRENT_DARWIN_MAJOR != null && CURRENT_DARWIN_MAJOR < APPLE_MIN_DARWIN) {
    return { success: false, details: "Apple Container requires macOS 26 or later" };
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
      // Verify the remote is Apple-silicon macOS — clearer diagnostics than a bare "container not found".
      // Non-fatal: the program check still fails closed below.
      try {
        const isMac = await isScopedMacOS(host, settings);
        const archProbe = await runScopedSocketCommand(host, settings, "uname", ["-m"]);
        const arch = `${archProbe.stdout || ""}`.trim();
        if (!isMac || arch !== "arm64") {
          host.logger.warn(host.id, `Remote is not Apple silicon macOS (darwin=${isMac}, arch=${arch || "?"})`);
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
    return base;
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
  // A remote machine's shell would need its own SSH terminal; machines stay on the Mac they run on.
  adjustCapabilities(base) {
    return withMachines(base, false);
  },
};
