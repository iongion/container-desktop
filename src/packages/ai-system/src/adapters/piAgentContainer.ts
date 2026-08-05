import type { ModelPricing } from "@/ai-system/adapters/modelWindow";
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import { composeGatewayEnv, gatewayBaseUrl, upstreamModelApi } from "@/ai-system/core/piAgentEnv";
import { isLoopbackProviderHost, type ProviderKind } from "@/ai-system/core/providers";
import type { AIAuthSettings } from "@/ai-system/core/types";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";
import type { PiModelReasoning } from "@/pi-bridge/protocol";

const logger = createLogger("ai.piAgentContainer");

const AGENT_DIR_IN_IMAGE = "/home/agent/.pi/agent";
const BRIDGE_PORT_IN_IMAGE = 8787;
export const GATEWAY_PORT_IN_IMAGE = 8788;
// The uid/gid of the `agent` user baked into the image. Rootless podman maps the invoking host user to
// container root, so without a mapping the agent user cannot write to the bind-mounted workspace.
const AGENT_UID_IN_IMAGE = 1001;

export interface PiAgentSessionSpec {
  imageTag: string;
  workspacePath: string;
  hostPort: number;
  bridgeToken: string;
  networkName: string;
  agentContainerName: string;
  gatewayContainerName: string;
  pluginVolumeName: string;
  upstreamBaseUrl: string;
  // NO credential lives here, deliberately. This spec is composed in the renderer, which cannot read the OS keychain
  // and must never hold a key: a gateway that needs one is handed an env file the HOST wrote, and the only thing
  // that crosses back is its path. What remains for this module to compose is the keyless case.
  // The provider's catalog kind and connection auth. They decide the wire shape pi speaks and the credential
  // header the gateway signs — an Anthropic upstream wants /v1/messages and x-api-key, not a bearer token on
  // /v1/chat/completions.
  providerKind: ProviderKind;
  upstreamAuth: AIAuthSettings;
  modelId: string;
  // What the PROVIDER said about this model, when it says anything. Absent means unknown, and unknown is reported as
  // unknown — the session used to register an invented 128000/4096 for every model on every server.
  contextWindow?: number;
  maxOutputTokens?: number;
  // What the provider charges, per million tokens. Absent for a free or unpriced model — pi already defaults every
  // rate to zero, which is why a session used to report $0.00 whatever it actually cost.
  pricing?: ModelPricing;
  // Whether the model the session starts on reasons, and how hard it may be asked to. Absent means nobody published
  // it, and the session then offers no thinking level rather than one the provider would ignore.
  reasoning?: PiModelReasoning;
  egress: boolean;
  // Where the session's workspace tools run, when the user chose somewhere. Absent means the toolset is not offered
  // at all — the container is told only THAT it exists, never where, because the app is what resolves the target.
  executionTarget?: ExecutionTarget;
  // The DNS name that resolves to THIS machine from inside a container on this engine — podman's
  // host.containers.internal, docker's host.docker.internal. A provider running on the host (LM Studio,
  // llama.cpp) is only reachable through it.
  hostAlias: string;
  scope?: string;
  // How to map the container's agent user onto the host user so workspace writes land with the right
  // ownership. Podman rootless uses keep-id; Docker needs an explicit --user, which requires knowing the
  // host uid/gid.
  userMapping: { kind: "keep-id" } | { kind: "user"; uid: number; gid: number } | { kind: "none" };
}

// Podman's `:U` chowns the volume's content to the mapped container user. Without it a plugin volume
// created under a previous mapping stays owned by the old uid and pi cannot write its session files —
// which surfaces as EACCES on the first turn, not at startup. Docker has no equivalent option.
export function pluginVolumeMount(spec: PiAgentSessionSpec, agentDir: string): string {
  const suffix = spec.userMapping.kind === "keep-id" ? ":U" : "";
  return `${spec.pluginVolumeName}:${agentDir}${suffix}`;
}

export function userMappingArgv(mapping: PiAgentSessionSpec["userMapping"]): string[] {
  switch (mapping.kind) {
    case "keep-id":
      return ["--userns", `keep-id:uid=${AGENT_UID_IN_IMAGE},gid=${AGENT_UID_IN_IMAGE}`];
    case "user":
      return ["--user", `${mapping.uid}:${mapping.gid}`];
    case "none":
      return [];
  }
}

export interface PiAgentSessionContainers {
  agentContainerId: string;
  gatewayContainerId: string;
  // The port the agent's bridge ENDED UP on. A published port cannot be reserved, so a taken one is re-picked
  // here and the caller has to dial what it settled on rather than what it asked for.
  hostPort: number;
}

