import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";

const logger = createLogger("ai.piAgentContainer");

const AGENT_DIR_IN_IMAGE = "/home/agent/.pi/agent";
const BRIDGE_PORT_IN_IMAGE = 8787;
const GATEWAY_PORT_IN_IMAGE = 8788;

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
  modelId: string;
  egress: boolean;
  scope?: string;
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
    `${spec.pluginVolumeName}:${AGENT_DIR_IN_IMAGE}`,
    "--env-file",
    envFilePath,
    ...(spec.egress ? [] : ["--internal"]),
    spec.imageTag,
    "--mode",
    "agent",
  ];
}

export function gatewayRunArgv(spec: PiAgentSessionSpec, envFilePath: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    spec.gatewayContainerName,
    "--network",
    spec.networkName,
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

  const gatewayEnvFile = await writeEnvFile(
    [
      `CD_UPSTREAM_BASE_URL=${spec.upstreamBaseUrl}`,
      `CD_UPSTREAM_API_KEY=${spec.upstreamApiKey}`,
      `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
      `CD_GATEWAY_PORT=${GATEWAY_PORT_IN_IMAGE}`,
    ].join("\n"),
  );
  const gatewayContainerId = await run(host, gatewayRunArgv(spec, gatewayEnvFile), spec.scope);

  // The agent's env file deliberately omits the provider key: plugin code runs in this container.
  const agentEnvFile = await writeEnvFile(
    [
      `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
      `CD_BRIDGE_PORT=${BRIDGE_PORT_IN_IMAGE}`,
      `CD_GATEWAY_URL=http://${spec.gatewayContainerName}:${GATEWAY_PORT_IN_IMAGE}/v1`,
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
