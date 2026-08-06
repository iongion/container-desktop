import type { ModelPricing } from "@/ai-system/adapters/modelWindow";
import {
  type AiSessionKind,
  type AiSessionRole,
  assistantContainerName,
  assistantFilterArgv,
  assistantLabelArgv,
  assistantNetworkName,
  defaultScope,
  egressNetworkOf,
} from "@/ai-system/adapters/sessionNaming";
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import { composeGatewayEnv, gatewayBaseUrl, upstreamModelApi } from "@/ai-system/core/piAgentEnv";
import { isLoopbackProviderHost, type ProviderKind } from "@/ai-system/core/providers";
import type { DefaultSessionCandidate } from "@/ai-system/core/sessionLaunchers";
import type { AIAuthSettings } from "@/ai-system/core/types";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { ContainerEngineHost } from "@/container-client/types/engine";
import { createLogger } from "@/logger";
import type { PiModelReasoning } from "@/pi-bridge/protocol";

const logger = createLogger("ai.piAgentContainer");

const AGENT_DIR_IN_IMAGE = "/home/agent/.pi/agent";
// Where the conversations are mounted, and deliberately NOT under the agent dir: that directory IS the plugin volume,
// which is what tied a user's history to a container's volume in the first place. Kept outside it, the volume holds only
// SETUP — settings, packages, trust — and the conversations live wherever the mount points.
export const SESSIONS_DIR_IN_IMAGE = "/home/agent/.cd/sessions";
const BRIDGE_PORT_IN_IMAGE = 8787;
export const GATEWAY_PORT_IN_IMAGE = 8788;
// The uid/gid of the `agent` user baked into the image. Rootless podman maps the invoking host user to
// container root, so without a mapping the agent user cannot write to the bind-mounted workspace.
const AGENT_UID_IN_IMAGE = 1001;

// The labels for one half of a session, when the spec knows which session it belongs to. A spec composed before this
// scheme existed carries no identity, and its containers are created unlabelled — the reaper's legacy name matching
// is what still covers those.
function specLabelArgv(spec: PiAgentSessionSpec, role: AiSessionRole): string[] {
  if (!spec.connectionId) return [];
  return assistantLabelArgv({ kind: spec.sessionKind ?? "ephemeral", role, connectionId: spec.connectionId });
}

export interface PiAgentSessionSpec {
  imageTag: string;
  workspacePath: string;
  // Where the user's conversations live, on the HOST. Absent leaves pi defaulting them under the agent dir — which is
  // the plugin volume, so a stopped pair or an unreachable engine takes the history with it. Present, they are mounted
  // like the workspace and outlive every container.
  sessionsPath?: string;
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
  // Which session these containers belong to, recorded as labels so the app can find them again exactly. Absent on a
  // spec composed before the scheme existed: those containers are created unlabelled, and the reaper's name matching
  // is what still covers them.
  connectionId?: string;
  sessionKind?: AiSessionKind;
}

// Podman's `:U` chowns the volume's content to the mapped container user. Without it a plugin volume
// created under a previous mapping stays owned by the old uid and pi cannot write its session files —
// which surfaces as EACCES on the first turn, not at startup. Docker has no equivalent option.
export function pluginVolumeMount(spec: PiAgentSessionSpec, agentDir: string): string {
  const suffix = spec.userMapping.kind === "keep-id" ? ":U" : "";
  return `${spec.pluginVolumeName}:${agentDir}${suffix}`;
}

// The conversations mount is shaped like the WORKSPACE mount, not like the plugin volume: both are host directories,
// and podman's `:U` belongs to the volume case — a named volume created under an earlier mapping stays owned by the old
// uid. A directory this app creates under the user's own uid has no such history, and keep-id already maps that uid to
// the container's `agent` user. Measured against the real image: with keep-id the container reads a host file as 1001
// and its writes land back owned by the user, `:U` or not — so the flag only makes podman chown the user's entire
// history on every start.
export function sessionsMount(guestSessionsPath: string): string {
  return `${guestSessionsPath}:${SESSIONS_DIR_IN_IMAGE}`;
}

