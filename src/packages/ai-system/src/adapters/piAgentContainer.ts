import type { ModelPricing } from "@/ai-system/adapters/modelWindow";
import {
  type AiSessionKind,
  type AiSessionRole,
  assistantContainerName,
  assistantFilterArgv,
  assistantLabelArgv,
  assistantNetworkName,
  defaultScope,
} from "@/ai-system/adapters/sessionNaming";
import type { ExecutionTarget } from "@/ai-system/core/executionTargets";
import { upstreamModelApi } from "@/ai-system/core/piAgentEnv";
import type { ProviderKind } from "@/ai-system/core/providers";
import type { DefaultSessionCandidate } from "@/ai-system/core/sessionLaunchers";
import type { AIAuthSettings } from "@/ai-system/core/types";
import { engineIsRemote } from "@/container-client/proxy-route";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { LOOPBACK_ADDRESS } from "@/container-client/runtimes/publishedPortHost";
import type { ContainerEngineHost } from "@/container-client/types/engine";
import { createLogger } from "@/logger";
import {
  AGENT_ENV_DIR_IN_IMAGE,
  AGENT_ENV_FILE_IN_IMAGE,
  PI_BRIDGE_PORT_IN_IMAGE,
  SESSIONS_DIR_IN_IMAGE,
} from "@/pi-bridge/image";
import type { PiModelReasoning } from "@/pi-bridge/protocol";
import { PI_SESSION_STORAGE_CONTAINER_PORT } from "@/pi-bridge/sessionStorage";

const logger = createLogger("ai.piAgentContainer");

const AGENT_DIR_IN_IMAGE = "/home/agent/.pi/agent";
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
  // The alternative to that mount, for an engine that cannot see this machine's filesystem: the port on THIS machine
  // that the container's conversation store answers on, so pi's session files are read and written here over the
  // storage RPC. Exclusive with `sessionsPath` — a pair either mounts the directory or asks for it, never both, or
  // two writers would share one file.
  storageHostPort?: number;
  hostPort: number;
  // Where the agent's environment is CARRIED for an engine that cannot be handed a file from this machine. `--env-file`
  // is read by the engine's client, so a path under this app's user data is one a remote engine has never seen — it
  // refuses the run before any container exists. Present, the same contents are written into this volume over the
  // engine's own stdin and the container is pointed at them. Absent is the env file, which is what a local engine gets.
  envVolumeName?: string;
  // The address the pair's published sockets must answer on, when the engine's own host is not where they land. An
  // engine running inside a machine publishes into THAT machine's network: measured on a real WSL one, nothing
  // published there reaches the Windows host running it, so the bridge is bound to the machine's own address instead —
  // which the host does reach, and which is a narrower bind than the loopback it replaces
  // (`container-client/runtimes/publishedPortHost`).
  // Absent — every engine that publishes where the app already dials — is the loopback bind that has always shipped.
  machineAddress?: string;
  bridgeToken: string;
  networkName: string;
  agentContainerName: string;
  pluginVolumeName: string;
  upstreamBaseUrl: string;
  // NO credential lives here, and none is written anywhere either. The session asks the APP for inference over the
  // bridge, and the app resolves the key from the OS keychain in the realm that owns it — so this spec carries only
  // catalogue facts.
  // The provider's catalog kind and connection auth: the kind decides the wire shape pi speaks, and the auth travels so
  // the container's own model registration reads the upstream the way pi would have (`piUpstreamCompat`).
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

