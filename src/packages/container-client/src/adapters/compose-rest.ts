// Pure libpod REST logic for compose stacks — the reconciling `up`, teardown `down`, and label-derived
// listing. Imports only ./baseUrls + compose types (never Application), exactly like swarm-rest.ts, so a
// dialect can drive it with host.getApiDriver() without the adapter→Application cycle.

import type { AxiosInstance } from "axios";

import {
  COMPOSE_PROJECT_LABELS,
  COMPOSE_SERVICE_LABELS,
  LABEL_CONFIG_HASH,
  LABEL_PROJECT,
} from "@/container-client/compose/labels";
import type {
  ComposeChangeSummary,
  ComposeDownOptions,
  ComposePlan,
  ComposeProject,
  ComposeUpOptions,
} from "@/container-client/compose/types";
import { LIBPOD_BASE_URL, LIFECYCLE_TIMEOUT_MS } from "./baseUrls";

type RawContainer = Record<string, any>;

const cfg = (params?: Record<string, unknown>, timeoutMs?: number) => ({
  baseURL: LIBPOD_BASE_URL,
  ...(params ? { params } : {}),
  ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
});
const labelsOf = (c: RawContainer): Record<string, string> => (c.Labels as Record<string, string>) ?? {};
// Read either engine's convention: WE write com.docker.compose.*, podman-compose writes io.podman.compose.*.
const projectOf = (labels: Record<string, string>): string | undefined =>
  COMPOSE_PROJECT_LABELS.map((k) => labels[k]).find(Boolean);
const serviceOf = (labels: Record<string, string>): string =>
  COMPOSE_SERVICE_LABELS.map((k) => labels[k]).find(Boolean) ?? "";
