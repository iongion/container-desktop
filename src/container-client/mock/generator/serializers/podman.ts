// LogicalDataset → raw Podman (libpod) API shapes (the pre-normalizer wire format libpod returns, so the
// real normalizers still run). Pure: no randomness here (it all happened in model.ts), so the same dataset
// always serializes identically.

import type { EngineFixtures } from "../../fixtures";
import type { LogicalContainer, LogicalDataset, LogicalImage, LogicalNetwork, LogicalPod } from "../model";
import {
  dockerImageName,
  fullImageRef,
  iso,
  numFromHex,
  serializeLogs,
  serializeMachines,
  serializeRegistriesMap,
  serializeSecrets,
  serializeSecurityReport,
  serializeStats,
} from "./common";

const VOLUME_ROOT = "/var/lib/containers/storage/volumes";

function macAddress(idHex: string): string {
  return `aa:bb:cc:${idHex.slice(0, 2)}:${idHex.slice(2, 4)}:${idHex.slice(4, 6)}`;
}

function ports(container: LogicalContainer): unknown[] {
  return container.ports.map((port) => ({
    host_ip: port.hostIp,
    container_port: port.containerPort,
    host_port: port.hostPort,
    protocol: port.protocol,
    range: 1,
  }));
}

function portBindings(container: LogicalContainer): Record<string, unknown> {
  const bindings: Record<string, unknown> = {};
  for (const port of container.ports) {
    bindings[`${port.containerPort}/${port.protocol}`] = [{ HostIp: port.hostIp, HostPort: `${port.hostPort}` }];
  }
  return bindings;
}

function listContainer(container: LogicalContainer): unknown {
  const ref = fullImageRef(container.image);
  return {
    Id: container.idHex,
    Names: [`/${container.name}`],
    Image: ref,
    ImageName: ref,
    ImageID: `sha256:${container.image.idHex}`,
    Command: container.image.cmd,
    Created: iso(container.createdAt),
    CreatedAt: iso(container.createdAt),
    State: container.state,
    Status: container.status,
    Pid: container.pid,
    Ports: ports(container),
    Labels: container.labels,
    Mounts: container.mounts.map((mount) => `${VOLUME_ROOT}/${mount.volumeName}/_data`),
    Networks: [container.network.name],
    Pod: "",
    PodName: "",
  };
}

function inspectContainer(container: LogicalContainer): unknown {
  const ref = fullImageRef(container.image);
  const running = container.state === "running" || container.state === "degraded";
  return {
    Id: container.idHex,
    Name: container.name,
    Names: [`/${container.name}`],
    Image: ref,
    ImageName: ref,
    ImageID: `sha256:${container.image.idHex}`,
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
      StartedAt: iso(container.startedAt),
      FinishedAt: container.finishedAt ? iso(container.finishedAt) : "0001-01-01T00:00:00Z",
      Healthcheck: { Status: container.healthy ? "healthy" : container.state === "degraded" ? "unhealthy" : "none" },
    },
    Status: container.status,
    Command: container.image.cmd,
    Ports: ports(container),
    Labels: container.labels,
    HostConfig: { PortBindings: portBindings(container) },
    Mounts: container.mounts.map((mount) => ({
      Type: "volume",
      Name: mount.volumeName,
      Source: `${VOLUME_ROOT}/${mount.volumeName}/_data`,
      Destination: mount.destination,
      Mode: "rw",
      RW: true,
    })),
    Networks: [container.network.name],
    NetworkSettings: {
      Networks: {
        [container.network.name]: {
          IPAddress: container.ipAddress,
          Gateway: container.network.gateway,
          MacAddress: macAddress(container.idHex),
        },
      },
    },
    Config: {
      Hostname: container.name,
      Env: container.image.env,
      Cmd: container.image.cmd,
      Image: ref,
      WorkingDir: "",
      Entrypoint: container.image.entrypoint ?? [],
    },
    Pod: "",
    PodName: "",
  };
}

function listImage(image: LogicalImage): unknown {
  const ref = fullImageRef(image);
  return {
    Id: `sha256:${image.idHex}`,
    ParentId: "",
    RepoTags: [ref],
    RepoDigests: [`${image.registry}/${image.repo}@sha256:${image.digestHex}`],
    Names: [ref],
    Created: Math.floor(image.createdAt.getTime() / 1000),
    CreatedAt: iso(image.createdAt),
    Size: image.sizeBytes,
    VirtualSize: image.sizeBytes,
    SharedSize: 0,
    Containers: image.containersUsing,
    Digest: `sha256:${image.digestHex}`,
    Labels: image.maintainer ? { maintainer: image.maintainer } : null,
  };
}