// Random, and deliberately not probed for: a free port at probe time can be taken by the time the container runs,
// so the engine's own refusal is the only reliable signal. This range holds real servers on a developer's machine
// (LM Studio listens inside it), which is why one attempt is not enough.
export function pickHostPort(): number {
  return 41000 + Math.floor(Math.random() * 4000);
}

const HOST_PORT_ATTEMPTS = 5;

function portAlreadyTaken(error: unknown): boolean {
  // podman's rootlessport and docker's proxy word it differently; both say "already in use"/"already allocated".
  return /address already in use|already allocated/i.test(`${(error as Error)?.message ?? error}`);
}

export function agentRunArgv(spec: PiAgentSessionSpec, guestWorkspacePath: string, envFilePath: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    spec.agentContainerName,
    "--network",
    spec.networkName,
    "--publish",
    `127.0.0.1:${spec.hostPort}:${BRIDGE_PORT_IN_IMAGE}`,
    "--volume",
    `${guestWorkspacePath}:/workspace`,
    "--volume",
    pluginVolumeMount(spec, AGENT_DIR_IN_IMAGE),
    "--env-file",
    envFilePath,
    ...userMappingArgv(spec.userMapping),
    spec.imageTag,
    "--mode",
    "agent",
  ];
}

// The agent's own network, and the only one it is ever attached to. `--internal` builds the bridge with no gateway
// address, so a container on it resolves and reaches its siblings by name and has no route anywhere else — neither
// the internet nor this machine. It is a network-create flag: `run` rejects it outright.
export function networkCreateArgv(spec: PiAgentSessionSpec): string[] {
  return ["network", "create", ...(spec.egress ? [] : ["--internal"]), spec.networkName];
}

// The second network, which exists only when egress is off. The gateway still has to reach the provider, so it is
// given a routable NIC the agent does not have — that asymmetry IS "only the gateway is reachable".
export function egressNetworkName(spec: PiAgentSessionSpec): string {
  return `${spec.networkName}-egress`;
}

// Attached after the gateway is running, so it keeps the internal network as its first: the agent addresses the
// gateway by container name, which only resolves on the network they share.
export function egressAttachArgv(spec: PiAgentSessionSpec): string[] {
  return ["network", "connect", egressNetworkName(spec), spec.gatewayContainerName];
}

function upstreamIsOnThisMachine(spec: PiAgentSessionSpec): boolean {
  try {
    return isLoopbackProviderHost(new URL(spec.upstreamBaseUrl).hostname);
  } catch {
    return false;
  }
}

// The gateway dials the provider from INSIDE a container, where 127.0.0.1 is the container itself. A provider
// on this machine therefore has to be addressed by the engine's host alias — otherwise a local LM Studio or
// llama.cpp server is simply unreachable and every turn fails on connect.
export function gatewayUpstreamUrl(spec: PiAgentSessionSpec): string {
  if (!upstreamIsOnThisMachine(spec)) {
    return spec.upstreamBaseUrl;
  }
  const url = new URL(spec.upstreamBaseUrl);
  url.hostname = spec.hostAlias;
  return url.toString().replace(/\/$/, spec.upstreamBaseUrl.endsWith("/") ? "/" : "");
}

// Neither engine guarantees the alias resolves on a user-defined network, so it is mapped explicitly.
// `host-gateway` is understood by both podman and docker.
export function hostAliasArgv(spec: PiAgentSessionSpec): string[] {
  return upstreamIsOnThisMachine(spec) ? ["--add-host", `${spec.hostAlias}:host-gateway`] : [];
}

export function gatewayRunArgv(spec: PiAgentSessionSpec, envFilePath: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    spec.gatewayContainerName,
    "--network",
    spec.networkName,
    ...hostAliasArgv(spec),
    "--env-file",
    envFilePath,
    spec.imageTag,
    "--mode",
    "gateway",
  ];
}

// A scoped engine (WSL, Lima, a podman machine) runs its CLI inside the guest, so every command goes
// through the scope wrapper and every host path is translated before it is mounted.
async function run(host: HostClientFacade, args: string[], scope?: string): Promise<string> {
  const result = scope
    ? await host.runScopeCommand(host.PROGRAM, args, scope)
    : await host.runHostCommand(host.PROGRAM, args);
  if (!result.success) throw new Error(result.stderr?.trim() || `engine command failed: ${args[0]}`);
  return (result.stdout ?? "").trim();
}