// The engine hosts that run their engine on a machine sharing no filesystem with this app. `resolveGuestPath` returns a
// local path UNCHANGED for these on purpose — over SSH the workspace folder is one the remote machine already has — so
// a directory this app created here does not exist on the machine that would mount it. The Build studio draws the same
// line for a build context, and for the same reason.
const REMOTE_ENGINE_HOSTS: ReadonlySet<ContainerEngineHost> = new Set([
  ContainerEngineHost.PODMAN_REMOTE,
  ContainerEngineHost.DOCKER_REMOTE,
  ContainerEngineHost.APPLE_REMOTE,
]);

// Whether a path this machine made can be mounted by that engine at all. False keeps the conversations where pi puts
// them, which is what every connection did before this mount existed: asking a remote engine for a path it has never
// seen makes the ENGINE create it, owned by root, and pi meets that as EACCES on the first turn. A host nothing is
// known about keeps the mount, so only a KNOWN remote withholds it.
export function engineSharesAppFilesystem(engineHost: ContainerEngineHost | undefined): boolean {
  return !engineHost || !REMOTE_ENGINE_HOSTS.has(engineHost);
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

// `guestSessionsPath` is the conversations directory, already translated for the engine the way the workspace is —
// history belongs to the user, so it is mounted from where the workspace comes from rather than left in the volume a
// stopped pair takes with it. Omitted, nothing is mounted and pi keeps defaulting under the agent dir, which is exactly
// today's behaviour.
export function agentRunArgv(
  spec: PiAgentSessionSpec,
  guestWorkspacePath: string,
  envFilePath: string,
  guestSessionsPath?: string,
): string[] {
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
    ...(guestSessionsPath ? ["--volume", sessionsMount(guestSessionsPath)] : []),
    ...specLabelArgv(spec, "agent"),
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
  return [
    "network",
    "create",
    ...(spec.egress ? [] : ["--internal"]),
    // Labelled like the containers it joins, so a network belongs to the same group at the same level.
    ...specLabelArgv(spec, "agent"),
    spec.networkName,
  ];
}

// The second network, which exists only when egress is off. The gateway still has to reach the provider, so it is
// given a routable NIC the agent does not have — that asymmetry IS "only the gateway is reachable".
export function egressNetworkName(spec: PiAgentSessionSpec): string {
  return egressNetworkOf(spec.networkName);
}

// The names of the session the app REUSES for a connection, rather than an ephemeral one created per start. Derived
// from the connection so the next boot arrives at them without being told, and — being named under the current
// scheme rather than the legacy one — never mistaken for an orphan by the reaper.
export function defaultSessionNames(connectionId: string): {
  agentContainerName: string;
  gatewayContainerName: string;
  networkName: string;
} {
  const scope = defaultScope(connectionId);
  return {
    agentContainerName: assistantContainerName("agent", scope),
    gatewayContainerName: assistantContainerName("gateway", scope),
    networkName: assistantNetworkName(scope),
  };
}

// One row of the engine's container listing, as this module asks for it.
export interface ContainerListingRow {
  name: string;
  state: string;
}

// Engines disagree about the state field: podman and docker answer `running` / `exited` for `{{.State}}`, while a
// dialect that fills it with a status line answers `Up 3 minutes`. Both mean the same thing.
function rowIsRunning(state: string): boolean {
  const value = state.trim().toLowerCase();
  return value.startsWith("running") || value.startsWith("up");
}

// What this connection's reusable session looks like right now, read off the engine's listing. Absent means there is
// nothing to adopt here — which is what sends the boot down the create-or-ask path instead of the resume one. The
// pair is the unit: one half running is not a session, because the agent cannot reach a model without its gateway.
export function defaultSessionFrom(
  connectionId: string,
  rows: readonly ContainerListingRow[],
): DefaultSessionCandidate | undefined {
  const names = defaultSessionNames(connectionId);
  const agent = rows.find((row) => row.name === names.agentContainerName);
  const gateway = rows.find((row) => row.name === names.gatewayContainerName);
  if (!agent && !gateway) return undefined;
  const complete = !!agent && !!gateway;
  return {
    connectionId,
    complete,
    running: complete && rowIsRunning(agent.state) && rowIsRunning(gateway.state),
  };
}

function listingRows(output: string): ContainerListingRow[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split("\t");
      return { name: name.trim(), state: rest.join("\t") };
    });
}

