// adapters/swarm-rest.ts — the single canonical owner of Docker Swarm REST behavior.
//
// Pure functions over an AxiosInstance. Imports ONLY types + the base-URL leaf — NEVER `Application` —
// so the runtime dialect (dialects/docker.ts) can call these with `host.getApiDriver()` without pulling
// the app-singleton graph back into the low-level layer (no dialect → adapter → Application cycle).
// Both consumers delegate here: the renderer's `SwarmAdapter` (adapters/swarm.ts) and the Docker dialect.
//
// Swarm is a Docker-only REST surface (/services,/nodes,/tasks,/swarm,/secrets,/configs). Stacks are NOT
// a REST object — derived by grouping services on the `com.docker.stack.namespace` label. Reads map ONLY
// Docker's non-swarm signal (HTTP 503 / "this node is not a swarm manager") to empty/undefined and
// RETHROW everything else, so genuine failures still reach the renderer's global query error path.

import type { AxiosInstance } from "axios";

import type {
  NodeUpdateOptions,
  SwarmConfig,
  SwarmConfigCreateOptions,
  SwarmInfo,
  SwarmInitOptions,
  SwarmLeaveOptions,
  SwarmNode,
  SwarmSecret,
  SwarmSecretCreateOptions,
  SwarmService,
  SwarmStack,
  SwarmTask,
} from "@/env/Types";
import { toBase64 } from "@/utils/base64";
import { DOCKER_BASE_URL } from "./baseUrls";

const STACK_NAMESPACE_LABEL = "com.docker.stack.namespace";
const cfg = { baseURL: DOCKER_BASE_URL };

function isOk(res: any): boolean {
  return res?.status >= 200 && res.status < 300;
}

// True only for Docker's "node is not (part of) a swarm manager" signal (HTTP 503) — NOT for 500/auth/network.
//
// Recognition must survive the renderer→main IPC proxy, which rebuilds the AxiosError from a re-serialized
// subset (commandProxyClient.ts): the numeric status can arrive as a string, and Docker's JSON body can be
// dropped, leaving only axios's generic "Request failed with status code 503" message. So we coerce the
// status before comparing AND fall back to the message — Docker's own phrase when the body survived, else the
// generic "status code 503" (the one string that always survives). Missing this turns the not-in-a-swarm 503
// into an endless toast storm, since the swarm queries poll.
function isNotSwarmManager(error: any): boolean {
  const status = Number(error?.response?.status ?? error?.status);
  if (status === 503) {
    return true;
  }
  const message = `${error?.response?.data?.message ?? error?.message ?? ""}`.toLowerCase();
  return (
    message.includes("not a swarm manager") ||
    message.includes("not part of a swarm") ||
    message.includes("status code 503")
  );
}

async function readList<T>(driver: AxiosInstance, url: string, extra?: Record<string, unknown>): Promise<T[]> {
  try {
    const res = await driver.get<T[]>(url, { ...cfg, ...extra });
    if (isOk(res)) {
      return res.data ?? [];
    }
    if (res.status === 503) {
      return [];
    }
    throw new Error(`Swarm request ${url} failed: ${res.status}`);
  } catch (error) {
    if (isNotSwarmManager(error)) {
      return [];
    }
    throw error;
  }
}

async function readOne<T>(driver: AxiosInstance, url: string): Promise<T | undefined> {
  try {
    const res = await driver.get<T>(url, cfg);
    if (isOk(res)) {
      return res.data;
    }
    if (res.status === 503) {
      return undefined;
    }
    throw new Error(`Swarm request ${url} failed: ${res.status}`);
  } catch (error) {
    if (isNotSwarmManager(error)) {
      return undefined;
    }
    throw error;
  }
}

// cluster lifecycle / probe
export function swarmInspect(driver: AxiosInstance): Promise<SwarmInfo | undefined> {
  return readOne<SwarmInfo>(driver, "/swarm");
}

export async function swarmInit(driver: AxiosInstance, opts?: SwarmInitOptions): Promise<boolean> {
  const body = {
    ListenAddr: opts?.ListenAddr ?? "0.0.0.0:2377",
    AdvertiseAddr: opts?.AdvertiseAddr,
    ForceNewCluster: opts?.ForceNewCluster ?? false,
  };
  const res = await driver.post("/swarm/init", body, cfg);
  return isOk(res);
}

export async function swarmLeave(driver: AxiosInstance, opts?: SwarmLeaveOptions): Promise<boolean> {
  const res = await driver.post("/swarm/leave", null, { ...cfg, params: { force: opts?.force ?? false } });
  return isOk(res);
}

// services
export function listServices(driver: AxiosInstance): Promise<SwarmService[]> {
  return readList<SwarmService>(driver, "/services");
}

export function getService(driver: AxiosInstance, id: string): Promise<SwarmService | undefined> {
  return readOne<SwarmService>(driver, `/services/${encodeURIComponent(id)}`);
}

export async function createService(driver: AxiosInstance, spec: Record<string, unknown>): Promise<boolean> {
  const res = await driver.post("/services/create", spec, cfg);
  return isOk(res);
}

