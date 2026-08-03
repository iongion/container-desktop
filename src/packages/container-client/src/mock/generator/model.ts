// The engine-agnostic logical dataset + its deterministic builder. All randomness lives HERE (in a fixed
// draw order), so the per-engine serializers (./serializers/*) are pure transforms. Cross-references are
// wired by holding object references (a container points at a real LogicalImage/LogicalNetwork), so the
// serialized output is internally consistent by construction: every container's image and network exist in
// the images/networks lists, and image "Containers" usage counts are truthful.

import type { Faker } from "@faker-js/faker";

import { ContainerEngine } from "@/container-client/types/engine";

import type { EngineCounts } from "./config";
import { REF_DATE } from "./config";
import {
  IMAGE_CATALOG,
  type ImageCatalogEntry,
  NETWORK_BASES,
  POD_BASES,
  PROJECT_TEMPLATES,
  REGISTRY_HOSTS,
  SECRET_STEMS,
  STANDALONE_APPS,
  VOLUME_STEMS,
} from "./pools";

export type ContainerStateValue = "created" | "running" | "paused" | "exited" | "stopped" | "degraded";
export type PodStatusValue = "Running" | "Paused" | "Exited" | "Degraded";

export interface LogicalImage {
  registry: string;
  repo: string;
  tag: string;
  idHex: string;
  digestHex: string;
  createdAt: Date;
  sizeBytes: number;
  exposesPort: boolean;
  port?: number;
  cmd: string[];
  entrypoint?: string[];
  env: string[];
  maintainer?: string;
  containersUsing: number;
}

export interface LogicalNetwork {
  name: string;
  idHex: string;
  driver: string;
  ifaceIndex: number;
  subnetCidr: string;
  gateway: string;
  ipPrefix: string;
  internal: boolean;
  createdAt: Date;
  labels: Record<string, string>;
  isDefault: boolean;
  nextHost: number;
}

export interface LogicalPort {
  containerPort: number;
  hostPort: number;
  hostIp: string;
  protocol: "tcp" | "udp";
}

export interface LogicalMount {
  type: "bind" | "volume";
  volumeName?: string;
  source?: string;
  destination: string;
  readOnly?: boolean;
}

export interface LogicalContainer {
  idHex: string;
  project: string;
  service: string;
  replica: number;
  name: string;
  image: LogicalImage;
  network: LogicalNetwork;
  ipAddress: string;
  state: ContainerStateValue;
  status: string;
  healthy: boolean;
  createdAt: Date;
  startedAt: Date;
  finishedAt?: Date;
  pid: number;
  exitCode: number;
  ports: LogicalPort[];
  mounts: LogicalMount[];
  labels: Record<string, string>;
}

export interface LogicalPodMember {
  idHex: string;
  name: string;
  status: "running" | "paused" | "exited";
  isInfra: boolean;
}

export interface LogicalPod {
  idHex: string;
  infraIdHex: string;
  name: string;
  status: PodStatusValue;
  createdAt: Date;
  labels: Record<string, string>;
  network: LogicalNetwork;
  members: LogicalPodMember[];
}

export interface LogicalVolume {
  name: string;
  driver: string;
  createdAt: Date;
  sizeBytes: number;
  labels: Record<string, string>;
}