function inspectImage(image: LogicalImage): unknown {
  const ref = fullImageRef(image);
  return {
    Id: `sha256:${image.idHex}`,
    RepoTags: [ref],
    RepoDigests: [`${image.registry}/${image.repo}@sha256:${image.digestHex}`],
    Names: [ref],
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

function listNetwork(network: LogicalNetwork): unknown {
  return {
    name: network.name,
    id: network.idHex,
    driver: network.driver,
    network_interface: `podman${network.ifaceIndex}`,
    created: iso(network.createdAt),
    subnets: [
      {
        subnet: network.subnetCidr,
        gateway: network.gateway,
        lease_range: { start_ip: `${network.ipPrefix}.2`, end_ip: `${network.ipPrefix}.254` },
      },
    ],
    ipv6_enabled: false,
    internal: network.internal,
    dns_enabled: true,
    labels: network.labels,
    options: {},
    ipam_options: { driver: "host-local" },
  };
}

function listVolume(dataset: LogicalDataset): unknown[] {
  return dataset.volumes.map((volume) => ({
    Name: volume.name,
    Driver: volume.driver,
    Mountpoint: `${VOLUME_ROOT}/${volume.name}/_data`,
    CreatedAt: iso(volume.createdAt),
    Labels: volume.labels,
    Scope: "local",
    Options: {},
    Anonymous: false,
    GID: 0,
    UID: 0,
    Status: {},
  }));
}

function podProcesses(pod: LogicalPod): string[][] {
  if (pod.status === "Exited") {
    return [];
  }
  return pod.members
    .filter((member) => !member.isInfra && member.status === "running")
    .slice(0, 3)
    .map((member, index) => [
      "app",
      `${20 + index * 7}`,
      `${(numFromHex(member.idHex, 0, 90) / 10).toFixed(1)}`,
      `${(numFromHex(member.idHex, 0, 120, 4) / 10).toFixed(1)}`,
      `process ${member.name}`,
    ]);
}

function listPod(pod: LogicalPod): unknown {
  return {
    Id: pod.idHex,
    Name: pod.name,
    Status: pod.status,
    Created: iso(pod.createdAt),
    Labels: pod.labels,
    Networks: [pod.network.name],
    Cgroup: "machine.slice",
    InfraId: pod.infraIdHex,
    NameSpace: "",
    Pid: pod.status === "Exited" ? "0" : `${numFromHex(pod.idHex, 8000, 9500)}`,
    NumContainers: pod.members.length,
    Containers: pod.members.map((member) => ({ Id: member.idHex, Names: member.name, Status: member.status })),
    Processes: { Titles: ["USER", "PID", "%CPU", "%MEM", "COMMAND"], Processes: podProcesses(pod) },
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

export function serializePodman(dataset: LogicalDataset): EngineFixtures {
  const containerInspect: Record<string, unknown> = {};
  for (const container of dataset.containers) {
    containerInspect[container.idHex] = inspectContainer(container);
  }
  const imageInspect: Record<string, unknown> = {};
  for (const image of dataset.images) {
    imageInspect[`sha256:${image.idHex}`] = inspectImage(image);
  }

  const version = {
    APIVersion: "5.3.1",
    Version: "5.3.1",
    GoVersion: "go1.23.2",
    GitCommit: "",
    Built: 1730000000,
    BuiltTime: "2024-10-27T00:00:00Z",
    OsArch: "linux/amd64",
    Components: [{ Name: "Podman Engine", Version: "5.3.1", Details: { APIVersion: "5.3.1" } }],
  };

  return {
    info: {
      host: {
        os: "linux",
        kernel: "6.8.0-generic",
        hostname: "mock-podman",
        distribution: { distribution: "ubuntu", variant: "", version: "24.04" },
        remoteSocket: { exists: true, path: "/run/user/1000/podman/podman.sock" },
      },
      plugins: {
        log: ["journald", "none", "passthrough"],
        network: ["bridge", "macvlan", "ipvlan"],
        volume: ["local"],
      },
      registries: { search: dataset.registries.slice(0, 3).map((registry) => registry.name) },
      store: {
        containerStore: storeCounts(dataset),
        imageStore: { number: dataset.images.length },
        graphDriverName: "overlay",
        graphRoot: "/var/lib/containers/storage",
        configFile: "/etc/containers/storage.conf",
      },
      version,
    },
    version,
    containers: dataset.containers.map(listContainer),
    containerInspect,
    images: dataset.images.map(listImage),
    imageInspect,
    volumes: listVolume(dataset),
    networks: dataset.networks.map(listNetwork),
    pods: dataset.pods.map(listPod),
    secrets: serializeSecrets(dataset.secrets),
    machines: serializeMachines(dataset.machines),
    registries: serializeRegistriesMap(dataset),
    extras: {
      versionText: "podman version 5.3.1",
      logs: serializeLogs(),
      stats: serializeStats(dataset.containers),
      top: {
        Titles: ["USER", "PID", "%CPU", "%MEM", "COMMAND"],
        Processes: [
          ["root", "1", "0.0", "0.1", "/sbin/init"],
          ["app", "24", "1.4", "2.1", dataset.containers[0] ? dockerImageName(dataset.containers[0].image) : "app"],
        ],
      },
      securityReport: serializeSecurityReport(dataset),
    },
  };
}
