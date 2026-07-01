// Pure logic behind the Build configuration panel: the live command preview (redacted) and the small
// capability predicates. Kept out of the component so it is unit-testable without a DOM. The preview reuses
// the SAME per-engine flag mappers the BuildAdapter runs, so what the user sees is what will execute.

import { redactText } from "@/ai-system/core/redact";
import { buildAppleArgs } from "@/container-client/build/flags/apple";
import { buildDockerArgs } from "@/container-client/build/flags/docker";
import { buildPodmanArgs } from "@/container-client/build/flags/podman";
import type { BuildEngineKind, ImageBuildOptions } from "@/container-client/build/types";

const PROGRAM: Record<BuildEngineKind, string> = {
  docker: "docker",
  podman: "podman",
  apple: "container",
};

const MAPPER: Record<BuildEngineKind, (options: ImageBuildOptions) => string[]> = {
  docker: buildDockerArgs,
  podman: buildPodmanArgs,
  apple: buildAppleArgs,
};

function quoteArg(arg: string): string {
  return /\s/.test(arg) ? JSON.stringify(arg) : arg;
}

/** The full `<program> <args…>` line as it would run (no redaction). */
export function buildArgvPreview(options: ImageBuildOptions): string {
  const argv = [PROGRAM[options.engine], ...MAPPER[options.engine](options)];
  return argv.map(quoteArg).join(" ");
}

/** The command preview shown in the panel — secrets/tokens redacted so nothing sensitive is displayed. */
export function buildRedactedPreview(options: ImageBuildOptions): string {
  return redactText(buildArgvPreview(options));
}

/** A single-platform build with no push can be --load'ed into the local image store; multi-platform cannot. */
export function canLoadLocally(options: ImageBuildOptions): boolean {
  return options.platforms.length <= 1 && !options.push;
}
