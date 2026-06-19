import { describe, expect, it } from "vitest";
import { getDefaultConnectors } from "@/container-client/connection";
import { createComposedHostClient, resolveHostClientRegistryEntry } from "@/container-client/runtimes/registry";
import { LIMATransport } from "@/container-client/runtimes/transports/lima";
import { NativeTransport } from "@/container-client/runtimes/transports/native";
import { PodmanMachineTransport } from "@/container-client/runtimes/transports/podman-machine";
import { SSHTransport } from "@/container-client/runtimes/transports/ssh";
import { WSLTransport } from "@/container-client/runtimes/transports/wsl";
import { ContainerEngine, ContainerEngineHost, OperatingSystem } from "@/env/Types";

type TransportCtor = new () => unknown;

interface MatrixRow {
  engine: ContainerEngine;
  host: ContainerEngineHost;
  program: string;
  controller: string;
  transport: TransportCtor;
  scoped: boolean;
  machines: boolean;
  osType: OperatingSystem;
}

const { Linux, Windows, MacOS } = OperatingSystem;

// The full §4 map: every (engine, host) → transport × program × controller, plus the two
// host-adjusted facts that bite in production — whether the transport is scoped (needs a
// controller/distro/instance) and whether `machines` is a real capability (Podman native/vendor only).
const MATRIX: MatrixRow[] = [
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_NATIVE,
    program: "podman",
    controller: "podman",
    transport: NativeTransport,
    scoped: false,
    machines: true,
    osType: Linux,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
    program: "podman",
    controller: "podman",
    transport: PodmanMachineTransport,
    scoped: true,
    machines: true,
    osType: Linux,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
    program: "podman",
    controller: "wsl",
    transport: WSLTransport,
    scoped: true,
    machines: false,
    osType: Windows,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
    program: "podman",
    controller: "limactl",
    transport: LIMATransport,
    scoped: true,
    machines: false,
    osType: MacOS,
  },
  {
    engine: ContainerEngine.PODMAN,
    host: ContainerEngineHost.PODMAN_REMOTE,
    program: "podman",
    controller: "ssh",
    transport: SSHTransport,
    scoped: true,
    machines: false,
    osType: Linux,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_NATIVE,
    program: "docker",
    controller: "docker",
    transport: NativeTransport,
    scoped: false,
    machines: false,
    osType: Linux,
  },
  // Docker Desktop is unscoped — it uses the Native transport, not a machine transport.
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR,
    program: "docker",
    controller: "docker",
    transport: NativeTransport,
    scoped: false,
    machines: false,
    osType: Linux,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
    program: "docker",
    controller: "wsl",
    transport: WSLTransport,
    scoped: true,
    machines: false,
    osType: Windows,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
    program: "docker",
    controller: "limactl",
    transport: LIMATransport,
    scoped: true,
    machines: false,
    osType: MacOS,
  },
  {
    engine: ContainerEngine.DOCKER,
    host: ContainerEngineHost.DOCKER_REMOTE,
    program: "docker",
    controller: "ssh",
    transport: SSHTransport,
    scoped: true,
    machines: false,
    osType: Linux,
  },
  {
    engine: ContainerEngine.APPLE,
    host: ContainerEngineHost.APPLE_NATIVE,
    program: "container",
    controller: "container",
    transport: NativeTransport,
    scoped: false,
    machines: false,
    osType: MacOS,
  },
  {
    engine: ContainerEngine.APPLE,
    host: ContainerEngineHost.APPLE_REMOTE,
    program: "container",
    controller: "ssh",
    transport: SSHTransport,
    scoped: true,
    machines: false,
    osType: MacOS,
  },
];

describe("host client registry — the engine × host matrix", () => {
  it("covers exactly the 12 known host types", () => {
    expect(MATRIX).toHaveLength(12);
    expect(new Set(MATRIX.map((r) => r.host)).size).toBe(12);
  });

  for (const row of MATRIX) {
    it(`${row.engine}/${row.host} → ${row.transport.name} (program=${row.program}, controller=${row.controller})`, async () => {
      const entry = resolveHostClientRegistryEntry(row.engine, row.host);
      expect(entry.PROGRAM).toBe(row.program);
      expect(entry.CONTROLLER).toBe(row.controller);
      expect(entry.createTransport()).toBeInstanceOf(row.transport);

      const connector = getDefaultConnectors(row.osType).find((c) => c.engine === row.engine && c.host === row.host);
      expect(connector).toBeDefined();

      const client = await createComposedHostClient(connector!, row.osType);
      expect(client.ENGINE).toBe(row.engine);
      expect(client.HOST).toBe(row.host);
      expect(client.isScoped()).toBe(row.scoped);
      // `machines` is real only on Podman native/vendor; no-op everywhere else.
      expect(client.capabilities.extensions.machines).toBe(row.machines);
    });
  }

  it("throws for an unregistered engine/host pair", () => {
    expect(() => resolveHostClientRegistryEntry(ContainerEngine.DOCKER, "docker.bogus" as ContainerEngineHost)).toThrow(
      /No host client registered/,
    );
  });

  it("Apple dialect has apiSurface docker", async () => {
    const entry = resolveHostClientRegistryEntry(ContainerEngine.APPLE, ContainerEngineHost.APPLE_NATIVE);
    expect(entry.dialect.apiSurface).toBe("docker");
  });

  it("Podman dialect has apiSurface libpod", async () => {
    const entry = resolveHostClientRegistryEntry(ContainerEngine.PODMAN, ContainerEngineHost.PODMAN_NATIVE);
    expect(entry.dialect.apiSurface).toBe("libpod");
  });

  it("Docker dialect has apiSurface docker", async () => {
    const entry = resolveHostClientRegistryEntry(ContainerEngine.DOCKER, ContainerEngineHost.DOCKER_NATIVE);
    expect(entry.dialect.apiSurface).toBe("docker");
  });
});
