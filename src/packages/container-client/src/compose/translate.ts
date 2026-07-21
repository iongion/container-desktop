// Translate a normalized ComposeProjectModel into a libpod ComposePlan — the declarative set of REST
// create bodies. PURE, no I/O. This is the compose→Podman mapping and the reconcile config-hash live here.

import { topologicalStartOrder } from "./dependsOn";
import {
  LABEL_CONFIG_HASH,
  LABEL_CONTAINER_NUMBER,
  LABEL_NETWORK,
  LABEL_PODMAN_PROJECT,
  LABEL_PROJECT,
  LABEL_SERVICE,
  LABEL_VOLUME,
} from "./labels";
import type {
  ComposeHealthcheck,
  ComposePlan,
  ComposePlanContainer,
  ComposePlanResource,
  ComposePortMapping,
  ComposeProjectModel,
  ComposeServiceModel,
} from "./types";

export interface TranslateOptions {
  podMode?: boolean;
}

type Body = Record<string, unknown>;

const projectLabels = (project: string): Record<string, string> => ({
  [LABEL_PROJECT]: project,
  [LABEL_PODMAN_PROJECT]: project,
});

const containerNameOf = (service: ComposeServiceModel, project: string): string =>
  service.containerName ?? `${project}_${service.name}_1`;

// Compose healthcheck → libpod `healthconfig` create body (PascalCase fields, nanosecond int64 durations).
function toHealthConfig(healthcheck: ComposeHealthcheck): Body {
  const config: Body = { Test: healthcheck.test };
  if (healthcheck.intervalNs != null) config.Interval = healthcheck.intervalNs;
  if (healthcheck.timeoutNs != null) config.Timeout = healthcheck.timeoutNs;
  if (healthcheck.startPeriodNs != null) config.StartPeriod = healthcheck.startPeriodNs;
  if (healthcheck.retries != null) config.Retries = healthcheck.retries;
  return config;
}

function toPortMapping(port: ComposePortMapping): Body {
  const mapping: Body = { container_port: port.target, protocol: port.protocol };
  if (port.published != null && port.published !== "") mapping.host_port = Number(port.published);
  if (port.hostIp != null) mapping.host_ip = port.hostIp;
  if (port.range != null && port.range > 1) mapping.range = port.range;
  return mapping;
}

function buildMounts(service: ComposeServiceModel, project: string, externalVolumes: Set<string>) {
  const mounts: Body[] = [];
  const volumes: Body[] = [];
  for (const mount of service.mounts) {
    if (mount.type === "bind") {
      mounts.push({
        type: "bind",
        source: mount.source,
        destination: mount.target,
        options: mount.readOnly ? ["ro"] : [],
      });
    } else {
      const name = mount.source
        ? externalVolumes.has(mount.source)
          ? mount.source
          : `${project}_${mount.source}`
        : undefined;
      const vol: Body = name ? { Name: name, Dest: mount.target } : { Dest: mount.target };
      if (mount.readOnly) vol.Options = ["ro"];
      volumes.push(vol);
    }
  }
  return { mounts, volumes };
}

function buildContainerBody(service: ComposeServiceModel, model: ComposeProjectModel, podMode: boolean): Body {
  const project = model.name;
  const externalVolumes = new Set(model.volumes.filter((v) => v.external).map((v) => v.name));
  const body: Body = {
    name: containerNameOf(service, project),
    image: service.image,
    labels: {
      ...service.labels,
      [LABEL_PROJECT]: project,
      [LABEL_SERVICE]: service.name,
      [LABEL_CONTAINER_NUMBER]: "1",
      [LABEL_PODMAN_PROJECT]: project,
    },
  };
  if (service.command) body.command = service.command;
  if (service.entrypoint) body.entrypoint = service.entrypoint;
  if (Object.keys(service.environment).length) body.env = service.environment;
  if (service.restart) body.restart_policy = service.restart;
  if (service.workingDir) body.work_dir = service.workingDir;
  if (service.user) body.user = service.user;
  // The pod owns the UTS namespace in single-pod mode, so a member container cannot set its own hostname
  // (libpod: "cannot set hostname when joining the pod UTS namespace"). Services share the pod hostname there.
  if (service.hostname && !podMode) body.hostname = service.hostname;
  if (service.privileged) body.privileged = true;
  if (service.capAdd.length) body.cap_add = service.capAdd;
  if (service.capDrop.length) body.cap_drop = service.capDrop;
  if (service.extraHosts.length) body.hostadd = service.extraHosts;
  if (service.healthcheck) body.healthconfig = toHealthConfig(service.healthcheck);

  const { mounts, volumes } = buildMounts(service, project, externalVolumes);
  if (mounts.length) body.mounts = mounts;
  if (volumes.length) body.volumes = volumes;

  if (podMode) {
    // Shared netns: the pod owns networking + published ports; the container just joins it.
    body.pod = project;
  } else {
    // Joining named networks requires bridge netns explicitly — rootless Podman otherwise defaults to
    // slirp4netns/pasta and rejects the create ("networks ... can only be used with Bridge mode networking").
    body.netns = { nsmode: "bridge" };
    if (service.ports.length) body.portmappings = service.ports.map(toPortMapping);
    body.Networks = Object.fromEntries(
      service.networks.map((n) => [`${project}_${n.name}`, { aliases: [service.name, ...n.aliases] }]),
    );
  }
  return body;
}