// Discovery runs at boot against an engine that may be asleep, unreachable or simply not there. Anything it cannot
// answer means "no session to adopt" — never a startup failure.
export async function findDefaultSession(
  host: HostClientFacade,
  connectionId: string,
  scope?: string,
): Promise<DefaultSessionCandidate | undefined> {
  // The engine does the selecting, by label: exact identity, and one small answer instead of every container on the
  // machine. A session created before the labels existed is not adopted — it is an ephemeral one, and the reaper's
  // legacy patterns are what deal with those.
  const argv = [
    "ps",
    "--all",
    ...assistantFilterArgv({ kind: "default", connectionId }),
    "--format",
    "{{.Names}}\t{{.State}}",
  ];
  const listing = await run(host, argv, scope).catch((error) => {
    logger.debug(`discovering the default session on ${connectionId} failed`, error);
    return "";
  });
  return defaultSessionFrom(connectionId, listingRows(listing));
}

// What a pair that is ALREADY RUNNING can be dialled with. Read off the engine rather than remembered: the app may
// have been closed since the session started, and nothing about it was persisted.
export interface AttachedPiAgentSession {
  hostPort: number;
  bridgeToken: string;
  // The model the pair was started with, as its own environment records it. The session says what it is actually
  // answering with when it announces itself; this is what fills the spec until then.
  modelId?: string;
  // The conversations directory the pair was BUILT with, as a path inside the container. Its presence is the proof
  // that this pair mounts its history from the host at all — `CD_SESSION_DIR` and the second `--volume` are emitted
  // from the same field, so one cannot be there without the other. A pair built before the mount existed reports
  // nothing, and its history is still in the plugin volume.
  sessionsDir?: string;
}

// One inspection asked for as JSON, so the two things that matter arrive in one call and neither is scraped out of a
// tab-separated line: the port the bridge is published on, and the token that authorises it.
const ATTACH_FORMAT = '{"ports":{{json .NetworkSettings.Ports}},"env":{{json .Config.Env}}}';

interface InspectedAgent {
  ports?: Record<string, { HostPort?: string }[] | null> | null;
  env?: string[] | null;
}

