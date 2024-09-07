import { v4 } from "uuid";

import { Connector, ContainerEngine, ContainerRuntime, ContainerRuntimeOption, EngineConnectorSettings, OperatingSystem, Presence } from "@/env/Types";
import { deepMerge } from "@/utils";

// Podman - common
export const PODMAN_PROGRAM = "podman";
export const DOCKER_PROGRAM = "docker";

// WSL - common
export const WSL_PROGRAM = "wsl";
export const WSL_VERSION = "2"; // The cli does not report a version

// LIMA - common
export const LIMA_PROGRAM = "limactl";
export const LIMA_VERSION = "current";

// Remote - common
export const SSH_PROGRAM = "ssh";
export const SSH_VERSION = "current";

// Defaults
export const DEFAULT_CONTAINER_RUNTIME = ContainerRuntime.PODMAN;

export const ContainerRuntimeOptions: ContainerRuntimeOption[] = [
  { runtime: ContainerRuntime.PODMAN, label: "Podman", present: Presence.UNKNOWN },
  { runtime: ContainerRuntime.DOCKER, label: "Docker", present: Presence.UNKNOWN }
];

export const createConnectorId = (instance: string, engine: ContainerEngine) => `engine.${instance}.${engine}`;

export function createConnectorSettings({
  osType,
  engine,
  programName,
  controllerName,
  overrides
}: {
  osType: OperatingSystem;
  engine: ContainerEngine;
  programName: string;
  controllerName?: string;
  overrides?: Partial<EngineConnectorSettings>;
}) {
  const settings: EngineConnectorSettings = {
    api: {
      baseURL: "",
      connection: {
        uri: "",
        relay: ""
      }
    },
    program: {
      name: programName,
      path: "",
      version: ""
    },
    rootfull: false,
    mode: "mode.automatic"
  };
  if (programName.startsWith(PODMAN_PROGRAM)) {
    settings.api.baseURL = "http://d";
  } else if (programName.startsWith(DOCKER_PROGRAM)) {
    settings.api.baseURL = "http://localhost";
  }
  if (controllerName) {
    settings.controller = {
      name: controllerName,
      path: "",
      version: "",
      scope: ""
    };
    if (overrides?.controller) {
      settings.controller.name = overrides.controller.name || settings.controller.name;
      settings.controller.path = overrides.controller.path || settings.controller.path;
      settings.controller.version = overrides.controller.version || settings.controller.version;
      settings.controller.scope = overrides.controller.scope || settings.controller.scope;
    }
    settings.controller = {
      name: controllerName,
      path: "",
      version: "",
      scope: ""
    };
  }
  return settings;
}