const nameOf = (c: RawContainer): string => String(c.Names?.[0] ?? c.Name ?? "").replace(/^\//, "");
const isRunning = (c: RawContainer): boolean => c.State === "running" || /^up/i.test(String(c.Status ?? ""));
const projectFilter = (project: string) => JSON.stringify({ label: [`${LABEL_PROJECT}=${project}`] });

interface ExistingContainer {
  id: string;
  name: string;
  hash: string;
  running: boolean;
  pod: boolean;
}

async function ensure(driver: AxiosInstance, url: string, body: unknown): Promise<void> {
  try {
    await driver.post(url, body, cfg());
  } catch {
    // Resource already exists (409) or a benign create race — the reconcile is idempotent.
  }
}

async function deleteQuiet(driver: AxiosInstance, url: string, params?: Record<string, unknown>): Promise<void> {
  try {
    await driver.delete(url, cfg(params, LIFECYCLE_TIMEOUT_MS));
  } catch {
    // Missing resource (404) during teardown — nothing to do.
  }
}

async function createContainer(driver: AxiosInstance, body: unknown): Promise<void> {
  await driver.post("/containers/create", body, cfg());
}

// Container states from which libpod's `start` is accepted; anything else (running, paused, stopping,
// removing, dead) rejects with a 500 whose cause is "container state improper".
const STARTABLE_STATES = new Set(["created", "configured", "exited", "stopped"]);

// True for libpod's "container state improper" 500 (also worded "must be in … to be started").
const isStateImproper = (err: any): boolean => {
  const data = err?.response?.data;
  const message = String(data?.cause ?? data?.message ?? err?.message ?? "");
  return /state improper|must be in .* to be started/i.test(message);
};

async function inspectRunState(driver: AxiosInstance, nameOrId: string): Promise<{ status: string; running: boolean }> {
  try {
    const res = await driver.get(`/containers/${encodeURIComponent(nameOrId)}/json`, cfg());
    const state = (res.data as RawContainer)?.State ?? {};
    return { status: String(state.Status ?? "").toLowerCase(), running: !!state.Running };
  } catch {
    return { status: "gone", running: false };
  }
}

export async function startContainer(
  driver: AxiosInstance,
  nameOrId: string,
  opts: HealthWaitOptions = {},
): Promise<void> {
  try {
    await driver.post(`/containers/${encodeURIComponent(nameOrId)}/start`, undefined, cfg());
    return;
  } catch (err) {
    if (!isStateImproper(err)) throw err;
  }
  const intervalMs = opts.intervalMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { status, running } = await inspectRunState(driver, nameOrId);
    if (running) return; // it came up on its own (or was already running)
    if (STARTABLE_STATES.has(status)) {
      await driver.post(`/containers/${encodeURIComponent(nameOrId)}/start`, undefined, cfg());
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Cannot start "${nameOrId}" — it is stuck in state "${status || "unknown"}", likely left over from a run that did not finish stopping. Wait a moment and import again.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function listProjectContainers(driver: AxiosInstance, project: string): Promise<Map<string, ExistingContainer>> {
  const res = await driver.get("/containers/json", cfg({ all: true }));
  const all: RawContainer[] = Array.isArray(res.data) ? res.data : [];
  const byService = new Map<string, ExistingContainer>();
  for (const c of all) {
    const labels = labelsOf(c);
    if (projectOf(labels) !== project) continue; // match either engine's project label
    const service = serviceOf(labels);
    if (!service) continue;
    byService.set(service, {
      id: String(c.Id),
      name: nameOf(c),
      hash: labels[LABEL_CONFIG_HASH] ?? "",
      running: isRunning(c),
      pod: Boolean(c.Pod || c.PodName),
    });
  }
  return byService;
}

async function namesByLabel(driver: AxiosInstance, url: string, project: string): Promise<string[]> {
  const res = await driver.get(url, cfg({ filters: projectFilter(project) }));
  const data = res.data;
  const arr: RawContainer[] = Array.isArray(data) ? data : Array.isArray(data?.Volumes) ? data.Volumes : [];
  // libpod's /networks/json uses a lowercase `name`; /volumes/json (and Docker's) use `Name`. Read both, or
  // teardown silently skips every network (name → "" → filtered out) and leaks the project's networks.
  return arr.map((x) => String((x as { name?: string })?.name ?? x?.Name ?? "")).filter(Boolean);
}

export interface HealthWaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

// Poll a container's inspect `State.Health.Status` until it is "healthy" — the mechanism behind
// `depends_on: {condition: service_healthy}`. Throws a descriptive error on timeout, or immediately when the
// container has no healthcheck at all (`State.Health` absent), so `up` never hangs silently. `intervalMs` is
// injectable so tests don't sleep.
export async function waitHealthy(
  driver: AxiosInstance,
  nameOrId: string,
  opts: HealthWaitOptions = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 120000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await driver.get(`/containers/${encodeURIComponent(nameOrId)}/json`, cfg());
    const health = (res.data as RawContainer)?.State?.Health;
    if (!health) {
      throw new Error(
        `"${nameOrId}" is required to be healthy (depends_on: service_healthy) but has no healthcheck — add a healthcheck: to it or drop the condition`,
      );
    }
    const status = String(health.Status ?? "");
    if (status === "healthy") return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for "${nameOrId}" to become healthy (last status: ${status || "unknown"})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Reconcile a project to its plan in two passes: create/recreate (no start), then start once in order.
export async function applyPlan(
  driver: AxiosInstance,
  plan: ComposePlan,
  opts: ComposeUpOptions = {},
  healthWait: HealthWaitOptions = {},
): Promise<ComposeChangeSummary> {
  const summary: ComposeChangeSummary = { created: [], recreated: [], unchanged: [], started: [], orphansRemoved: [] };

  const prior = await listProjectContainers(driver, plan.project);
  if (prior.size > 0 && [...prior.values()].some((c) => c.pod) !== Boolean(plan.pod)) {
    await down(driver, plan.project, {});
  }

  for (const network of plan.networks) await ensure(driver, "/networks/create", network.body);
  for (const volume of plan.volumes) await ensure(driver, "/volumes/create", volume.body);
  if (plan.pod) await ensure(driver, "/pods/create", plan.pod.body);

  const existing = await listProjectContainers(driver, plan.project);
  const planned = new Set(plan.containers.map((c) => c.service));
  const startName = new Map<string, string>();
  const running = new Map<string, boolean>();

  // Pass 1 — reconcile, matched by compose labels (NOT generated name). Never start here.
  for (const container of plan.containers) {
    const prior = existing.get(container.service);
    if (!prior) {
      await createContainer(driver, container.body);
      summary.created.push(container.name);
      startName.set(container.name, container.name);
    } else if (prior.hash === container.configHash) {
      summary.unchanged.push(container.name);
      startName.set(container.name, prior.name || container.name);
      running.set(container.name, prior.running);
    } else {
      await deleteQuiet(driver, `/containers/${encodeURIComponent(prior.id)}`, { force: true, v: false });
      await createContainer(driver, container.body);
      summary.recreated.push(container.name);
      startName.set(container.name, container.name);
    }
  }

  for (const [service, prior] of existing) {
    if (!planned.has(service) && opts.removeOrphans) {
      await deleteQuiet(driver, `/containers/${encodeURIComponent(prior.id)}`, { force: true, v: false });
      summary.orphansRemoved.push(prior.name);
    }
  }

  // Pass 2 — start once, dependency order, skipping anything already running. Before starting a service that
  // is gated on `service_healthy`, wait for each gated dep (already started earlier in topological order) to
  // become healthy — so a dependent never starts against a not-yet-ready dependency.
  for (const name of plan.startOrder) {
    if (running.get(name)) continue;
    const gatedDeps = plan.healthGates?.[name];
    if (gatedDeps) {
      for (const dep of gatedDeps) {
        await waitHealthy(driver, startName.get(dep) ?? dep, healthWait);
      }
    }
    await startContainer(driver, startName.get(name) ?? name);
    summary.started.push(name);
  }
  return summary;
}

export async function down(driver: AxiosInstance, project: string, opts: ComposeDownOptions = {}): Promise<void> {
  // Remove the project POD FIRST (force): this atomically stops and removes every member container (and the
  // pod's infra container) through podman's own pod-teardown path. Force-removing individual pod members out
  // from under a live pod is a known way to crash the podman service (observed: a member's force-remove
  // returns "socket hang up" and the service restarts), so we never take that path. Ignores 404 for
  // compose-parity stacks, which have no pod.
  await deleteQuiet(driver, `/pods/${encodeURIComponent(project)}`, { force: true });
  // Then remove any remaining project containers NOT owned by the pod (e.g. compose-parity leftovers). The
  // list is re-queried after the pod teardown, so members already gone with the pod aren't touched again.
  const existing = await listProjectContainers(driver, project);
  for (const [, container] of existing) {
    await deleteQuiet(driver, `/containers/${encodeURIComponent(container.id)}`, { force: true, v: false });
  }
  for (const network of await namesByLabel(driver, "/networks/json", project)) {
    await deleteQuiet(driver, `/networks/${encodeURIComponent(network)}`);
  }
  if (opts.removeVolumes) {
    for (const volume of await namesByLabel(driver, "/volumes/json", project)) {
      await deleteQuiet(driver, `/volumes/${encodeURIComponent(volume)}`, { force: true });
    }
  }
}

// Derive the compose projects visible on a connection by grouping containers on the project labels.
export async function listProjects(driver: AxiosInstance): Promise<ComposeProject[]> {
  const res = await driver.get("/containers/json", cfg({ all: true }));
  const all: RawContainer[] = Array.isArray(res.data) ? res.data : [];
  const byProject = new Map<string, { services: Set<string>; running: number; pod: boolean }>();
  for (const c of all) {
    const labels = labelsOf(c);
    const project = COMPOSE_PROJECT_LABELS.map((k) => labels[k]).find(Boolean);
    if (!project) continue;
    const entry = byProject.get(project) ?? { services: new Set<string>(), running: 0, pod: false };
    const service = serviceOf(labels);
    if (service) entry.services.add(service);
    if (isRunning(c)) entry.running += 1;
    if (c.Pod || c.PodName) entry.pod = true;
    byProject.set(project, entry);
  }
  return [...byProject.entries()].map(([Name, e]) => ({
    Name,
    Services: e.services.size,
    Running: e.running,
    PodMode: e.pod,
  }));
}