// An env line is `KEY=VALUE`, and a VALUE may contain the separator — a token is opaque. Splitting on the FIRST one is
// what keeps it whole.
function envOf(lines: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

// Pure, so the parsing is settled by fixtures rather than by a live container. Anything missing means there is nothing
// to adopt: without the published port there is no socket to dial, and without the token it would refuse us.
export function attachedPiAgentSessionFrom(payload: string): AttachedPiAgentSession | undefined {
  let inspected: InspectedAgent;
  try {
    inspected = JSON.parse(payload) as InspectedAgent;
  } catch {
    return undefined;
  }
  const hostPort = Number(inspected?.ports?.[`${BRIDGE_PORT_IN_IMAGE}/tcp`]?.[0]?.HostPort);
  const env = envOf(inspected?.env ?? []);
  const bridgeToken = env.get("CD_BRIDGE_TOKEN");
  if (!bridgeToken || !Number.isInteger(hostPort) || hostPort <= 0) return undefined;
  const modelId = env.get("CD_MODEL_ID");
  const sessionsDir = env.get("CD_SESSION_DIR");
  return {
    hostPort,
    bridgeToken,
    ...(modelId ? { modelId } : {}),
    ...(sessionsDir ? { sessionsDir } : {}),
  };
}

// Adopt the pair that is already up. `run` would refuse — the names are taken — and taking them back would mean
// removing the user's containers, which this app promises never to do. So continuing dials what is there instead.
// Absent means nothing to adopt: the pair may have gone between the listing and the click, which is an answer.
export async function attachPiAgentSession(
  host: HostClientFacade,
  agentContainerName: string,
  scope?: string,
): Promise<AttachedPiAgentSession | undefined> {
  const output = await run(host, ["inspect", agentContainerName, "--format", ATTACH_FORMAT], scope).catch((error) => {
    logger.debug(`inspecting ${agentContainerName} to attach failed`, error);
    return "";
  });
  return attachedPiAgentSessionFrom(output);
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
    ...specLabelArgv(spec, "gateway"),
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

// Free the two names this spec is about to ask the engine for. A reusable session's names are deterministic, so a pair
// the user stopped — or half a pair a crash left behind — still holds them, and `run` answers a name in use with a
// conflict rather than reusing it. Removing them is exactly what "rebuilt under the same names" means, and it costs
// nothing: the conversation lives in the plugin volume, not in these containers.
//
// A pair that is still RUNNING is never touched. Continuing that one is `attachPiAgentSession`, and removing it here
// would be taking the user's live session away to make room for a new one.
async function freeSessionNames(host: HostClientFacade, spec: PiAgentSessionSpec): Promise<void> {
  for (const name of [spec.gatewayContainerName, spec.agentContainerName]) {
    // A name nothing holds makes the engine fail this, which is the answer: there is nothing to free.
    const state = await run(host, ["inspect", name, "--format", "{{.State.Running}}"], spec.scope).catch(() => "");
    if (!state.trim()) continue;
    if (state.trim() === "true") {
      throw new Error(`${name} is already running — continue that session instead of starting another`);
    }
    await run(host, ["rm", "--force", name], spec.scope).catch((error) => {
      logger.debug(`freeing the name ${name} failed`, error);
      return "";
    });
  }
}

// The engines' several ways of saying "that name is taken". Everything else a create can fail with — an exhausted
// address pool above all — has to travel, because the caller's next command fails for a reason that reads nothing
// like the real one.
function isExistingNameError(error: unknown): boolean {
  return /already exists|already in use|already used/i.test(`${(error as Error)?.message ?? error}`);
}

export async function startPiAgentSession(
  host: HostClientFacade,
  spec: PiAgentSessionSpec,
  writeEnvFile: (contents: string) => Promise<string>,
  // The provider key lives in the OS keychain, which only the host can read, so the host writes the gateway's
  // env file. When it has, that file is used as-is — composing a second one here would carry an empty key.
  options?: { gatewayEnvFile?: () => Promise<string> },
): Promise<PiAgentSessionContainers> {
  await freeSessionNames(host, spec);
  const toGuestPath = async (hostPath: string) =>
    spec.scope ? await host.resolveGuestPath(hostPath, spec.scope) : hostPath;
  const guestWorkspacePath = await toGuestPath(spec.workspacePath);
  // The conversations directory goes through the SAME translation as the workspace, which is what lets history come
  // from where the workspace comes from on every engine the app supports rather than needing a local/remote branch.
  const guestSessionsPath = spec.sessionsPath ? await toGuestPath(spec.sessionsPath) : undefined;

  await run(host, networkCreateArgv(spec), spec.scope).catch((error) => {
    // A name already taken is not an error: it is session-scoped, so a retry finds its own leftovers from a crashed
    // run. Anything else IS one, and swallowing it costs the reader the answer — an exhausted address pool caught
    // here comes back moments later as `run` reporting the network does not exist, which sends them looking for a
    // missing network instead of for the reason it could not be made.
    if (!isExistingNameError(error)) throw error;
    logger.debug("network create skipped — the name is already taken", error);
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
      // Present only when the conversations directory was actually mounted. Absent, the container leaves pi to default
      // its session dir under the agent dir, which is today's behaviour — so the var is the one signal that history
      // belongs somewhere that outlives this container.
      ...(spec.sessionsPath ? [`CD_SESSION_DIR=${SESSIONS_DIR_IN_IMAGE}`] : []),
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
        agentRunArgv({ ...spec, hostPort }, guestWorkspacePath, agentEnvFile, guestSessionsPath),
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
