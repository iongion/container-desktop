import type { CommandExecutionResult } from "@/host-contract/exec";
// runtimes/dialects/container.ts — AppleDialect: Apple `container` engine commands via socktainer.
//
// Apple's `container` engine speaks the Docker REST API via socktainer, so apiSurface is "docker".
// This dialect mirrors Docker's structure: socktainer socket (NOT raw DOCKER_HOST), a service the app starts
// (Apple's own, then socktainer), getSystemInfo best-effort via socktainer /info.

import type { EngineConnectorSettings } from "@/container-client/types/connection";
import { ContainerEngine } from "@/container-client/types/engine";
import { StartupStatus } from "@/container-client/types/host";
import type { SystemInfo } from "@/container-client/types/system";
import { APPLE_PROGRAM, SOCKTAINER_PROGRAM } from "../../connection";
import type { EngineDialect, EngineExtensionMethods, HostContext, ServiceSpec } from "../composition";
import type { CapabilityDescriptor } from "../facade";
import { DOCKER_SORT_CAPABILITIES } from "../sort-capabilities";
import { appleMachineCreateArgs, parseAppleMachineInspect, parseAppleMachines } from "./apple-machines";
import { parseJSON, readScopedHome, runScopedSocketCommand } from "./shared";

const SOCKTAINER_SOCKET_NAME = "container.sock";
const RESTART_SERVICE = "run `container system stop`, then `container system start`";

// `container system status --format json`: "running" with the CLI (client) and the running apiserver (server)
// versions, or only "unregistered" / "not running", printed with exit code 1.
export interface AppleSystemStatus {
  status: string;
  clientVersion?: string;
  serverVersion?: string;
}

interface AppleSystemStatusPayload {
  status?: unknown;
  client?: { version?: string };
  server?: { version?: string };
}

// Undefined when the CLI printed no status (not installed, or not Apple's).
export function parseAppleSystemStatus(stdout: string): AppleSystemStatus | undefined {
  const payload = parseJSON(`${stdout || ""}`.trim()) as AppleSystemStatusPayload | undefined;
  if (typeof payload?.status !== "string") {
    return undefined;
  }
  const status: AppleSystemStatus = { status: payload.status };
  if (payload.client?.version) {
    status.clientVersion = payload.client.version;
  }
  if (payload.server?.version) {
    status.serverVersion = payload.server.version;
  }
  return status;
}

// The connection's own `container`, on this computer or over the SSH scope.
async function runApple(
  host: HostContext,
  settings: EngineConnectorSettings,
  args: string[],
): Promise<CommandExecutionResult> {
  const program = settings.program?.path || settings.program?.name || APPLE_PROGRAM;
  return host.isScoped()
    ? await host.runScopeCommand(program, args, settings.controller?.scope || "", settings)
    : await host.runHostCommand(program, args, settings);
}

async function readAppleSystemStatus(
  host: HostContext,
  settings: EngineConnectorSettings,
): Promise<AppleSystemStatus | undefined> {
  const output = await runApple(host, settings, ["system", "status", "--format", "json"]);
  return parseAppleSystemStatus(output.stdout || "");
}

// The machines extension over `container machine` (apple-machines.ts holds the pure mappings).
function bindAppleMachines(
  host: HostContext,
): Pick<
  EngineExtensionMethods,
  | "getPodmanMachineInspect"
  | "getPodmanMachines"
  | "createPodmanMachine"
  | "removePodmanMachine"
  | "startPodmanMachine"
  | "stopPodmanMachine"
  | "restartPodmanMachine"
  | "connectToPodmanMachine"