export async function startPiAgentSession(
  host: HostClientFacade,
  spec: PiAgentSessionSpec,
  writeEnvFile: (contents: string) => Promise<string>,
  // The provider key lives in the OS keychain, which only the host can read, so the host writes the gateway's
  // env file. When it has, that file is used as-is — composing a second one here would carry an empty key.
  options?: { gatewayEnvFile?: () => Promise<string> },
): Promise<PiAgentSessionContainers> {
  const guestWorkspacePath = spec.scope
    ? await host.resolveGuestPath(spec.workspacePath, spec.scope)
    : spec.workspacePath;

  await run(host, networkCreateArgv(spec), spec.scope).catch((error) => {
    // A pre-existing network is not an error: the name is session-scoped, so a retry can find its own
    // leftovers from a crashed run.
    logger.debug("network create skipped", error);
    return "";
  });
  if (!spec.egress) {
    await run(host, ["network", "create", egressNetworkName(spec)], spec.scope).catch((error) => {
      logger.debug("egress network create skipped", error);
      return "";
    });
  }

  const gatewayEnvFile = options?.gatewayEnvFile
    ? await options.gatewayEnvFile()
    : await writeEnvFile(
        composeGatewayEnv({
          baseUrl: gatewayUpstreamUrl(spec),
          // Empty because this branch IS the keyless case: a local model server wants no credential, and no key can
          // reach here. Anything that needs one arrived as `options.gatewayEnvFile`, written by the host.
          apiKey: "",
          bridgeToken: spec.bridgeToken,
          gatewayPort: GATEWAY_PORT_IN_IMAGE,
          providerKind: spec.providerKind,
          auth: spec.upstreamAuth,
        }),
      );
  const gatewayContainerId = await run(host, gatewayRunArgv(spec, gatewayEnvFile), spec.scope);
  if (!spec.egress) {
    // NOT tolerated the way a pre-existing network is: without this the gateway has no route to the provider at
    // all, and a session that starts anyway fails on its first turn with a connect error instead.
    await run(host, egressAttachArgv(spec), spec.scope);
  }

  // The agent's env file deliberately omits the provider key: plugin code runs in this container.
  const modelApi = upstreamModelApi(spec.providerKind);
  const agentEnvFile = await writeEnvFile(
    [
      `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
      `CD_BRIDGE_PORT=${BRIDGE_PORT_IN_IMAGE}`,
      `CD_GATEWAY_URL=${gatewayBaseUrl(`http://${spec.gatewayContainerName}:${GATEWAY_PORT_IN_IMAGE}`, modelApi)}`,
      `CD_MODEL_API=${modelApi}`,
      // The upstream's own base URL, so pi speaks to it in the shape it wants rather than the shape it infers from
      // our gateway (`piUpstreamCompat`). NOT a credential — catalogue data, useless without the key the gateway
      // holds — and the same var name the gateway's own env file uses for the same value.
      `CD_UPSTREAM_BASE_URL=${spec.upstreamBaseUrl}`,
      `CD_MODEL_ID=${spec.modelId}`,
      // Omitted entirely when the provider did not say, so the container can tell "unknown" from "zero".
      ...(spec.contextWindow ? [`CD_MODEL_CONTEXT_WINDOW=${spec.contextWindow}`] : []),
      ...(spec.maxOutputTokens ? [`CD_MODEL_MAX_OUTPUT_TOKENS=${spec.maxOutputTokens}`] : []),
      // Each rate is omitted when the provider published none, so the container can tell an unpriced model from a
      // free one and pi's own zeroes stand only where they are true.
      ...(spec.pricing?.input ? [`CD_MODEL_COST_INPUT=${spec.pricing.input}`] : []),
      ...(spec.pricing?.output ? [`CD_MODEL_COST_OUTPUT=${spec.pricing.output}`] : []),
      ...(spec.pricing?.cacheRead ? [`CD_MODEL_COST_CACHE_READ=${spec.pricing.cacheRead}`] : []),
      ...(spec.pricing?.cacheWrite ? [`CD_MODEL_COST_CACHE_WRITE=${spec.pricing.cacheWrite}`] : []),
      // The capability is the flag; the efforts and the model that cannot stop reasoning are detail beside it. All
      // three are omitted for a model nobody published reasoning for, which is what keeps pi's `false` honest.
      ...(spec.reasoning ? ["CD_MODEL_REASONING=1"] : []),
      ...(spec.reasoning?.levels?.length ? [`CD_MODEL_REASONING_LEVELS=${spec.reasoning.levels.join(",")}`] : []),
      ...(spec.reasoning?.mandatory ? ["CD_MODEL_REASONING_MANDATORY=1"] : []),
      // The FLAG only: the workspace toolset exists for this session. Where its operations land is the app's to
      // resolve, and a container that knew the target could do nothing with it but leak it.
      ...(spec.executionTarget ? ["CD_WORKSPACE_TOOLS=1"] : []),
      "CD_WORKSPACE=/workspace",
      `CD_AGENT_DIR=${AGENT_DIR_IN_IMAGE}`,
    ].join("\n"),
  );
  let hostPort = spec.hostPort;
  for (let attempt = 1; ; attempt++) {
    try {
      const agentContainerId = await run(
        host,
        agentRunArgv({ ...spec, hostPort }, guestWorkspacePath, agentEnvFile),
        spec.scope,
      );
      return { agentContainerId, gatewayContainerId, hostPort };
    } catch (error) {
      if (attempt >= HOST_PORT_ATTEMPTS || !portAlreadyTaken(error)) throw error;
      // The engine can leave the container behind when only its port mapping failed, and the name goes with it.
      await run(host, ["rm", "--force", spec.agentContainerName], spec.scope).catch(() => "");
      logger.debug(`bridge port ${hostPort} was taken, trying another`);
      hostPort = pickHostPort();
    }
  }
}

// A session's name is the only evidence a later app run has that a container was ours, so the patterns are strict:
// the suffix is the first 8 characters of a UUID. `cd-agent-mine` is the user's, and the shared plugin VOLUME is
// never in scope — it holds what they installed.
const SESSION_SUFFIX = "[0-9a-f]{8}";
// `login` is swept the same way: a sign-in container holds a published port and keeps listening until it is removed,
// so one left behind by a crash is exactly the orphan this reaper exists for.
const SESSION_CONTAINER = new RegExp(`^cd-(agent|gateway|login)-${SESSION_SUFFIX}$`);
const SESSION_NETWORK = new RegExp(`^cd-agent-net-${SESSION_SUFFIX}(-egress)?$`);

function matching(output: string, pattern: RegExp): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => pattern.test(name));
}

// Remove every session container and network on this engine that no longer belongs to a running session.
//
// Called at startup, where the question answers itself: a pi session lives only as long as the app holds its bridge
// client, so anything still standing when the app boots was orphaned by a crash or a force-quit. Each orphan holds a
// published port, and each network a /24 out of the engine's pool — around sixteen of them and podman refuses to
// create another, which surfaces as "IPAM error: failed to get ips for container" on a session that did nothing
// wrong. Housekeeping, so an engine that refuses is reported and never raised: the app must still start.
export async function reapOrphanPiAgentSessions(
  host: HostClientFacade,
  scope?: string,
): Promise<{ containers: string[]; networks: string[] }> {
  const reaped: { containers: string[]; networks: string[] } = { containers: [], networks: [] };
  const containers = await run(host, ["ps", "--all", "--format", "{{.Names}}"], scope).catch(() => "");
  for (const name of matching(containers, SESSION_CONTAINER)) {
    const removed = await run(host, ["rm", "--force", name], scope).then(
      () => true,
      (error) => {
        logger.debug(`reaping ${name} failed`, error);
        return false;
      },
    );
    if (removed) reaped.containers.push(name);
  }
  // After the containers: a network still in use cannot be removed.
  const networks = await run(host, ["network", "ls", "--format", "{{.Name}}"], scope).catch(() => "");
  for (const name of matching(networks, SESSION_NETWORK)) {
    const removed = await run(host, ["network", "rm", name], scope).then(
      () => true,
      (error) => {
        logger.debug(`reaping network ${name} failed`, error);
        return false;
      },
    );
    if (removed) reaped.networks.push(name);
  }
  if (reaped.containers.length || reaped.networks.length) {
    logger.info(`reaped ${reaped.containers.length} orphaned session containers, ${reaped.networks.length} networks`);
  }
  return reaped;
}

export async function stopPiAgentSession(host: HostClientFacade, spec: PiAgentSessionSpec): Promise<void> {
  for (const name of [spec.agentContainerName, spec.gatewayContainerName]) {
    await run(host, ["rm", "--force", name], spec.scope).catch((error) => {
      logger.debug(`rm ${name} failed`, error);
      return "";
    });
  }
  // Both networks a no-egress session created, each of which holds a /24 out of the engine's pool.
  const networks = spec.egress ? [spec.networkName] : [spec.networkName, egressNetworkName(spec)];
  for (const network of networks) {
    await run(host, ["network", "rm", network], spec.scope).catch((error) => {
      logger.debug("network rm failed", error);
      return "";
    });
  }
}
