// LogicalDataset → raw Docker API shapes (the pre-normalizer wire format the Docker API returns). Also used
// for Apple's `container` runtime (same REST surface via socktainer) — only the host identity differs. Pure.

import { ContainerEngine } from "@/container-client/types/engine";

import type { EngineFixtures } from "../../fixtures";
import type { LogicalContainer, LogicalDataset, LogicalImage, LogicalNetwork } from "../model";
import {
  dockerImageName,
  dockerImageRef,
  iso,
  serializeLogs,
  serializeMachines,
  serializeRegistriesMap,
  serializeSecrets,
  serializeSecurityReport,
  serializeStats,
} from "./common";
import { serializeMounts } from "./mounts";

const VOLUME_ROOT = "/var/lib/docker/volumes";

function macAddress(idHex: string): string {
  return `02:42:ac:${idHex.slice(0, 2)}:${idHex.slice(2, 4)}:${idHex.slice(4, 6)}`;
}

function isUp(container: LogicalContainer): boolean {
  return container.state === "running" || container.state === "paused" || container.state === "degraded";
}

function ports(container: LogicalContainer): unknown[] {
  return container.ports.map((port) => ({
    IP: port.hostIp,
    PrivatePort: port.containerPort,
    PublicPort: port.hostPort,
    Type: port.protocol,
  }));
}

function portBindings(container: LogicalContainer): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (const port of container.ports) {
    bindings[`${port.containerPort}/${port.protocol}`] = [{ HostIp: port.hostIp, HostPort: `${port.hostPort}` }];
  }
  return bindings;
}

function networkEntry(container: LogicalContainer, withGateway: boolean): unknown {
  if (!isUp(container)) {
    return {};
  }
  return withGateway
    ? { IPAddress: container.ipAddress, Gateway: container.network.gateway, MacAddress: macAddress(container.idHex) }
    : { IPAddress: container.ipAddress };
}

function listContainer(container: LogicalContainer): unknown {
  return {
    Id: container.idHex,
    Names: [`/${container.name}`],
    Image: dockerImageRef(container.image),
    ImageID: `sha256:${container.image.idHex}`,
    Command: container.image.cmd.join(" "),
    Created: iso(container.createdAt),
    CreatedAt: iso(container.createdAt),
    State: container.state,
    Status: container.status,
    Pid: container.pid,
    Ports: ports(container),
    Labels: container.labels,
    Mounts: serializeMounts(container.mounts, VOLUME_ROOT),
    NetworkSettings: { Networks: { [container.network.name]: networkEntry(container, false) } },
  };
}

function inspectContainer(container: LogicalContainer): unknown {
  const ref = dockerImageRef(container.image);
  const running = container.state === "running" || container.state === "degraded";
  return {
    Id: container.idHex,
    Name: `/${container.name}`,
    Names: [`/${container.name}`],
    Image: `sha256:${container.image.idHex}`,
    ImageName: ref,
    ImageID: `sha256:${container.image.idHex}`,
    Command: container.image.cmd.join(" "),
    Created: iso(container.createdAt),
    CreatedAt: iso(container.createdAt),
    State: {
      Status: container.state,
      Running: running,
      Paused: container.state === "paused",
      Restarting: false,
      OOMKilled: false,
      Dead: container.state === "exited" && container.exitCode !== 0,
      Pid: container.pid,
      ExitCode: container.exitCode,
      Error: "",
      StartedAt: iso(container.startedAt),
      FinishedAt: container.finishedAt ? iso(container.finishedAt) : "0001-01-01T00:00:00Z",
      Healthcheck: {
        Status: container.healthy ? "healthy" : container.state === "degraded" ? "unhealthy" : "none",
        FailingStreak: 0,
        Log: [],
      },
    },
    Status: container.status,
    Path: container.image.cmd[0],
    Args: container.image.cmd.slice(1),
    Config: {
      Hostname: container.name,
      Env: container.image.env,
      Cmd: container.image.cmd,
      Image: ref,
      WorkingDir: "",
      Entrypoint: container.image.entrypoint ?? [],
      ExposedPorts: container.image.port ? { [`${container.image.port}/tcp`]: {} } : {},
      Labels: container.labels,
    },
    HostConfig: {
      NetworkMode: container.network.name,
      PortBindings: portBindings(container),
      Mounts: container.mounts.map((mount) => ({
        Type: mount.type,
        Source: mount.type === "bind" ? mount.source : mount.volumeName,
        Target: mount.destination,
        ReadOnly: !!mount.readOnly,
      })),
    },
    Mounts: serializeMounts(container.mounts, VOLUME_ROOT),
    Ports: ports(container),
    NetworkSettings: {
      Ports: portBindings(container),
      Networks: { [container.network.name]: networkEntry(container, true) },
    },
    Labels: container.labels,
  };
}

function listImage(image: LogicalImage): unknown {
  return {
    Id: `sha256:${image.idHex}`,
    ParentId: "",
    RepoTags: [dockerImageRef(image)],
    RepoDigests: [`${dockerImageName(image)}@sha256:${image.digestHex}`],
    Created: Math.floor(image.createdAt.getTime() / 1000),
    CreatedAt: iso(image.createdAt),
    Size: image.sizeBytes,
    VirtualSize: image.sizeBytes,
    SharedSize: -1,
    Containers: image.containersUsing,
    Labels: image.maintainer ? { maintainer: image.maintainer } : null,
  };
}