> {
  const machine = async (args: string[]) => runApple(host, await host.getSettings(), ["machine", ...args]);
  // `run` boots a stopped machine; `true` makes it return at once.
  const start = async (name: string) => (await machine(["run", "-n", name, "true"])).success;
  return {
    getPodmanMachineInspect: async (name?: string) =>
      name ? parseAppleMachineInspect((await machine(["inspect", name])).stdout || "", name) : undefined,
    getPodmanMachines: async () => parseAppleMachines((await machine(["list", "--format", "json"])).stdout || ""),
    createPodmanMachine: async (opts) =>
      (await runApple(host, await host.getSettings(), appleMachineCreateArgs(opts))).success,
    removePodmanMachine: async (name: string) => {
      await machine(["stop", name]);
      return (await machine(["delete", name])).success;
    },
    startPodmanMachine: async (name: string) => ((await start(name)) ? StartupStatus.STARTED : StartupStatus.ERROR),
    stopPodmanMachine: async (name: string) => (await machine(["stop", name])).success,
    restartPodmanMachine: async (name: string) => {
      await machine(["stop", name]);
      return await start(name);
    },
    // The machine's login shell, with a TTY, in the user's terminal.
    connectToPodmanMachine: async (name: string, title?: string) => {
      const settings = await host.getSettings();
      const program = settings.program?.path || settings.program?.name || APPLE_PROGRAM;
      const output = await Platform.launchTerminal(program, ["machine", "run", "-i", "-t", "-n", name], {
        title: title || "Apple machine",
      });
      return output.success;
    },
  };
}

// What the socktainer socket serves: socktainer's own version (`/version` Components) and the running apiserver's
// (`/info` ServerVersion). Undefined when the socket does not answer.
async function readLiveBridge(host: HostContext): Promise<{ socktainer?: string; server?: string } | undefined> {
  try {
    const driver = await host.getApiDriver();
    const [version, info] = await Promise.all([
      driver.request<{ Components?: Array<{ Name?: string; Version?: string }> }>({
        method: "GET",
        url: "/version",
        timeout: 5000,
      }),
      driver.request<{ ServerVersion?: string }>({ method: "GET", url: "/info", timeout: 5000 }),
    ]);
    const components = Array.isArray(version?.data?.Components) ? version.data.Components : [];
    return {
      socktainer: components.find((component) => component?.Name === SOCKTAINER_PROGRAM)?.Version,
      server: info?.data?.ServerVersion,
    };
  } catch {
    return undefined;
  }
}

// Which part is down when the socket is silent, and its fix; undefined when the CLI cannot say.
function describeSilentBridge(status: AppleSystemStatus | undefined): string | undefined {
  switch (status?.status) {
    case undefined:
      return undefined;
    case "running":
      return "socktainer is not running: turn on auto-start for this connection, or start socktainer";
    case "unregistered":
      return "Apple's container service is not started: run `container system start`";
    default:
      return `Apple's container service is not answering: ${RESTART_SERVICE}`;
  }
}

// A failed command result used by the no-op extension methods on Apple.
function noopCommandResult(): CommandExecutionResult {
  return { pid: null, code: null, success: false, stdout: "", stderr: "" };
}

// `brew services start socktainer` runs it with a Homebrew-owned HOME, so its socket lives under the Homebrew prefix.
const HOMEBREW_SOCKTAINER_SOCKET = `/opt/homebrew/var/run/socktainer/.socktainer/${SOCKTAINER_SOCKET_NAME}`;

async function isSocketPresent(host: HostContext, settings: EngineConnectorSettings, path: string): Promise<boolean> {
  if (host.isScoped()) {
    return (await runScopedSocketCommand(host, settings, "test", ["-S", path])).success;
  }
  return await FS.isFilePresent(path);
}

// The user's own socktainer (the one the app starts) at `$HOME/.socktainer/container.sock`, the remote home over SSH;
// else Homebrew's service socket; else the user's, where the app starts one. NEVER raw DOCKER_HOST: on macOS it
// commonly points to a non-Apple daemon.
async function resolveSocktainerSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
  const home = (await readScopedHome(host, settings)) || (await Platform.getHomeDir());
  const own = `${home}/.socktainer/${SOCKTAINER_SOCKET_NAME}`;
  if (await isSocketPresent(host, settings, own)) {
    return own;
  }
  if (await isSocketPresent(host, settings, HOMEBREW_SOCKTAINER_SOCKET)) {
    return HOMEBREW_SOCKTAINER_SOCKET;
  }
  return own;
}

