// The one-shot container a provider sign-in runs in. Separate from the session pair on purpose: a login happens
// BEFORE there is a credential, so there is no gateway to start, no model to register and no workspace to mount — and
// nothing of the user's is exposed to it.
//
// Its bridge port is PUBLISHED to loopback rather than the container being given the host's network, so the app can
// dial it on every engine and platform the app supports — a podman machine and a Docker Desktop VM have their own
// network namespace, and a container that binds the host's would be unreachable there. The cost is that pi's loopback
// callback server is not reachable from the user's browser either, so the login completes through the manual-paste
// prompt pi races that callback against. That is pi's own documented path for a browser on another machine, which is
// exactly what a browser outside the container is.

import { KEYCHAIN_SECRET_PLACEHOLDER } from "@/ai-system/core/piAgentEnv";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { createLogger } from "@/logger";

const logger = createLogger("ai.piLoginContainer");

// The port the container's bridge binds inside the image. Exported because a refresh run's env file is composed
// host-side, so the caller has to name the same port this adapter publishes to.
export const PI_BRIDGE_PORT_IN_IMAGE = 8787;
const BRIDGE_PORT_IN_IMAGE = PI_BRIDGE_PORT_IN_IMAGE;

export interface PiLoginContainerSpec {
  imageTag: string;
  containerName: string;
  hostPort: number;
  bridgeToken: string;
  // pi's OWN provider id, because the container asks pi for the provider by pi's name.
  piProviderId: string;
  scope?: string;
  // Set for a refresh run: the env file carries the stored credential, substituted by the vault's owning realm.
  carriesStoredCredential?: boolean;
}

// A REFRESH run in the same container needs the stored credential, which the web view cannot read: `getKey` refuses
// there. So the placeholder goes into the env file and the realm that owns the vault substitutes it while writing —
// the same route the gateway's credential takes. A sign-in has nothing to substitute and writes no such line.
export function loginEnvFileContents(spec: PiLoginContainerSpec): string {
  return [
    `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
    `CD_BRIDGE_PORT=${BRIDGE_PORT_IN_IMAGE}`,
    ...(spec.carriesStoredCredential ? [`CD_CREDENTIAL=${KEYCHAIN_SECRET_PLACEHOLDER}`] : []),
  ].join("\n");
}

export function loginRunArgv(spec: PiLoginContainerSpec, envFilePath: string): string[] {
  return [
    "run",
    "--detach",
    "--name",
    spec.containerName,
    "--publish",
    `127.0.0.1:${spec.hostPort}:${BRIDGE_PORT_IN_IMAGE}`,
    "--env-file",
    envFilePath,
    spec.imageTag,
    "--mode",
    "login",
  ];
}

// A sign-in container is not reaped on its own: `runLogin` keeps listening so the app can retry a refused code on the
// same socket, so whoever started it removes it — including on failure, which is why every path calls this.
export function loginRemoveArgv(spec: PiLoginContainerSpec): string[] {
  return ["rm", "--force", spec.containerName];
}

async function run(host: HostClientFacade, args: string[], scope?: string): Promise<string> {
  const result = scope
    ? await host.runScopeCommand(host.PROGRAM, args, scope)
    : await host.runHostCommand(host.PROGRAM, args);
  if (!result.success) throw new Error(result.stderr?.trim() || `engine command failed: ${args[0]}`);
  return (result.stdout ?? "").trim();
}

export async function startPiLoginContainer(
  host: HostClientFacade,
  spec: PiLoginContainerSpec,
  writeEnvFile: (contents: string) => Promise<string>,
): Promise<string> {
  const envFilePath = await writeEnvFile(loginEnvFileContents(spec));
  return run(host, loginRunArgv(spec, envFilePath), spec.scope);
}

export async function removePiLoginContainer(host: HostClientFacade, spec: PiLoginContainerSpec): Promise<void> {
  await run(host, loginRemoveArgv(spec), spec.scope).catch((error) => {
    logger.debug(`rm ${spec.containerName} failed`, error);
    return "";
  });
}
