import { composeGatewayEnv, gatewayBaseUrl, upstreamModelApi } from "@/ai-system/core/piAgentEnv";
import { isLoopbackProviderHost, type ProviderKind } from "@/ai-system/core/providers";
import type { AIAuthSettings } from "@/ai-system/core/types";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";

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
  // The provider key. It reaches the gateway container through an env file and must never appear in argv.
  // Passed in rather than read from the environment: this module runs in the renderer, where there is no
  // process.env.
  upstreamApiKey: string;
  // The provider's catalog kind and connection auth. They decide the wire shape pi speaks and the credential
  // header the gateway signs — an Anthropic upstream wants /v1/messages and x-api-key, not a bearer token on
  // /v1/chat/completions.
  providerKind: ProviderKind;
  upstreamAuth: AIAuthSettings;
  modelId: string;
  egress: boolean;
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
    ...(spec.egress ? [] : ["--internal"]),
    spec.imageTag,
    "--mode",
    "agent",
  ];
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

  await run(host, ["network", "create", spec.networkName], spec.scope).catch((error) => {
    // A pre-existing network is not an error: the name is session-scoped, so a retry can find its own
    // leftovers from a crashed run.
    logger.debug("network create skipped", error);
    return "";
  });

  const gatewayEnvFile = options?.gatewayEnvFile
    ? await options.gatewayEnvFile()
    : await writeEnvFile(
        composeGatewayEnv({
          baseUrl: gatewayUpstreamUrl(spec),
          apiKey: spec.upstreamApiKey,
          bridgeToken: spec.bridgeToken,
          gatewayPort: GATEWAY_PORT_IN_IMAGE,
          providerKind: spec.providerKind,
          auth: spec.upstreamAuth,
        }),
      );
  const gatewayContainerId = await run(host, gatewayRunArgv(spec, gatewayEnvFile), spec.scope);

  // The agent's env file deliberately omits the provider key: plugin code runs in this container.
  const modelApi = upstreamModelApi(spec.providerKind);
  const agentEnvFile = await writeEnvFile(
    [
      `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
      `CD_BRIDGE_PORT=${BRIDGE_PORT_IN_IMAGE}`,
      `CD_GATEWAY_URL=${gatewayBaseUrl(`http://${spec.gatewayContainerName}:${GATEWAY_PORT_IN_IMAGE}`, modelApi)}`,
      `CD_MODEL_API=${modelApi}`,
      `CD_MODEL_ID=${spec.modelId}`,
      "CD_WORKSPACE=/workspace",
      `CD_AGENT_DIR=${AGENT_DIR_IN_IMAGE}`,
    ].join("\n"),
  );
  const agentContainerId = await run(host, agentRunArgv(spec, guestWorkspacePath, agentEnvFile), spec.scope);

  return { agentContainerId, gatewayContainerId };
}

export async function stopPiAgentSession(host: HostClientFacade, spec: PiAgentSessionSpec): Promise<void> {
  for (const name of [spec.agentContainerName, spec.gatewayContainerName]) {
    await run(host, ["rm", "--force", name], spec.scope).catch((error) => {
      logger.debug(`rm ${name} failed`, error);
      return "";
    });
  }
  await run(host, ["network", "rm", spec.networkName], spec.scope).catch((error) => {
    logger.debug("network rm failed", error);
    return "";
  });
}