// Whether a path this machine made can be mounted by that engine at all. False keeps the conversations where pi puts
// them, which is what every connection did before this mount existed: asking a remote engine for a path it has never
// seen makes the ENGINE create it, owned by root, and pi meets that as EACCES on the first turn.
//
// It is the remote engines that share no filesystem with this app, and `resolveGuestPath` returns a local path
// UNCHANGED for them on purpose — over SSH the workspace folder is one the remote machine already has — so a directory
// this app created here does not exist on the machine that would mount it. The Build studio draws the same line for a
// build context, and for the same reason.
export function engineSharesAppFilesystem(engineHost: ContainerEngineHost | undefined): boolean {
  return !engineIsRemote(engineHost);
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
  // Where the engine binds what it publishes. Its own loopback everywhere the app can dial that, and the machine's
  // address where the engine lives inside one — the bind is resolved in the ENGINE's realm, so a machine's address is
  // one of its own interfaces there.
  const bindAddress = spec.machineAddress ?? LOOPBACK_ADDRESS;
  return [
    "run",
    "--detach",
    "--name",
    spec.agentContainerName,
    "--network",
    spec.networkName,
    "--publish",
    `${bindAddress}:${spec.hostPort}:${PI_BRIDGE_PORT_IN_IMAGE}`,
    // The conversation store's own socket, published exactly as the bridge is. A second port rather than a second
    // channel on the first: pi's storage calls block the container's main thread, so their answers must arrive on a
    // socket that thread is not the one reading.
    ...(spec.storageHostPort
      ? ["--publish", `${bindAddress}:${spec.storageHostPort}:${PI_SESSION_STORAGE_CONTAINER_PORT}`]
      : []),
    "--volume",
    `${guestWorkspacePath}:/workspace`,
    "--volume",
    pluginVolumeMount(spec, AGENT_DIR_IN_IMAGE),
    ...(guestSessionsPath ? ["--volume", sessionsMount(guestSessionsPath)] : []),
    ...specLabelArgv(spec, "agent"),
    // One environment, two ways in. A file for an engine whose client can read this machine's filesystem; the same
    // contents in a session volume for one whose cannot, named so the container loads it itself.
    ...(spec.envVolumeName
      ? [
          "--volume",
          `${spec.envVolumeName}:${AGENT_ENV_DIR_IN_IMAGE}:ro`,
          "--env",
          `CD_ENV_FILE=${AGENT_ENV_FILE_IN_IMAGE}`,
        ]
      : ["--env-file", envFilePath]),
    ...userMappingArgv(spec.userMapping),
    spec.imageTag,
    "--mode",
    "agent",
  ];
}

// The volume the agent's environment is carried in. Unlabelled, deliberately: it is created and removed inside one
// start, and a label exists so a resource can be FOUND again later.
export function envVolumeCreateArgv(spec: PiAgentSessionSpec): string[] {
  return ["volume", "create", spec.envVolumeName ?? ""];
}

// Writing it with `tee` and stdin: no shell, no redirect, and nothing in the argv with a space in it. A redirect
// inside an argument (`sh -c "cat > …"`) would be executed by the REMOTE shell — every argument of a remote engine's
// command is joined by ssh and re-split over there — and the contents themselves must never be in argv at all, since
// the bridge token authorises both the socket and the proxy a turn's inference is signed through.
//
// `--user 0` because a volume is created owned by root and the image runs as `agent`; what it writes is readable
// inside a volume that only this session's own container mounts.
export function envWriteArgv(spec: PiAgentSessionSpec): string[] {
  return [
    "run",
    "--rm",
    "--interactive",
    "--user",
    "0",
    "--volume",
    `${spec.envVolumeName ?? ""}:${AGENT_ENV_DIR_IN_IMAGE}`,
    "--entrypoint",
    "tee",
    spec.imageTag,
    AGENT_ENV_FILE_IN_IMAGE,
  ];
}

// The agent's own network. `--internal` builds the bridge with no gateway address, so a container on it has no route
// anywhere else — neither the internet nor this machine. Inference is unaffected: it travels on the PUBLISHED bridge
// port, which the app dials INWARDS, and a published port answers on an internal network (measured, both engines). So
// `egress: false` is now total isolation rather than an asymmetry between two containers. It is a network-create flag:
// `run` rejects it outright.
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

