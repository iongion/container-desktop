// Dev-gated real-engine probes, driven from a WebDriver e2e spec. They run INSIDE the webview, so the ports
// they use are the running shell's own — Rust under Tauri, Go under Wails — installed as the globals by that
// shell's host bridge. Nothing here is shell-specific: every call goes through container-client and the
// generic host ports, so the same probe proves the same behaviour on either backend.
//
// Registered only behind `import.meta.env.DEV` in index.tsx (same gate as installAssistantDemo), so the whole
// module is tree-shaken out of a production bundle.
//
// Each probe returns plain JSON observations and asserts nothing — the spec owns the assertions, matching
// webdriver/specs/sandbox-exec.e2e.js. That keeps the probe free of any test framework.
import { SwarmAdapter } from "@/container-client/adapters/swarm";
import { createConnectorBy } from "@/container-client/connection";
import { runSSHPreflight } from "@/container-client/diagnostics/ssh-preflight";
import { createComposedHostClient } from "@/container-client/runtimes/registry";
import type { ContainerEngine, ContainerEngineHost } from "@/container-client/types/engine";
import type { OperatingSystem } from "@/container-client/types/os";
import { createLogger } from "@/logger";

const logger = createLogger("web-app.liveProbes");

// The target description the deleted Vitest suites read from targets.env. wdio.conf.js parses that file in
// Node (it runs there) and hands the selected entry in as a plain object.
export interface LiveProbeTarget {
  id: string;
  os: OperatingSystem;
  socket?: string;
  scope?: string;
  ssh?: { host: string; port: number; user: string; keyPath: string };
}

export interface ConnectionMatrixObservation {
  kind: "remote" | "native" | "scoped";
  skipped?: string;
  ok?: boolean;
  detail?: string;
  containersIsArray?: boolean;
}

async function clientFor(target: LiveProbeTarget, engine: ContainerEngine, host: ContainerEngineHost) {
  const connector = await createConnectorBy(target.os, engine, host);
  const client = await createComposedHostClient(connector, target.os);
  return { client, settings: structuredClone(connector.settings) };
}

// One (engine, host) cell of the connection matrix. Native hosts get a real /_ping plus a container list;
// SSH remotes go through the bounded pre-flight end-to-end; scoped hosts (WSL / Lima / vendor machine) run the
// real availability detection. An unconfigured cell reports `skipped` — the caller must surface that, never
// treat it as a pass.
async function connectionMatrix(
  target: LiveProbeTarget,
  engine: ContainerEngine,
  host: ContainerEngineHost,
  shape: "remote" | "native" | "scoped",
): Promise<ConnectionMatrixObservation> {
  if (shape === "remote") {
    if (!target.ssh) {
      return { kind: "remote", skipped: "no SSH config" };
    }
    const result = await runSSHPreflight(
      {
        hostName: target.ssh.host,
        port: target.ssh.port,
        user: target.ssh.user,
        identityFile: target.ssh.keyPath,
      },
      { osType: target.os, engineProgram: engine },
    );
    return { kind: "remote", ok: result.ok, detail: JSON.stringify(result.steps) };
  }

  if (shape === "native") {
    if (!target.socket) {
      return { kind: "native", skipped: `no ${engine} socket configured` };
    }
    const { client, settings } = await clientFor(target, engine, host);
    settings.mode = "mode.manual";
    settings.api.connection.uri = `unix://${target.socket}`;
    await client.setSettings(settings);

    const ping = await client.isApiRunning();
    if (!ping.success) {
      return { kind: "native", ok: false, detail: `/_ping failed: ${ping.details}` };
    }
    const driver = await client.getApiDriver();
    const containers = await driver.request({ method: "GET", url: "/containers/json", timeout: 5000 });
    return { kind: "native", ok: true, containersIsArray: Array.isArray(containers.data) };
  }

  const { client, settings } = await clientFor(target, engine, host);
  if (target.scope && settings.controller) {
    settings.controller.scope = target.scope;
  }
  await client.setSettings(settings);
  const availability = await client.getAvailability();
  return { kind: "scoped", ok: availability.api, detail: JSON.stringify(availability.report) };
}

async function swarmAdapterFor(target: LiveProbeTarget, engine: ContainerEngine, host: ContainerEngineHost) {
  const { client, settings } = await clientFor(target, engine, host);
  settings.mode = "mode.manual";
  settings.api.connection.uri = `unix://${target.socket}`;
  await client.setSettings(settings);
  // Docker hosts advertise extensions.swarm=true (dialect flip); SwarmAdapter gates on that.
  return new SwarmAdapter(client);
}

