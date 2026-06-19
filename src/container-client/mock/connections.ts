// Synthetic connections injected when mock mode is on (see ./mode). They look like ordinary user-visible
// connections so screenshots and UI tests exercise the real connection manager, but availability is forced
// ready (mockAvailability) and every API/CLI call is answered from fixtures by MockCommand.

import {
  type Connection,
  ContainerEngine,
  ContainerEngineHost,
  type Controller,
  type EngineConnectorAvailability,
  type EngineConnectorSettings,
} from "@/env/Types";
import { getMockEngines } from "./mode";

export const MOCK_PODMAN_SYSTEM_ID = "mock.podman.system";
export const MOCK_DOCKER_SYSTEM_ID = "mock.docker.system";
export const MOCK_CONTAINER_SYSTEM_ID = "mock.container.system";

const MOCK_PODMAN_VERSION = "5.3.1";
const MOCK_DOCKER_VERSION = "27.3.1";
const MOCK_APPLE_VERSION = "1.0.0";

/** Forced-ready availability — bypasses program/socket detection (which would fail with no real engine). */
export function mockAvailability(): EngineConnectorAvailability {
  return {
    enabled: true,
    host: true,
    api: true,
    program: true,
    controller: true,
    report: {
      host: "Mock host",
      api: "Mock API",
      program: "Mock program",
      controller: "Mock controller",
    },
  };
}

interface MockConnectionOptions {
  id: string;
  name: string;
  label: string;
  description?: string;
  engine: ContainerEngine;
  host: ContainerEngineHost;
  uri: string;
  autoStart: boolean;
  controller?: Controller;
}

function mockSettings(
  engine: ContainerEngine,
  uri: string,
  autoStart: boolean,
  controller?: Controller,
): EngineConnectorSettings {
  const isPodman = engine === ContainerEngine.PODMAN;
  const isApple = engine === ContainerEngine.APPLE;
  const programName = isPodman ? "podman" : isApple ? "container" : "docker";
  return {
    api: {
      baseURL: isPodman ? "http://d" : "http://localhost",
      connection: { uri, relay: "" },
      autoStart,
    },
    program: {
      name: programName,
      path: isApple ? "/usr/local/bin/container" : `/usr/bin/${programName}`,
      version: isPodman ? MOCK_PODMAN_VERSION : isApple ? MOCK_APPLE_VERSION : MOCK_DOCKER_VERSION,
    },
    controller,
    rootfull: false,
    mode: "mode.automatic",
  };
}

function controller(name: string, scope: string, version = "current"): Controller {
  return {
    name,
    path: `/usr/bin/${name}`,
    version,
    scope,
  };
}

function mockConnection(opts: MockConnectionOptions): Connection {
  return {
    id: opts.id,
    name: opts.name,
    label: opts.label,
    description: opts.description,
    engine: opts.engine,
    host: opts.host,
    readonly: true,
    settings: mockSettings(opts.engine, opts.uri, opts.autoStart, opts.controller),
  };
}

/** The connection list surfaced everywhere in mock mode (boot, Connection Manager, tray). */
export function buildMockConnections(): Connection[] {
  // Only the system connection(s) for the active mock engine(s) auto-start, so the app lands in the
  // single-engine workspace for "podman"/"docker" and the merged/unified one for "unified" (see
  // ./mode getMockEngines). The remote SSH/WSL/LIMA samples stay manual — they exist to populate the
  // Connection Manager, not to connect at boot.
  const engines = getMockEngines();
  return [
    mockConnection({
      id: MOCK_PODMAN_SYSTEM_ID,
      name: "System Podman",
      label: "Podman machine virtualization",
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
      uri: "",
      autoStart: engines.includes(ContainerEngine.PODMAN),
      controller: controller("podman", "podman-machine-default", MOCK_PODMAN_VERSION),
    }),
    mockConnection({
      id: MOCK_DOCKER_SYSTEM_ID,
      name: "System Docker",
      label: "Docker virtualization",
      engine: ContainerEngine.DOCKER,
      host: ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
      uri: "",
      autoStart: engines.includes(ContainerEngine.DOCKER),
    }),
    mockConnection({
      id: "mock.podman.ssh",
      name: "Podman SSH remote",
      label: "Remote SSH connection",
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_REMOTE,
      uri: "ssh://demo@podman.example.test/run/user/1000/podman/podman.sock",
      autoStart: false,
      controller: controller("ssh", "podman-demo"),
    }),
    mockConnection({
      id: "mock.docker.ssh",
      name: "Docker SSH remote",
      label: "Remote SSH connection",
      engine: ContainerEngine.DOCKER,
      host: ContainerEngineHost.DOCKER_REMOTE,
      uri: "ssh://demo@docker.example.test/var/run/docker.sock",
      autoStart: false,
      controller: controller("ssh", "docker-demo"),
    }),
    mockConnection({
      id: "mock.podman.wsl",
      name: "Podman WSL Ubuntu-24.04",
      label: "Custom WSL distribution",
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
      uri: "unix:///mnt/wsl/Ubuntu-24.04/run/user/1000/podman/podman.sock",
      autoStart: false,
      controller: controller("wsl", "Ubuntu-24.04", "2"),
    }),
    mockConnection({
      id: "mock.docker.wsl",
      name: "Docker WSL Ubuntu-24.04",
      label: "Custom WSL distribution",
      engine: ContainerEngine.DOCKER,
      host: ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
      uri: "unix:///mnt/wsl/Ubuntu-24.04/var/run/docker.sock",
      autoStart: false,
      controller: controller("wsl", "Ubuntu-24.04", "2"),
    }),
    mockConnection({
      id: "mock.podman.lima",
      name: "Podman LIMA",
      label: "Custom LIMA instance",
      engine: ContainerEngine.PODMAN,
      host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
      uri: "unix:///Users/demo/.lima/podman/sock/podman.sock",
      autoStart: false,
      controller: controller("limactl", "podman-lima"),
    }),
    mockConnection({
      id: "mock.docker.lima",
      name: "Docker LIMA",
      label: "Custom LIMA instance",
      engine: ContainerEngine.DOCKER,
      host: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
      uri: "unix:///Users/demo/.lima/docker/sock/docker.sock",
      autoStart: false,
      controller: controller("limactl", "docker-lima"),
    }),
    // Container mock connections
    mockConnection({
      id: MOCK_CONTAINER_SYSTEM_ID,
      name: "System Container",
      label: "Container", // Apple Container
      engine: ContainerEngine.APPLE,
      host: ContainerEngineHost.APPLE_NATIVE,
      uri: "/Users/demo/.socktainer/container.sock",
      autoStart: engines.includes(ContainerEngine.APPLE),
    }),
    mockConnection({
      id: "mock.container.ssh",
      name: "Container SSH remote",
      label: "Remote SSH connection",
      engine: ContainerEngine.APPLE,
      host: ContainerEngineHost.APPLE_REMOTE,
      uri: "ssh://demo@container.example.test/Users/demo/.socktainer/container.sock",
      autoStart: false,
      controller: controller("ssh", "container-demo"),
    }),
  ];
}