export function getDefaultConnectors(osType: OperatingSystem) {
  const connectors: Connector[] = [
    // Podman
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.PODMAN,
      engine: ContainerEngine.PODMAN_NATIVE,
      id: createConnectorId("default", ContainerEngine.PODMAN_NATIVE),
      label: "Native executable",
      description: "",
      notes: "Podman native is only available on Linux",
      availability: {
        enabled: osType === OperatingSystem.Linux,
        api: false,
        engine: false,
        program: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked"
        }
      },
      settings: createConnectorSettings({ osType, engine: ContainerEngine.PODMAN_NATIVE, programName: PODMAN_PROGRAM })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.PODMAN,
      engine: ContainerEngine.PODMAN_VIRTUALIZED_VENDOR,
      id: createConnectorId("default", ContainerEngine.PODMAN_VIRTUALIZED_VENDOR),
      label: "Podman machine virtualization",
      description: "From vendor",
      availability: {
        enabled: true,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.PODMAN_VIRTUALIZED_VENDOR,
        programName: PODMAN_PROGRAM,
        controllerName: PODMAN_PROGRAM,
        overrides: {
          controller: { name: PODMAN_PROGRAM, path: "", version: "" }
        }
      })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.PODMAN,
      engine: ContainerEngine.PODMAN_VIRTUALIZED_WSL,
      id: createConnectorId("default", ContainerEngine.PODMAN_VIRTUALIZED_WSL),
      label: "Custom WSL distribution",
      description: "",
      notes: "Podman from WSL is only available on Windows",
      availability: {
        enabled: osType === OperatingSystem.Windows,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.PODMAN_VIRTUALIZED_WSL,
        programName: PODMAN_PROGRAM,
        controllerName: WSL_PROGRAM,
        overrides: {
          controller: { name: WSL_PROGRAM, path: "", version: WSL_VERSION }
        }
      })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.PODMAN,
      engine: ContainerEngine.PODMAN_VIRTUALIZED_LIMA,
      id: createConnectorId("default", ContainerEngine.PODMAN_VIRTUALIZED_LIMA),
      label: "Custom LIMA instance",
      description: "",
      notes: "Podman from LIMA is only available on MacOS",
      availability: {
        enabled: osType === OperatingSystem.MacOS,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.PODMAN_VIRTUALIZED_LIMA,
        programName: PODMAN_PROGRAM,
        controllerName: LIMA_PROGRAM,
        overrides: {
          controller: { name: LIMA_PROGRAM, path: "", version: LIMA_VERSION }
        }
      })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.PODMAN,
      engine: ContainerEngine.PODMAN_REMOTE,
      id: createConnectorId("default", ContainerEngine.PODMAN_REMOTE),
      label: "Remote SSH connection",
      description: "",
      notes: "Remote SSH connection is not yet available",
      availability: {
        enabled: true,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.PODMAN_REMOTE,
        programName: PODMAN_PROGRAM,
        controllerName: SSH_PROGRAM,
        overrides: {
          controller: { name: SSH_PROGRAM, path: "", version: SSH_VERSION }
        }
      })
    },
    // Docker
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.DOCKER,
      engine: ContainerEngine.DOCKER_NATIVE,
      id: createConnectorId("default", ContainerEngine.DOCKER_NATIVE),
      label: "Native",
      description: "Docker native",
      notes: "Docker native is only available on Linux",
      availability: {
        enabled: osType === OperatingSystem.Linux,
        api: false,
        engine: false,
        program: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked"
        }
      },
      settings: createConnectorSettings({ osType, engine: ContainerEngine.DOCKER_NATIVE, programName: DOCKER_PROGRAM })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.DOCKER,
      engine: ContainerEngine.DOCKER_VIRTUALIZED_VENDOR,
      id: createConnectorId("default", ContainerEngine.DOCKER_VIRTUALIZED_VENDOR),
      label: "Docker desktop virtualization",
      description: "From vendor",
      availability: {
        enabled: true,
        api: false,
        engine: false,
        program: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked"
        }
      },
      settings: createConnectorSettings({ osType, engine: ContainerEngine.DOCKER_VIRTUALIZED_VENDOR, programName: DOCKER_PROGRAM })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.DOCKER,
      engine: ContainerEngine.DOCKER_VIRTUALIZED_WSL,
      id: createConnectorId("default", ContainerEngine.DOCKER_VIRTUALIZED_WSL),
      label: "Custom WSL distribution",
      description: "",
      notes: "Docker from WSL is only available on Windows",
      availability: {
        enabled: osType === OperatingSystem.Windows,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.DOCKER_VIRTUALIZED_WSL,
        programName: DOCKER_PROGRAM,
        controllerName: WSL_PROGRAM,
        overrides: {
          controller: { name: WSL_PROGRAM, path: "", version: WSL_VERSION }
        }
      })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.DOCKER,
      engine: ContainerEngine.DOCKER_VIRTUALIZED_LIMA,
      id: createConnectorId("default", ContainerEngine.DOCKER_VIRTUALIZED_LIMA),
      label: "Custom LIMA instance",
      description: "",
      notes: "Docker from LIMA is only available on MacOS",
      availability: {
        enabled: osType === OperatingSystem.MacOS,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.DOCKER_VIRTUALIZED_LIMA,
        programName: DOCKER_PROGRAM,
        controllerName: LIMA_PROGRAM,
        overrides: {
          controller: { name: LIMA_PROGRAM, path: "", version: LIMA_VERSION }
        }
      })
    },
    {
      name: "",
      connectionId: "",
      runtime: ContainerRuntime.DOCKER,
      engine: ContainerEngine.DOCKER_REMOTE,
      id: createConnectorId("default", ContainerEngine.DOCKER_REMOTE),
      label: "Remote SSH connection",
      description: "",
      notes: "Remote SSH connection is not yet available",
      availability: {
        enabled: true,
        api: false,
        engine: false,
        program: false,
        controller: false,
        report: {
          engine: "Not checked",
          program: "Not checked",
          api: "Not checked",
          controller: "Not checked"
        }
      },
      settings: createConnectorSettings({
        osType,
        engine: ContainerEngine.DOCKER_REMOTE,
        programName: DOCKER_PROGRAM,
        controllerName: SSH_PROGRAM,
        overrides: {
          controller: { name: SSH_PROGRAM, path: "", version: SSH_VERSION }
        }
      })
    }
  ];
  // console.debug(">> connectors", { osType }, connectors);
  return connectors;
}

export function createConnectorBy(osType: OperatingSystem, runtime: ContainerRuntime = DEFAULT_CONTAINER_RUNTIME, engine?: ContainerEngine) {
  const canUseNativeEngine = osType === OperatingSystem.Linux;
  let currentEngine: ContainerEngine = engine!;
  if (currentEngine) {
    console.debug("Using custom engine", { engine });
  } else {
    if (runtime === ContainerRuntime.PODMAN) {
      currentEngine = canUseNativeEngine ? ContainerEngine.PODMAN_NATIVE : ContainerEngine.PODMAN_VIRTUALIZED_VENDOR;
    } else if (runtime === ContainerRuntime.DOCKER) {
      currentEngine = canUseNativeEngine ? ContainerEngine.DOCKER_NATIVE : ContainerEngine.DOCKER_VIRTUALIZED_VENDOR;
    }
  }
  const connectors = getDefaultConnectors(osType);
  const connector = connectors.find((it) => it.runtime === runtime && it.engine === currentEngine)!;
  const copyOf = deepMerge<Connector>({}, { ...connector });
  copyOf.id = `engine.${v4()}.${connector.engine}`;
  // console.debug("Create connector by", { osType, runtime, engine: currentEngine, canUseNativeEngine });
  return copyOf;
}
