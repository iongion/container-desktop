// How a container's environment REACHES it. What is IN one is a different question, composed elsewhere
// (`core/piAgentEnv.ts` for the session's, `piLoginContainer.ts` for a sign-in's).
//
// An engine whose client can read this machine's filesystem is handed a private file and reads it itself. One whose
// client cannot — a remote engine over SSH — is handed nothing this app writes: `--env-file` is read by the CLIENT, so
// a path under this app's user data means nothing to a podman on another machine. The same text is carried into a
// volume over the engine's own stdin instead, and the container is pointed at it with `CD_ENV_FILE`.
//
// Both containers this app runs travel this way — the session's pair and the one-shot sign-in — so the argv lives
// once. Two copies of a builder whose whole purpose is that the contents never appear in argv are two chances for one
// of them to quietly stop being true.

import { createLogger } from "@/logger";
import { AGENT_ENV_DIR_IN_IMAGE, AGENT_ENV_FILE_IN_IMAGE } from "@/pi-bridge/image";

const logger = createLogger("ai.containerEnvironment");

// The little of a spec this needs: the image the carrier runs, and the volume to carry it in. No volume named means
// the engine reads this machine's filesystem and is handed a file.
export interface ContainerEnvCarrier {
  imageTag: string;
  envVolumeName?: string;
}

// One engine command's worth of work, as the caller already runs them: its own program, its own scope, and stdin the
// exec seam forwards without it ever appearing in argv.
export type RunEngineCommand = (args: string[], input?: string) => Promise<string>;

// The volume the environment is carried in. Unlabelled, deliberately: it is created and removed inside one start, and
// a label exists so a resource can be FOUND again later.
export function envVolumeCreateArgv(spec: ContainerEnvCarrier): string[] {
  return ["volume", "create", spec.envVolumeName ?? ""];
}

// Writing it with `tee` and stdin: no shell, no redirect, and nothing in the argv with a space in it. A redirect
// inside an argument (`sh -c "cat > …"`) would be executed by the REMOTE shell — every argument of a remote engine's
// command is joined by ssh and re-split over there — and the contents themselves must never be in argv at all, since
// the bridge token authorises both the socket and the proxy a turn's inference is signed through.
//
// `--user 0` because a volume is created owned by root and the image runs as `agent`; what it writes is readable
// inside a volume that only this run's own container mounts.
export function envWriteArgv(spec: ContainerEnvCarrier): string[] {
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

// It holds the bridge token, so it goes with the container that token authorised rather than waiting for the next
// run to overwrite it.
export function envVolumeRemoveArgv(spec: ContainerEnvCarrier): string[] {
  return ["volume", "rm", "--force", spec.envVolumeName ?? ""];
}

// How the `run` that starts the container is told where its environment is. Read-only: nothing in the container has
// any business rewriting the token that authorises it.
export function containerEnvArgv(spec: ContainerEnvCarrier, envFilePath: string): string[] {
  return spec.envVolumeName
    ? [
        "--volume",
        `${spec.envVolumeName}:${AGENT_ENV_DIR_IN_IMAGE}:ro`,
        "--env",
        `CD_ENV_FILE=${AGENT_ENV_FILE_IN_IMAGE}`,
      ]
    : ["--env-file", envFilePath];
}

// The engines' several ways of saying "that name is taken". Everything else a create can fail with — an exhausted
// address pool above all — has to travel, because the caller's next command fails for a reason that reads nothing
// like the real one.
export function isExistingNameError(error: unknown): boolean {
  return /already exists|already in use|already used/i.test(`${(error as Error)?.message ?? error}`);
}

// Into a volume the container mounts, over the engine's own stdin. Answers the path it will read the environment at,
// so the caller cannot tell this apart from a file having been written.
export async function carryEnvIntoVolume(
  run: RunEngineCommand,
  spec: ContainerEnvCarrier,
  contents: string,
): Promise<string> {
  await run(envVolumeCreateArgv(spec)).catch((error) => {
    // Run-scoped, so an existing one is this run's own leftovers — and it is overwritten in the next step.
    if (!isExistingNameError(error)) throw error;
    logger.debug("the environment volume already existed", error);
    return "";
  });
  await run(envWriteArgv(spec), contents);
  return AGENT_ENV_FILE_IN_IMAGE;
}