// Read-modify-write the service Spec at its current Version.Index (Docker optimistic concurrency).
async function updateServiceSpec(driver: AxiosInstance, id: string, mutate: (spec: any) => void): Promise<boolean> {
  const service = await getService(driver, id);
  if (!service?.Version) {
    return false;
  }
  const spec = structuredClone(service.Spec ?? {});
  mutate(spec);
  const res = await driver.post(`/services/${encodeURIComponent(id)}/update`, spec, {
    ...cfg,
    params: { version: service.Version.Index },
  });
  return isOk(res);
}

export function scaleService(driver: AxiosInstance, id: string, replicas: number): Promise<boolean> {
  return updateServiceSpec(driver, id, (spec) => {
    spec.Mode = spec.Mode ?? {};
    spec.Mode.Replicated = { Replicas: replicas };
  });
}

export function updateService(driver: AxiosInstance, id: string, patch: Record<string, unknown>): Promise<boolean> {
  return updateServiceSpec(driver, id, (spec) => Object.assign(spec, patch));
}

export async function removeService(driver: AxiosInstance, id: string): Promise<boolean> {
  const res = await driver.delete(`/services/${encodeURIComponent(id)}`, cfg);
  return isOk(res);
}

// tasks / stacks
export function listTasks(driver: AxiosInstance, serviceId?: string): Promise<SwarmTask[]> {
  const extra = serviceId ? { params: { filters: JSON.stringify({ service: [serviceId] }) } } : undefined;
  return readList<SwarmTask>(driver, "/tasks", extra);
}

// Stacks are derived: one entry per `com.docker.stack.namespace` label across the service list.
export async function listStacks(driver: AxiosInstance): Promise<SwarmStack[]> {
  const services = await listServices(driver);
  const byNamespace = new Map<string, number>();
  for (const service of services) {
    const namespace = service?.Spec?.Labels?.[STACK_NAMESPACE_LABEL];
    if (!namespace) {
      continue;
    }
    byNamespace.set(namespace, (byNamespace.get(namespace) ?? 0) + 1);
  }
  return [...byNamespace.entries()].map(([Name, Services]) => ({ Name, Services, Orchestrator: "Swarm" }));
}

// nodes
export function listNodes(driver: AxiosInstance): Promise<SwarmNode[]> {
  return readList<SwarmNode>(driver, "/nodes");
}

export function getNode(driver: AxiosInstance, id: string): Promise<SwarmNode | undefined> {
  return readOne<SwarmNode>(driver, `/nodes/${encodeURIComponent(id)}`);
}

// RMW the node Spec (Availability / Role) at its current Version.Index.
export async function updateNode(driver: AxiosInstance, id: string, opts: NodeUpdateOptions): Promise<boolean> {
  const node = await getNode(driver, id);
  if (!node?.Version) {
    return false;
  }
  const spec: any = structuredClone(node.Spec ?? {});
  spec.Role = opts.Role ?? spec.Role ?? "worker";
  spec.Availability = opts.Availability ?? spec.Availability ?? "active";
  const res = await driver.post(`/nodes/${encodeURIComponent(id)}/update`, spec, {
    ...cfg,
    params: { version: node.Version.Index },
  });
  return isOk(res);
}

export async function removeNode(driver: AxiosInstance, id: string, force = false): Promise<boolean> {
  const res = await driver.delete(`/nodes/${encodeURIComponent(id)}`, { ...cfg, params: { force } });
  return isOk(res);
}

// cluster secrets / configs
export function listSecrets(driver: AxiosInstance): Promise<SwarmSecret[]> {
  return readList<SwarmSecret>(driver, "/secrets");
}

export function getSecret(driver: AxiosInstance, id: string): Promise<SwarmSecret | undefined> {
  return readOne<SwarmSecret>(driver, `/secrets/${encodeURIComponent(id)}`);
}

export async function createSecret(driver: AxiosInstance, opts: SwarmSecretCreateOptions): Promise<boolean> {
  const res = await driver.post(
    "/secrets/create",
    { Name: opts.Name, Data: toBase64(opts.Data), Labels: opts.Labels ?? {} },
    cfg,
  );
  return isOk(res);
}

export async function removeSecret(driver: AxiosInstance, id: string): Promise<boolean> {
  const res = await driver.delete(`/secrets/${encodeURIComponent(id)}`, cfg);
  return isOk(res);
}

export function listConfigs(driver: AxiosInstance): Promise<SwarmConfig[]> {
  return readList<SwarmConfig>(driver, "/configs");
}

export function getConfig(driver: AxiosInstance, id: string): Promise<SwarmConfig | undefined> {
  return readOne<SwarmConfig>(driver, `/configs/${encodeURIComponent(id)}`);
}

export async function createConfig(driver: AxiosInstance, opts: SwarmConfigCreateOptions): Promise<boolean> {
  const res = await driver.post(
    "/configs/create",
    { Name: opts.Name, Data: toBase64(opts.Data), Labels: opts.Labels ?? {} },
    cfg,
  );
  return isOk(res);
}

export async function removeConfig(driver: AxiosInstance, id: string): Promise<boolean> {
  const res = await driver.delete(`/configs/${encodeURIComponent(id)}`, cfg);
  return isOk(res);
}