// Idempotent preconditions so the observations never depend on incidental sandbox state.
async function ensureNonSwarm(adapter: SwarmAdapter) {
  if (await adapter.inspect()) {
    await adapter.leave({ force: true });
  }
}

async function ensureManager(adapter: SwarmAdapter) {
  if (!(await adapter.inspect())) {
    await adapter.init();
  }
}

// The non-swarm 503 must degrade to empty/undefined rather than throwing, and init → inspect → leave must
// form and dissolve a real swarm.
async function swarmLifecycle(target: LiveProbeTarget, engine: ContainerEngine, host: ContainerEngineHost) {
  const adapter = await swarmAdapterFor(target, engine, host);
  await ensureNonSwarm(adapter);
  const nonSwarm = {
    inspect: (await adapter.inspect()) ?? null,
    services: await adapter.listServices(),
    nodes: await adapter.listNodes(),
  };
  const initialized = await adapter.init();
  const formedId = (await adapter.inspect())?.ID ?? null;
  const left = await adapter.leave({ force: true });
  const afterLeave = (await adapter.inspect()) ?? null;
  return { nonSwarm, initialized, formedId, left, afterLeave };
}

// Single-node manager: node listing, a service through create → scale → derived stack → remove, and a
// cluster secret + config round-trip.
async function swarmManager(target: LiveProbeTarget, engine: ContainerEngine, host: ContainerEngineHost) {
  const adapter = await swarmAdapterFor(target, engine, host);
  await ensureManager(adapter);

  const nodeCount = (await adapter.listNodes()).length;

  const name = "cdtest_web";
  const priorId = (await adapter.listServices()).find((s) => s.Spec?.Name === name)?.ID;
  if (priorId) {
    await adapter.removeService(priorId);
  }
  const created = await adapter.createService({
    Name: name,
    Labels: { "com.docker.stack.namespace": "cdtest" },
    TaskTemplate: { ContainerSpec: { Image: "nginx:alpine" } },
    Mode: { Replicated: { Replicas: 1 } },
  });
  const service = (await adapter.listServices()).find((s) => s.Spec?.Name === name);
  const scaled = service ? await adapter.scaleService(service.ID, 2) : false;
  const stackDerived = (await adapter.listStacks()).some((stack) => stack.Name === "cdtest");
  const removed = service ? await adapter.removeService(service.ID) : false;

  const secretName = "cdtest_secret";
  const configName = "cdtest_config";
  const purge = async () => {
    for (const secret of await adapter.listSecrets()) {
      if (secret.Spec?.Name === secretName) {
        await adapter.removeSecret(secret.ID);
      }
    }
    for (const config of await adapter.listConfigs()) {
      if (config.Spec?.Name === configName) {
        await adapter.removeConfig(config.ID);
      }
    }
  };
  await purge();
  const secretCreated = await adapter.createSecret({ Name: secretName, Data: "s3cr3t" });
  const configCreated = await adapter.createConfig({ Name: configName, Data: "cfg-data" });
  const secretListed = (await adapter.listSecrets()).some((s) => s.Spec?.Name === secretName);
  const configListed = (await adapter.listConfigs()).some((c) => c.Spec?.Name === configName);
  await purge();

  return {
    nodeCount,
    serviceId: service?.ID ?? null,
    created,
    scaled,
    stackDerived,
    removed,
    secretCreated,
    configCreated,
    secretListed,
    configListed,
  };
}

export interface LiveProbeApi {
  connectionMatrix(
    target: LiveProbeTarget,
    engine: ContainerEngine,
    host: ContainerEngineHost,
    shape: "remote" | "native" | "scoped",
  ): Promise<ConnectionMatrixObservation>;
  swarmLifecycle(
    target: LiveProbeTarget,
    engine: ContainerEngine,
    host: ContainerEngineHost,
  ): Promise<Awaited<ReturnType<typeof swarmLifecycle>>>;
  swarmManager(
    target: LiveProbeTarget,
    engine: ContainerEngine,
    host: ContainerEngineHost,
  ): Promise<Awaited<ReturnType<typeof swarmManager>>>;
}

// A probe that throws would surface in WebDriver as an opaque script error; wrap so the spec always receives
// a JSON verdict it can report.
function guard<A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error: any) {
      logger.error(`live probe ${name} failed`, error);
      throw new Error(`${name}: ${error?.message ?? error}`);
    }
  };
}

export function installLiveProbes() {
  (globalThis as { __cdLiveProbe?: LiveProbeApi }).__cdLiveProbe = {
    connectionMatrix: guard("connectionMatrix", connectionMatrix),
    swarmLifecycle: guard("swarmLifecycle", swarmLifecycle),
    swarmManager: guard("swarmManager", swarmManager),
  };
}