export interface LogicalSecret {
  idHex: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogicalMachine {
  name: string;
  active: boolean;
  running: boolean;
  vmType: string;
  cpus: number;
  diskSize: number;
  memory: number;
  isDefault: boolean;
  createdAt: Date;
  lastUp: Date;
}

export interface LogicalRegistry {
  id: string;
  name: string;
  weight: number;
  enabled: boolean;
  isRemovable: boolean;
  isSystem: boolean;
  engines: ContainerEngine[];
  createdAt: Date;
}

export interface LogicalDataset {
  engine: ContainerEngine;
  images: LogicalImage[];
  networks: LogicalNetwork[];
  containers: LogicalContainer[];
  pods: LogicalPod[];
  volumes: LogicalVolume[];
  secrets: LogicalSecret[];
  machines: LogicalMachine[];
  registries: LogicalRegistry[];
}

const REF_MS = new Date(REF_DATE).getTime();

function hex(faker: Faker, length: number): string {
  return faker.string.hexadecimal({ length, casing: "lower", prefix: "" });
}

function composeLabelKeys(engine: ContainerEngine) {
  return engine === ContainerEngine.PODMAN
    ? { project: "io.podman.compose.project", service: "io.podman.compose.service" }
    : { project: "com.docker.compose.project", service: "com.docker.compose.service" };
}

function projectNetworkName(engine: ContainerEngine, base: string): string {
  return engine === ContainerEngine.PODMAN ? `${base}-net` : `${base}_default`;
}

function defaultNetworkName(engine: ContainerEngine): string {
  return engine === ContainerEngine.PODMAN ? "podman" : "bridge";
}

function humanDuration(hours: number): string {
  if (hours < 1) {
    return "a few minutes";
  }
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function findCatalog(repo: string): ImageCatalogEntry {
  return (
    IMAGE_CATALOG.find((entry) => entry.repo === repo) ??
    IMAGE_CATALOG.find((entry) => entry.repo === "library/busybox") ??
    IMAGE_CATALOG[0]
  );
}

// Build the full per-engine logical dataset. Deterministic for a given (faker seed, engine, counts).
export function generateLogicalDataset(faker: Faker, engine: ContainerEngine, counts: EngineCounts): LogicalDataset {
  const labelKeys = composeLabelKeys(engine);

  // Networks: default bridge, one per project template, then padding to the target
  const networks: LogicalNetwork[] = [];
  const projectNetwork = new Map<string, LogicalNetwork>();
  const usedNetworkNames = new Set<string>();

  const makeNetwork = (name: string, isDefault: boolean, project?: string): LogicalNetwork => {
    const index = networks.length;
    const podman = engine === ContainerEngine.PODMAN;
    let ipPrefix: string;
    let subnetCidr: string;
    if (podman) {
      ipPrefix = isDefault ? "10.88.0" : `10.${89 + index}.0`;
      subnetCidr = isDefault ? "10.88.0.0/16" : `10.${89 + index}.0.0/24`;
    } else {
      ipPrefix = isDefault ? "172.17.0" : `172.${17 + index}.0`;
      subnetCidr = isDefault ? "172.17.0.0/16" : `172.${17 + index}.0.0/16`;
    }
    const net: LogicalNetwork = {
      name,
      idHex: hex(faker, 64),
      driver: isDefault ? "bridge" : faker.helpers.arrayElement(["bridge", "bridge", "macvlan"]),
      ifaceIndex: index,
      subnetCidr,
      gateway: `${ipPrefix}.1`,
      ipPrefix,
      internal: !isDefault && faker.datatype.boolean({ probability: 0.1 }),
      createdAt: faker.date.recent({ days: 30 }),
      labels: project ? { [labelKeys.project]: project } : {},
      isDefault,
      nextHost: 2,
    };
    networks.push(net);
    usedNetworkNames.add(name);
    return net;
  };

  const defaultNet = makeNetwork(defaultNetworkName(engine), true);
  for (const template of PROJECT_TEMPLATES) {
    if (networks.length >= counts.networks) {
      break;
    }
    projectNetwork.set(template.name, makeNetwork(projectNetworkName(engine, template.name), false, template.name));
  }
  let networkPad = 0;
  while (networks.length < counts.networks) {
    const base = NETWORK_BASES[networkPad % NETWORK_BASES.length];
    const round = Math.floor(networkPad / NETWORK_BASES.length);
    const baseName = round === 0 ? base : `${base}${round + 1}`;
    networkPad += 1;
    const name = projectNetworkName(engine, baseName);
    if (usedNetworkNames.has(name)) {
      continue;
    }
    makeNetwork(name, false);
  }

  // Images: created lazily as services reference them, then padded to the target
  const imageByRef = new Map<string, LogicalImage>();
  const makeImage = (entry: ImageCatalogEntry, tag: string): LogicalImage => {
    const ref = `${entry.repo}:${tag}`;
    const existing = imageByRef.get(ref);
    if (existing) {
      return existing;
    }
    const image: LogicalImage = {
      registry: entry.registry,
      repo: entry.repo,
      tag,
      idHex: hex(faker, 64),
      digestHex: hex(faker, 64),
      createdAt: faker.date.recent({ days: 90 }),
      sizeBytes: faker.number.int({ min: entry.size[0], max: entry.size[1] }),
      exposesPort: entry.exposesPort,
      port: entry.port,
      cmd: entry.cmd,
      entrypoint: entry.entrypoint,
      env: entry.env,
      maintainer: entry.maintainer,
      containersUsing: 0,
    };
    imageByRef.set(ref, image);
    return image;
  };
  const imageForRepo = (repo: string): LogicalImage => {
    const entry = findCatalog(repo);
    const tag = faker.helpers.arrayElement(entry.tags);
    return makeImage(entry, tag);
  };

  // Containers: project services (with replicas) + standalone singletons, exactly counts.containers
  const containers: LogicalContainer[] = [];
  let hostPortSeq = 8080;

  const pickState = (): ContainerStateValue => {
    const roll = faker.number.int({ min: 1, max: 100 });
    if (roll <= 70) return "running";
    if (roll <= 82) return "exited";
    if (roll <= 90) return "paused";
    if (roll <= 94) return "created";
    if (roll <= 98) return "stopped";
    return "degraded";
  };

  const buildContainer = (
    name: string,
    project: string,
    service: string,
    replica: number,
    image: LogicalImage,
    network: LogicalNetwork,
    forcedState?: ContainerStateValue,
  ): LogicalContainer => {
    const state = forcedState ?? pickState();
    const isUp = state === "running" || state === "paused" || state === "degraded";
    const startedAt = faker.date.recent({ days: 14 });
    const createdAt = new Date(startedAt.getTime() - faker.number.int({ min: 1, max: 90 }) * 1000);
    const uptimeHours = Math.max(1, Math.floor((REF_MS - startedAt.getTime()) / 3_600_000));
    const exitCode = state === "exited" ? faker.helpers.arrayElement([0, 0, 0, 1, 137]) : 0;
    let finishedAt: Date | undefined;
    let agoHours = uptimeHours;
    if (state === "exited" || state === "stopped") {
      finishedAt = faker.date.between({ from: startedAt, to: REF_DATE });
      agoHours = Math.max(1, Math.floor((REF_MS - finishedAt.getTime()) / 3_600_000));
    }
    const healthy =
      state === "running" && image.exposesPort && (forcedState ? true : faker.datatype.boolean({ probability: 0.6 }));
    const status = statusText(
      state,
      state === "exited" || state === "stopped" ? agoHours : uptimeHours,
      exitCode,
      healthy,
    );

    const ports: LogicalPort[] = [];
    if (image.exposesPort && image.port && isUp) {
      // Always draw both values so the dataset stays byte-stable whether or not this service is pinned. A
      // pinned/showcase service then publishes on its canonical host:container port (e.g. Postgres 5432:5432);
      // generated services take the sequential host port so the stress dataset stays collision-free.
      const seqHostPort = hostPortSeq++;
      const randomHostIp = faker.helpers.arrayElement(["0.0.0.0", "127.0.0.1"]);
      ports.push({
        containerPort: image.port,
        hostPort: forcedState ? image.port : seqHostPort,
        hostIp: forcedState ? "0.0.0.0" : randomHostIp,
        protocol: "tcp",
      });
    }

    // idHex is drawn here (moved up from the literal below, ahead of the no-faker mount block, so the faker
    // draw ORDER is unchanged and the dataset stays byte-stable). Its first byte seeds a deterministic
    // per-container mount spread: most containers get 1-2, some 0, a few up to the realistic cap of 5 — a mix
    // of named volume, rw source bind and ro config/secret binds, like a real engine's list mounts.
    const idHex = hex(faker, 64);
    const mountSpread = Number.parseInt(idHex.slice(0, 2) || "0", 16);
    const isStateful = ["db", "cache", "redis", "warehouse", "queue"].includes(service);
    const mounts: LogicalMount[] = [];
    if (isStateful) {
      mounts.push({ type: "volume", volumeName: `${project}-${service}`, destination: mountDestination(image.repo) });
    } else if (mountSpread % 4 !== 0) {
      // app/service container: bind-mounts its source tree (rw) — the classic dev inner-loop mount.
      mounts.push({ type: "bind", source: `/home/dev/src/${project}/${service}`, destination: "/app" });
    }
    if (mountSpread % 3 === 0) {
      // a dependency volume kept off the host bind (e.g. node_modules).
      mounts.push({ type: "volume", volumeName: `${project}-${service}-deps`, destination: "/app/node_modules" });
    }
    if (mountSpread % 5 === 0) {
      // a read-only config bind.
      mounts.push({
        type: "bind",
        source: `/etc/${project}/${service}.conf`,
        destination: "/etc/app/config.conf",
        readOnly: true,
      });
    }
    if (mountSpread % 7 === 0) {
      // a read-only secrets / TLS bind.
      mounts.push({ type: "bind", source: `/etc/${project}/tls`, destination: "/run/secrets", readOnly: true });
    }
    if (mounts.length > 5) {
      mounts.length = 5;
    }

    const host = network.nextHost++;
    const container: LogicalContainer = {
      idHex,
      project,
      service,
      replica,
      name,
      image,
      network,
      ipAddress: `${network.ipPrefix}.${host}`,
      state,
      status,
      healthy,
      createdAt,
      startedAt,
      finishedAt,
      pid: isUp ? faker.number.int({ min: 1000, max: 40000 }) : 0,
      exitCode,
      ports,
      mounts,
      labels: { [labelKeys.project]: project, [labelKeys.service]: service },
    };
    image.containersUsing += 1;
    return container;
  };

  for (const template of PROJECT_TEMPLATES) {
    const network = projectNetwork.get(template.name) ?? defaultNet;
    for (const svc of template.services) {
      if (containers.length >= counts.containers) {
        break;
      }
      const image = imageForRepo(svc.repo);
      const replicas = svc.replicas ?? 1;
      for (let replica = 1; replica <= replicas; replica += 1) {
        if (containers.length >= counts.containers) {
          break;
        }
        const name = `${template.name}-${svc.service}-${replica}`;
        containers.push(buildContainer(name, template.name, svc.service, replica, image, network, svc.state));
      }
    }
  }
  // Standalone singletons (single-token names → their own one-item group) top up to the target.
  let standaloneIndex = 0;
  while (containers.length < counts.containers) {
    const app = STANDALONE_APPS[standaloneIndex % STANDALONE_APPS.length];
    const round = Math.floor(standaloneIndex / STANDALONE_APPS.length);
    const appName = round === 0 ? app.name : `${app.name}${round + 1}`;
    standaloneIndex += 1;
    const image = imageForRepo(app.repo);
    containers.push(buildContainer(`${appName}-1`, appName, "app", 1, image, defaultNet));
  }

  // Images list: the images actually used + padding (unused, Containers=0) to the target
  const images: LogicalImage[] = [...imageByRef.values()];
  let catalogPad = 0;
  while (images.length < counts.images && catalogPad < IMAGE_CATALOG.length * 6) {
    const entry = IMAGE_CATALOG[catalogPad % IMAGE_CATALOG.length];
    const tagRound = Math.floor(catalogPad / IMAGE_CATALOG.length);
    const tag = entry.tags[tagRound % entry.tags.length];
    catalogPad += 1;
    const ref = `${entry.repo}:${tag}`;
    if (imageByRef.has(ref)) {
      continue;
    }
    images.push(makeImage(entry, tag));
  }

  // Pods (Podman only): self-contained infra + member refs, status consistent with members
  const pods: LogicalPod[] = [];
  for (let podIndex = 0; podIndex < counts.pods; podIndex += 1) {
    const base = POD_BASES[podIndex % POD_BASES.length];
    const round = Math.floor(podIndex / POD_BASES.length);
    const baseName = round === 0 ? base : `${base}-${round + 1}`;
    pods.push(
      buildPod(
        faker,
        baseName,
        projectNetwork.get(PROJECT_TEMPLATES[podIndex % PROJECT_TEMPLATES.length].name) ?? defaultNet,
      ),
    );
  }

  // Volumes
  const volumes: LogicalVolume[] = [];
  const usedVolumeNames = new Set<string>();
  const mountedVolumeProjects = new Map<string, string>();
  for (const container of containers) {
    for (const mount of container.mounts) {
      if (mount.type === "volume" && mount.volumeName && !mountedVolumeProjects.has(mount.volumeName)) {
        mountedVolumeProjects.set(mount.volumeName, container.project);
      }
    }
  }

  const addVolume = (name: string, project: string): void => {
    if (usedVolumeNames.has(name)) {
      return;
    }
    usedVolumeNames.add(name);
    volumes.push({
      name,
      driver: "local",
      createdAt: faker.date.recent({ days: 21 }),
      sizeBytes: faker.number.int({ min: 1_000_000, max: 12_000_000_000 }),
      labels: { [labelKeys.project]: project },
    });
  };

  for (const [name, project] of mountedVolumeProjects) {
    addVolume(name, project);
  }

  let volumeIndex = 0;
  while (volumes.length < counts.volumes) {
    const stem = VOLUME_STEMS[volumeIndex % VOLUME_STEMS.length];
    const round = Math.floor(volumeIndex / VOLUME_STEMS.length);
    const project = PROJECT_TEMPLATES[volumeIndex % PROJECT_TEMPLATES.length].name;
    volumeIndex += 1;
    const name = round === 0 ? `${project}-${stem}` : `${project}-${stem}-${round + 1}`;
    addVolume(name, project);
  }

  // Secrets
  const secrets: LogicalSecret[] = [];
  const usedSecretNames = new Set<string>();
  let secretIndex = 0;
  while (secrets.length < counts.secrets) {
    const stem = SECRET_STEMS[secretIndex % SECRET_STEMS.length];
    const round = Math.floor(secretIndex / SECRET_STEMS.length);
    secretIndex += 1;
    const name = round === 0 ? stem : `${stem}_${round + 1}`;
    if (usedSecretNames.has(name)) {
      continue;
    }
    usedSecretNames.add(name);
    const createdAt = faker.date.recent({ days: 30 });
    secrets.push({ idHex: hex(faker, 24), name, createdAt, updatedAt: createdAt });
  }

  // Machines (Podman only)
  const machines: LogicalMachine[] = [];
  for (let machineIndex = 0; machineIndex < counts.machines; machineIndex += 1) {
    const isDefault = machineIndex === 0;
    const running = isDefault || faker.datatype.boolean({ probability: 0.55 });
    const createdAt = faker.date.recent({ days: 120 });
    machines.push({
      name: isDefault ? "podman-machine-default" : `podman-machine-${machineIndex}`,
      active: running && (isDefault || faker.datatype.boolean({ probability: 0.5 })),
      running,
      vmType: faker.helpers.arrayElement(["qemu", "applehv", "wsl", "krun"]),
      cpus: faker.helpers.arrayElement([2, 4, 4, 8]),
      diskSize: faker.helpers.arrayElement([53687091200, 107374182400, 214748364800]),
      memory: faker.helpers.arrayElement([2147483648, 4294967296, 8589934592]),
      isDefault,
      createdAt,
      lastUp: running ? faker.date.recent({ days: 2 }) : faker.date.recent({ days: 30 }),
    });
  }

  // Registries — the genuine well-known + private hosts (REGISTRY_HOSTS), each once. No synthetic
  // `foo-2.example.com` padding rounds: the mock shows only real registry names, capped at the host list.
  const registries: LogicalRegistry[] = [];
  const registryHostCount = Math.min(counts.registries, REGISTRY_HOSTS.length);
  for (let registryIndex = 0; registryIndex < registryHostCount; registryIndex += 1) {
    const name = REGISTRY_HOSTS[registryIndex];
    registries.push({
      id: name,
      name,
      weight: name === "docker.io" ? 1000 : registries.length * 10,
      enabled: faker.datatype.boolean({ probability: 0.85 }),
      isRemovable: true,
      isSystem: false,
      engines:
        engine === ContainerEngine.PODMAN ? [ContainerEngine.PODMAN] : [ContainerEngine.DOCKER, ContainerEngine.APPLE],
      createdAt: faker.date.recent({ days: 200 }),
    });
  }

  return { engine, images, networks, containers, pods, volumes, secrets, machines, registries };
}

function statusText(state: ContainerStateValue, hours: number, exitCode: number, healthy: boolean): string {
  switch (state) {
    case "running":
      return healthy ? `Up ${humanDuration(hours)} (healthy)` : `Up ${humanDuration(hours)}`;
    case "degraded":
      return `Up ${humanDuration(hours)} (unhealthy)`;
    case "paused":
      return "Paused";
    case "created":
      return "Created";
    case "exited":
      return `Exited (${exitCode}) ${humanDuration(hours)} ago`;
    case "stopped":
      return `Exited (0) ${humanDuration(hours)} ago`;
  }
}

function mountDestination(repo: string): string {
  if (repo.includes("postgres")) return "/var/lib/postgresql/data";
  if (repo.includes("mariadb") || repo.includes("mysql")) return "/var/lib/mysql";
  if (repo.includes("redis")) return "/data";
  if (repo.includes("mongo")) return "/data/db";
  return "/data";
}

function buildPod(faker: Faker, baseName: string, network: LogicalNetwork): LogicalPod {
  const mode = faker.helpers.weightedArrayElement([
    { weight: 64, value: "Running" as const },
    { weight: 14, value: "Paused" as const },
    { weight: 12, value: "Exited" as const },
    { weight: 10, value: "Degraded" as const },
  ]);
  const memberWords = faker.helpers.arrayElements(
    ["api", "worker", "db", "cache", "sidecar", "proxy"],
    faker.number.int({ min: 1, max: 4 }),
  );
  const memberStatusFor = (index: number): "running" | "paused" | "exited" => {
    if (mode === "Paused") return "paused";
    if (mode === "Exited") return "exited";
    if (mode === "Degraded") return index === memberWords.length - 1 ? "exited" : "running";
    return "running";
  };
  const members: LogicalPodMember[] = [
    {
      idHex: hex(faker, 12),
      name: `${baseName}-infra`,
      status: mode === "Paused" ? "paused" : mode === "Exited" ? "exited" : "running",
      isInfra: true,
    },
    ...memberWords.map((word, index) => ({
      idHex: hex(faker, 12),
      name: `${baseName}-${word}`,
      status: memberStatusFor(index),
      isInfra: false,
    })),
  ];
  return {
    idHex: hex(faker, 64),
    infraIdHex: hex(faker, 64),
    name: `${baseName}-pod`,
    status: mode,
    createdAt: faker.date.recent({ days: 10 }),
    labels: { app: baseName, "io.podman.pod": "true" },
    network,
    members,
  };
}