// Host ports published by more than one service — they cannot coexist in a single shared-netns pod (the
// pod create would fail). PURE. Surfaced both as translate() warnings and, ahead of deploy, in the Import
// drawer's single-pod pre-flight, so the user sees the conflict instead of a cryptic engine error.
export function detectPodPortConflicts(model: ComposeProjectModel): string[] {
  const conflicts: string[] = [];
  const seen = new Map<string, string>();
  for (const service of model.services) {
    for (const port of service.ports) {
      if (port.published == null || port.published === "") continue;
      const key = `${port.published}/${port.protocol}`;
      const owner = seen.get(key);
      if (owner) {
        conflicts.push(
          `host port ${port.published}/${port.protocol} is published by both "${owner}" and "${service.name}" — they cannot share one pod`,
        );
      } else {
        seen.set(key, service.name);
      }
    }
  }
  return conflicts;
}

function buildPod(model: ComposeProjectModel): { pod: ComposePlanResource; warnings: string[] } {
  const project = model.name;
  const portmappings = model.services.flatMap((service) => service.ports.map(toPortMapping));
  const body: Body = { name: project, labels: projectLabels(project) };
  if (portmappings.length) body.portmappings = portmappings;
  return { pod: { name: project, body }, warnings: detectPodPortConflicts(model) };
}

// FNV-1a (32-bit) over a stable key-sorted serialization — pure, no node:crypto (banned in shared code).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Body)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Body)[k])}`);
  return `{${entries.join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Translate a compose model into a declarative libpod plan.
export function translate(model: ComposeProjectModel, opts: TranslateOptions): ComposePlan {
  const project = model.name;
  const podMode = opts.podMode === true;
  const warnings: string[] = [];

  const networks: ComposePlanResource[] = model.networks
    .filter((n) => !n.external)
    .map((n) => ({
      name: `${project}_${n.name}`,
      body: {
        name: `${project}_${n.name}`,
        labels: { ...projectLabels(project), [LABEL_NETWORK]: n.name },
        ...(n.driver ? { driver: n.driver } : {}),
      },
    }));

  const volumes: ComposePlanResource[] = model.volumes
    .filter((v) => !v.external)
    .map((v) => ({
      name: `${project}_${v.name}`,
      body: {
        Name: `${project}_${v.name}`,
        Label: { ...projectLabels(project), [LABEL_VOLUME]: v.name },
        ...(v.driver ? { Driver: v.driver } : {}),
      },
    }));

  let pod: ComposePlanResource | undefined;
  if (podMode) {
    const built = buildPod(model);
    pod = built.pod;
    warnings.push(...built.warnings);
  }

  const containers: ComposePlanContainer[] = model.services.map((service) => {
    const body = buildContainerBody(service, model, podMode);
    const configHash = fnv1a(stableStringify(body));
    (body.labels as Record<string, string>)[LABEL_CONFIG_HASH] = configHash;
    return { name: containerNameOf(service, project), service: service.name, configHash, body };
  });

  const nameByService = new Map(model.services.map((s) => [s.name, containerNameOf(s, project)]));
  const startOrder = topologicalStartOrder(model.services).map((name) => nameByService.get(name) as string);

  // Health gates (service_healthy): map each gated service's container name → its deps' container names, so
  // applyPlan can wait for those to become healthy before starting it. Undefined when nothing is gated.
  const healthGates: Record<string, string[]> = {};
  for (const service of model.services) {
    if (service.healthDeps.length) {
      const deps = service.healthDeps.map((dep) => nameByService.get(dep)).filter((name): name is string => !!name);
      if (deps.length) healthGates[containerNameOf(service, project)] = deps;
    }
  }

  for (const unsupported of model.unsupported) {
    warnings.push(`unsupported compose key: ${unsupported.path}`);
  }

  return {
    project,
    networks,
    volumes,
    pod,
    containers,
    startOrder,
    ...(Object.keys(healthGates).length ? { healthGates } : {}),
    warnings,
  };
}