// The names of the session the app REUSES for a connection, rather than an ephemeral one created per start. Derived
// from the connection so the next boot arrives at them without being told, and — being named under the current
// scheme rather than the legacy one — never mistaken for an orphan by the reaper.
export function defaultSessionNames(connectionId: string): {
  agentContainerName: string;
  networkName: string;
} {
  const scope = defaultScope(connectionId);
  return {
    agentContainerName: assistantContainerName("agent", scope),
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
// nothing to adopt here — which is what sends the boot down the create-or-ask path instead of the resume one. There is
// one container to find: inference goes over the bridge, so a session has no second half that could be missing.
export function defaultSessionFrom(
  connectionId: string,
  rows: readonly ContainerListingRow[],
): DefaultSessionCandidate | undefined {
  const names = defaultSessionNames(connectionId);
  const agent = rows.find((row) => row.name === names.agentContainerName);
  if (!agent) return undefined;
  return { connectionId, running: rowIsRunning(agent.state) };
}

function listingRows(output: string): ContainerListingRow[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return separator > 0
        ? { name: line.slice(0, separator).trim(), state: line.slice(separator + 1).trim() }
        : { name: line, state: "" };
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
  // `=` and not a tab, because every argument of a remote engine's command is joined by ssh and re-split by ITS shell:
  // the tab this used to carry split the template in two, the second half arrived as a name filter matching nothing,
  // and the engine answered an EMPTY listing with exit 0 — so every remote connection read as having nothing to adopt.
  // Measured. A name cannot contain `=`, and a state that carries spaces is fine: only the ARGV is re-split.
  const argv = [
    "ps",
    "--all",
    ...assistantFilterArgv({ kind: "default", connectionId }),
    "--format",
    "{{.Names}}={{.State}}",
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
  // The port THIS machine published for the pair's conversation store, when that pair was built to ask for its
  // history rather than mount it. Adopting one means serving that store again: the container's session is blocked on
  // the first storage call, so a pair adopted without it would hang on its first turn instead of failing.
  storageHostPort?: number;
}

// The engine's own inspection, whole. Asking for the two fields with `--format` would need `{{json .X}}`, and an argv
// element with a space in it is re-split by a REMOTE engine's shell — measured: podman answers `bad character U+007B`
// and the attach fails, so a running remote session could never be adopted. A few unread kilobytes are the cheaper
// half of that trade.
interface InspectedAgent {
  NetworkSettings?: { Ports?: Record<string, { HostPort?: string }[] | null> | null } | null;
  Config?: { Env?: string[] | null } | null;
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
  let inspected: InspectedAgent | undefined;
  try {
    // `inspect` answers an array of one; a single object is accepted too, so the parser is not the reason a dialect
    // that answers one way rather than the other has nothing to adopt.
    const parsed = JSON.parse(payload) as InspectedAgent | InspectedAgent[];
    inspected = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return undefined;
  }
  const ports = inspected?.NetworkSettings?.Ports;
  const hostPort = Number(ports?.[`${PI_BRIDGE_PORT_IN_IMAGE}/tcp`]?.[0]?.HostPort);
  const env = envOf(inspected?.Config?.Env ?? []);
  const bridgeToken = env.get("CD_BRIDGE_TOKEN");
  if (!bridgeToken || !Number.isInteger(hostPort) || hostPort <= 0) return undefined;
  const modelId = env.get("CD_MODEL_ID");
  const sessionsDir = env.get("CD_SESSION_DIR");
  // Read from the PUBLISHED port, not from the env var: the env only says the container listens, while what the app
  // has to dial is the mapping the engine actually made. A pair whose storage port is no longer published cannot be
  // served, whatever its environment claims.
  const storageHostPort = Number(ports?.[`${PI_SESSION_STORAGE_CONTAINER_PORT}/tcp`]?.[0]?.HostPort);
  const servesStorage = env.get("CD_SESSION_STORAGE_PORT") && Number.isInteger(storageHostPort) && storageHostPort > 0;
  return {
    hostPort,
    bridgeToken,
    ...(modelId ? { modelId } : {}),
    ...(sessionsDir ? { sessionsDir } : {}),
    ...(servesStorage ? { storageHostPort } : {}),
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
  const output = await run(host, ["inspect", agentContainerName], scope).catch((error) => {
    logger.debug(`inspecting ${agentContainerName} to attach failed`, error);
    return "";
  });
  return attachedPiAgentSessionFrom(output);
}

// A scoped engine (WSL, Lima, a podman machine) runs its CLI inside the guest, so every command goes
// through the scope wrapper and every host path is translated before it is mounted.
//
// `input` is stdin for the command, which the seam forwards to a remote engine's own process without it ever
// appearing in argv — the only way the agent's environment reaches a machine this app cannot write a file on.
async function run(host: HostClientFacade, args: string[], scope?: string, input?: string): Promise<string> {
  const execOpts = input === undefined ? undefined : { input };
  const result = scope
    ? await host.runScopeCommand(host.PROGRAM, args, scope, undefined, execOpts)
    : await host.runHostCommand(host.PROGRAM, args, undefined, execOpts);
  if (!result.success) throw new Error(result.stderr?.trim() || `engine command failed: ${args[0]}`);
  return (result.stdout ?? "").trim();
}

// Free the name this spec is about to ask the engine for. A reusable session's name is deterministic, so a container the
// user stopped — or one a crash left behind — still holds it, and `run` answers a name in use with a conflict rather
// than reusing it. Removing it is exactly what "rebuilt under the same name" means, and it costs nothing: the
// conversation lives on the user's machine, not in this container.
//
// A container that is still RUNNING is never touched. Continuing that one is `attachPiAgentSession`, and removing it
// here would be taking the user's live session away to make room for a new one.
async function freeSessionNames(host: HostClientFacade, spec: PiAgentSessionSpec): Promise<void> {
  // A name nothing holds makes the engine fail this, which is the answer: there is nothing to free.
  const state = await run(
    host,
    ["inspect", spec.agentContainerName, "--format", "{{.State.Running}}"],
    spec.scope,
  ).catch(() => "");
  if (!state.trim()) return;
  if (state.trim() === "true") {
    throw new Error(
      `${spec.agentContainerName} is already running — continue that session instead of starting another`,
    );
  }
  await run(host, ["rm", "--force", spec.agentContainerName], spec.scope).catch((error) => {
    logger.debug(`freeing the name ${spec.agentContainerName} failed`, error);
    return "";
  });
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
  // The env carries no credential at all, and there is no second file that does: the session asks the app for
  // inference, and the app resolves the key in the realm that owns the vault.
  const modelApi = upstreamModelApi(spec.providerKind);
  const agentEnv = composeAgentEnv(spec, modelApi);
  // One composition, delivered the only way each engine can take it: a file this app writes and the engine's client
  // reads, or — where that client is on another machine — the same text carried into a session volume over stdin.
  const agentEnvFile = spec.envVolumeName ? await carryAgentEnv(host, spec, agentEnv) : await writeEnvFile(agentEnv);
  let hostPort = spec.hostPort;
  for (let attempt = 1; ; attempt++) {
    try {
      const agentContainerId = await run(
        host,
        agentRunArgv({ ...spec, hostPort }, guestWorkspacePath, agentEnvFile, guestSessionsPath),
        spec.scope,
      );
      return { agentContainerId, hostPort };
    } catch (error) {
      if (attempt >= HOST_PORT_ATTEMPTS || !portAlreadyTaken(error)) throw error;
      // The engine can leave the container behind when only its port mapping failed, and the name goes with it.
      await run(host, ["rm", "--force", spec.agentContainerName], spec.scope).catch(() => "");
      logger.debug(`bridge port ${hostPort} was taken, trying another`);
      hostPort = pickHostPort();
    }
  }
}

// Into a volume the agent container mounts, over the engine's own stdin. Answers the path the container will read it
// at, so the caller cannot tell this apart from a file having been written.
async function carryAgentEnv(host: HostClientFacade, spec: PiAgentSessionSpec, contents: string): Promise<string> {
  await run(host, envVolumeCreateArgv(spec), spec.scope).catch((error) => {
    // Session-scoped, so an existing one is this session's own leftovers — and it is overwritten in the next step.
    if (!isExistingNameError(error)) throw error;
    logger.debug("the environment volume already existed", error);
    return "";
  });
  await run(host, envWriteArgv(spec), spec.scope, contents);
  return AGENT_ENV_FILE_IN_IMAGE;
}

// The agent's whole environment, in the app's one format. Composed apart from how it travels, so a file and a volume
// can never carry different things.
function composeAgentEnv(spec: PiAgentSessionSpec, modelApi: string): string {
  const lines = [
    `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
    `CD_BRIDGE_PORT=${PI_BRIDGE_PORT_IN_IMAGE}`,
    `CD_MODEL_API=${modelApi}`,
    // The upstream's own base URL, so pi speaks to it in the shape it wants rather than the shape it infers from our
    // own endpoint (`piUpstreamCompat`). NOT a credential — catalogue data, and nothing in this container can use it
    // without a key it has no way to get.
    `CD_UPSTREAM_BASE_URL=${spec.upstreamBaseUrl}`,
    `CD_MODEL_ID=${spec.modelId}`,
    // Present when the conversations reach this machine at all — mounted, or served over the storage RPC. Absent,
    // the container leaves pi to default its session dir under the agent dir, which is the plugin volume, so the
    // var is the one signal that history belongs somewhere that outlives this container. It names the same path
    // either way: under the RPC nothing of it exists on the container's own disk, and that is precisely why the
    // path can be the app's own choice rather than the remote machine's.
    ...(spec.sessionsPath || spec.storageHostPort ? [`CD_SESSION_DIR=${SESSIONS_DIR_IN_IMAGE}`] : []),
    // Set ONLY for the RPC. It is what makes the container install a storage port instead of touching its own
    // filesystem, so the two cases cannot both be live in one pair.
    ...(spec.storageHostPort ? [`CD_SESSION_STORAGE_PORT=${PI_SESSION_STORAGE_CONTAINER_PORT}`] : []),
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
  ];
  // Trailing newline: this is a file `--env-file` parses line by line, and the last line needs terminating like the
  // rest.
  return `${lines.join("\n")}\n`;
}

export async function stopPiAgentSession(host: HostClientFacade, spec: PiAgentSessionSpec): Promise<void> {
  await run(host, ["rm", "--force", spec.agentContainerName], spec.scope).catch((error) => {
    logger.debug(`rm ${spec.agentContainerName} failed`, error);
    return "";
  });
  // This session's environment, and nothing else's: it holds the bridge token, so it goes with the container that
  // was authorised by it rather than waiting for the next start to overwrite it.
  if (spec.envVolumeName) {
    await run(host, ["volume", "rm", "--force", spec.envVolumeName], spec.scope).catch((error) => {
      logger.debug("removing the environment volume failed", error);
      return "";
    });
  }
  // The network holds a /24 out of the engine's pool for as long as it exists.
  await run(host, ["network", "rm", spec.networkName], spec.scope).catch((error) => {
    logger.debug("network rm failed", error);
    return "";
  });
}
