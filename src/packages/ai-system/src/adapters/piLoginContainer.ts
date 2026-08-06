// The one-shot container a provider sign-in runs in. Separate from the session's own on purpose: a login happens BEFORE
// there is a credential, so there is no model to register and no workspace to mount — and nothing of the user's is
// exposed to it.
//
// Its bridge port is PUBLISHED to loopback rather than the container being given the host's network, so the app can
// dial it on every engine and platform the app supports — a podman machine and a Docker Desktop VM have their own
// network namespace, and a container that binds the host's would be unreachable there. The cost is that pi's loopback
// callback server is not reachable from the user's browser either, so the login completes through the manual-paste
// prompt pi races that callback against. That is pi's own documented path for a browser on another machine, which is
// exactly what a browser outside the container is.

import { carryEnvIntoVolume, containerEnvArgv, envVolumeRemoveArgv } from "@/ai-system/adapters/containerEnvironment";
import { assistantLabelArgv } from "@/ai-system/adapters/sessionNaming";
import { KEYCHAIN_SECRET_PLACEHOLDER } from "@/ai-system/core/piAgentEnv";
import type { HostClientFacade } from "@/container-client/runtimes/facade";
import { LOOPBACK_ADDRESS } from "@/container-client/runtimes/publishedPortHost";
import { createLogger } from "@/logger";
import { PI_BRIDGE_PORT_IN_IMAGE } from "@/pi-bridge/image";

const logger = createLogger("ai.piLoginContainer");

export interface PiLoginContainerSpec {
  imageTag: string;
  containerName: string;
  hostPort: number;
  bridgeToken: string;
  // pi's OWN provider id, because the container asks pi for the provider by pi's name.
  piProviderId: string;
  // Which scope this connection's engine commands are wrapped in — the connection's own answer, never the caller's.
  // Filling it means the container lands wherever that connection's engine is, so whoever fills it must also reach
  // the bridge from there: `127.0.0.1:<hostPort>` is this machine, and a container on another one answers nothing
  // here without a forward.
  scope?: string;
  // Where the bridge must be BOUND, when the engine's own host is not where a published port lands. An engine inside
  // a machine publishes into THAT machine's network, so the bind is the machine's own address and the forward is
  // pointed there (`container-client/runtimes/publishedPortHost`). Absent is the loopback bind that always shipped.
  machineAddress?: string;
  // Set when the engine's client cannot read this machine's filesystem, so the environment is carried into a volume
  // over the engine's own stdin instead of being handed a path this app wrote. Removed with the container.
  envVolumeName?: string;
  // Set for a refresh run: the env file carries the stored credential, substituted by the vault's owning realm.
  carriesStoredCredential?: boolean;
}

// A REFRESH run in the same container needs the stored credential, which the web view cannot read: `getKey` refuses
// there. So the placeholder goes into the env file and the realm that owns the vault substitutes it while writing —
// the same route the gateway's credential takes. A sign-in has nothing to substitute and writes no such line.
export function loginEnvFileContents(spec: PiLoginContainerSpec): string {
  return [
    `CD_BRIDGE_TOKEN=${spec.bridgeToken}`,
    `CD_BRIDGE_PORT=${PI_BRIDGE_PORT_IN_IMAGE}`,
    ...(spec.carriesStoredCredential ? [`CD_CREDENTIAL=${KEYCHAIN_SECRET_PLACEHOLDER}`] : []),
  ].join("\n");
}

export function loginRunArgv(spec: PiLoginContainerSpec, envFilePath: string): string[] {
  // Where the ENGINE binds it. Its own loopback everywhere the app can dial that, and the machine's address where the
  // engine lives inside one — the bind is resolved in the engine's realm, so a machine's address is one of its own
  // interfaces there.
  const bindAddress = spec.machineAddress ?? LOOPBACK_ADDRESS;
  return [
    "run",
    "--detach",
    "--name",
    spec.containerName,
    "--publish",
    `${bindAddress}:${spec.hostPort}:${PI_BRIDGE_PORT_IN_IMAGE}`,
    // Grouped with the rest of what this app creates, and marked ephemeral: a sign-in container exists for one
    // exchange, so a boot that finds one is finding an orphan.
    ...assistantLabelArgv({ kind: "ephemeral", role: "login" }),
    // One environment, two ways in — a file for an engine that reads this machine's filesystem, a volume carried over
    // stdin for one that cannot. The volume is the ONLY mount a sign-in container ever has.
    ...containerEnvArgv(spec, envFilePath),
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

async function toGuestPath(host: HostClientFacade, scope: string | undefined, hostPath: string): Promise<string> {
  return scope ? await host.resolveGuestPath(hostPath, scope) : hostPath;
}

async function run(host: HostClientFacade, args: string[], scope?: string, input?: string): Promise<string> {
  const execOpts = input === undefined ? undefined : { input };
  const result = scope
    ? await host.runScopeCommand(host.PROGRAM, args, scope, undefined, execOpts)
    : await host.runHostCommand(host.PROGRAM, args, undefined, execOpts);
  if (!result.success) throw new Error(result.stderr?.trim() || `engine command failed: ${args[0]}`);
  return (result.stdout ?? "").trim();
}

export async function startPiLoginContainer(
  host: HostClientFacade,
  spec: PiLoginContainerSpec,
  writeEnvFile: (contents: string) => Promise<string>,
): Promise<string> {
  // A REFRESH's environment is not this app's to compose: it holds the stored credential, and the realm that owns the
  // vault substitutes that while WRITING a file and answers only its path — never the contents. So there is nothing to
  // carry over stdin, and carrying what this module composes would put the bare placeholder in the container and start
  // a refresh that cannot possibly authenticate. Refused here rather than left to fail as a rejected token.
  if (spec.carriesStoredCredential && spec.envVolumeName) {
    throw new Error("a stored credential cannot be carried to an engine that cannot read this machine's filesystem");
  }
  // A written file is named as the ENGINE'S CLIENT will see it: a scoped engine runs its CLI inside the guest, where
  // this machine's path is not the path. The carried one is already the container's own and is left alone.
  const envFilePath = spec.envVolumeName
    ? await carryEnvIntoVolume((args, input) => run(host, args, spec.scope, input), spec, loginEnvFileContents(spec))
    : await toGuestPath(host, spec.scope, await writeEnvFile(loginEnvFileContents(spec)));
  return run(host, loginRunArgv(spec, envFilePath), spec.scope);
}

export async function removePiLoginContainer(host: HostClientFacade, spec: PiLoginContainerSpec): Promise<void> {
  await run(host, loginRemoveArgv(spec), spec.scope).catch((error) => {
    logger.debug(`rm ${spec.containerName} failed`, error);
    return "";
  });
  // It holds the bridge token that authorised the socket the credential came back over, so it goes with the container
  // rather than waiting for a next sign-in that may never happen.
  if (spec.envVolumeName) {
    await run(host, envVolumeRemoveArgv(spec), spec.scope).catch((error) => {
      logger.debug("removing the sign-in's environment volume failed", error);
      return "";
    });
  }
}