function inspectImage(image: LogicalImage): unknown {
  return {
    Id: `sha256:${image.idHex}`,
    RepoTags: [dockerImageRef(image)],
    RepoDigests: [`${dockerImageName(image)}@sha256:${image.digestHex}`],
    Created: iso(image.createdAt),
    Size: image.sizeBytes,
    VirtualSize: image.sizeBytes,
    Author: image.maintainer ?? "",
    Architecture: "amd64",
    Os: "linux",
    Labels: image.maintainer ? { maintainer: image.maintainer } : null,
    Config: {
      Env: image.env,
      Cmd: image.cmd,
      ExposedPorts: image.port ? { [`${image.port}/tcp`]: {} } : {},
      Entrypoint: image.entrypoint ?? [],
    },
  };
}

function dockerVolumes(dataset: LogicalDataset): { Volumes: unknown[]; Warnings: null } {
  return {
    Volumes: dataset.volumes.map((volume) => ({
      CreatedAt: iso(volume.createdAt),
      Driver: volume.driver,
      Labels: volume.labels,
      Mountpoint: `${VOLUME_ROOT}/${volume.name}/_data`,
      Name: volume.name,
      Options: {},
      Scope: "local",
      UsageData: { Size: volume.sizeBytes, RefCount: 1 },
    })),
    Warnings: null,
  };
}

function listNetwork(network: LogicalNetwork): unknown {
  return {
    Name: network.name,
    Id: network.idHex,
    Created: iso(network.createdAt),
    Scope: "local",
    Driver: network.driver,
    EnableIPv6: false,
    EnabledIPv6: false,
    IPAM: { Driver: "default", Options: null, Config: [{ Subnet: network.subnetCidr, Gateway: network.gateway }] },
    Internal: network.internal,
    Attachable: false,
    Ingress: false,
    ConfigFrom: { Network: "" },
    ConfigOnly: false,
    Containers: {},
    Options: {},
    Labels: network.labels,
  };
}

function storeCounts(dataset: LogicalDataset) {
  let running = 0;
  let paused = 0;
  let stopped = 0;
  for (const container of dataset.containers) {
    if (container.state === "running" || container.state === "degraded") running += 1;
    else if (container.state === "paused") paused += 1;
    else stopped += 1;
  }
  return { number: dataset.containers.length, paused, running, stopped };
}

export function serializeDocker(dataset: LogicalDataset): EngineFixtures {
  const apple = dataset.engine === ContainerEngine.APPLE;
  const containerInspect: Record<string, unknown> = {};
  for (const container of dataset.containers) {
    containerInspect[container.idHex] = inspectContainer(container);
  }
  const imageInspect: Record<string, unknown> = {};
  for (const image of dataset.images) {
    imageInspect[`sha256:${image.idHex}`] = inspectImage(image);
  }

  const version = {
    Version: "27.3.1",
    ApiVersion: "1.47",
    MinAPIVersion: "1.24",
    GitCommit: "41ca978",
    GoVersion: "go1.23.1",
    Os: "linux",
    Arch: "amd64",
    KernelVersion: "6.8.0-generic",
    BuildTime: "2024-10-27T00:00:00Z",
    Components: [
      {
        Name: "Engine",
        Version: "27.3.1",
        Details: { ApiVersion: "1.47", MinAPIVersion: "1.24", GitCommit: "41ca978" },
      },
    ],
  };

  return {
    info: {
      host: {
        os: "linux",
        kernel: "6.8.0-generic",
        hostname: apple ? "mock-container" : "mock-docker",
        distribution: { distribution: "ubuntu", variant: "", version: "24.04" },
        remoteSocket: { exists: true, path: apple ? "/var/run/container/container.sock" : "/var/run/docker.sock" },
      },
      plugins: {
        log: ["json-file", "local", "journald"],
        network: ["bridge", "host", "ipvlan", "macvlan", "null", "overlay"],
        volume: ["local"],
      },
      registries: { search: ["docker.io"] },
      store: {
        containerStore: storeCounts(dataset),
        imageStore: { number: dataset.images.length },
        graphDriverName: "overlay2",
        graphRoot: "/var/lib/docker",
        configFile: "/etc/docker/daemon.json",
      },
      version,
    },
    version,
    containers: dataset.containers.map(listContainer),
    containerInspect,
    images: dataset.images.map(listImage),
    imageInspect,
    volumes: dockerVolumes(dataset),
    networks: dataset.networks.map(listNetwork),
    pods: [],
    secrets: serializeSecrets(dataset.secrets),
    machines: serializeMachines(dataset.machines),
    registries: serializeRegistriesMap(dataset),
    extras: {
      versionText: "Docker version 27.3.1, build 41ca978",
      logs: serializeLogs(),
      stats: serializeStats(dataset.containers),
      top: {
        Titles: ["UID", "PID", "PPID", "C", "STIME", "TTY", "TIME", "CMD"],
        Processes: [
          [
            "root",
            "1",
            "0",
            "0",
            "09:15",
            "?",
            "00:00:00",
            dataset.containers[0] ? dockerImageName(dataset.containers[0].image) : "app",
          ],
          ["app", "21", "1", "0", "09:15", "?", "00:00:01", "worker"],
        ],
      },
      securityReport: serializeSecurityReport(dataset),
    },
  };
}