export const containerDialect: EngineDialect = {
  ENGINE: ContainerEngine.APPLE,
  apiSurface: "docker",

  capabilitiesBase: {
    resources: { pods: false, secrets: false, networks: true },
    events: true,
    pause: false,
    sort: DOCKER_SORT_CAPABILITIES,
    extensions: {
      // `container machine` — real on Apple native (the SSH profile turns it off).
      machines: true,
      kube: false,
      contexts: false,
      swarm: false,
      builders: false,
      // Through the Docker CLI's compose against the socktainer socket (adapters/compose.ts); a missing plugin fails
      // the deploy with a clear message, as on Docker, rather than the capability under-claiming.
      compose: true,
      registries: false,
      registryTrust: false,
      controllerVersion: false,
    },
  } satisfies CapabilityDescriptor,

  async readEngineSocket(host: HostContext, settings: EngineConnectorSettings): Promise<string> {
    return await resolveSocktainerSocket(host, settings);
  },

  async resolveNativeURISeed(_host: HostContext, _settings: EngineConnectorSettings): Promise<string> {
    // Apple seeds the socket from readEngineSocket, not an engine env var.
    return "";
  },

  // Apple's own service first, unless it runs already, by the connection's `container` and without the kernel prompt a
  // GUI app cannot answer. Then socktainer, the API the app talks to, supervised while the app runs; it never
  // auto-starts a service itself, because it would pick whichever `container` is first on PATH and refuses one other
  // than its pairing.
  async buildService(host: HostContext, settings: EngineConnectorSettings): Promise<ServiceSpec | null> {
    const socktainer = await host.findHostProgram({ name: SOCKTAINER_PROGRAM, path: "" }, settings);
    if (!socktainer?.path) {
      return null;
    }
    const service: ServiceSpec = { program: socktainer.path, args: ["--no-auto-start"] };
    const status = await readAppleSystemStatus(host, settings);
    if (status?.status !== "running") {
      service.prepare = { args: ["system", "start", "--enable-kernel-install"] };
    }
    return service;
  },

  async getSystemInfo(host: HostContext): Promise<SystemInfo> {
    // Best-effort via the socktainer /info endpoint (Docker REST surface). Resilient empty on failure.
    let info: SystemInfo = {} as SystemInfo;
    try {
      const driver = await host.getApiDriver();
      const response = await driver.request({ method: "GET", url: "/info", timeout: 5000 });
      if (response?.data) {
        info = response.data as SystemInfo;
      }
    } catch {
      host.logger.warn(host.id, "Unable to get Apple system info — continuing");
    }
    return info;
  },

  // Apple has no native Docker REST API — socktainer is the bridge. The availability report (host-client folds this
  // into report.api) names what the live socket serves, or, when it is silent, which part is down and its fix.
  async describeApiBridge(host: HostContext, settings: EngineConnectorSettings): Promise<string | undefined> {
    const live = await readLiveBridge(host);
    if (!live) {
      return describeSilentBridge(await readAppleSystemStatus(host, settings));
    }
    const note = `socktainer ${live.socktainer || "(version unknown)"} · container ${live.server || "(version unknown)"}`;
    const cli = settings.program?.version || "";
    if (cli && live.server && cli !== live.server) {
      return `${note} · the container CLI is ${cli}: ${RESTART_SERVICE}`;
    }
    return note;
  },

  bindExtensions(host: HostContext): EngineExtensionMethods {
    return {
      // Apple machines (`container machine`), REAL on Apple native
      ...bindAppleMachines(host),
      // Podman-domain groups — no-op on Apple
      generateKube: async () => noopCommandResult(),
      getPodLogs: async () => noopCommandResult(),

      // Docker-domain groups — no-op on Apple (no contexts/swarm/builders/compose)
      getDockerContexts: async () => [],
      inspectDockerContext: async () => undefined,
      useDockerContext: async () => false,
      getSwarmServices: async () => [],
      getSwarmNodes: async () => [],
      getSwarmStacks: async () => [],
      swarmInit: async () => false,
      swarmLeave: async () => false,
      getBuilders: async () => [],
      useBuilder: async () => false,
      getComposeProjects: async () => [],
      composeUp: async () => ({ created: [], recreated: [], unchanged: [], started: [], orphansRemoved: [] }),
      composeDown: async () => false,
    };
  },
};
