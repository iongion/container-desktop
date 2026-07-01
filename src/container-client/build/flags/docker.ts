// Pure options → `docker buildx build …` argv (everything AFTER the `docker` program; context dir last).
// Uses BuildKit's structured progress (--progress=rawjson) which the rawjson parser consumes. buildx does
// NOT load the result into the local image store by default, so a single-platform build with no push/output
// gets an explicit --load; multi-platform images cannot be loaded (they get --push or an explicit --output).

import type { BuildSecret, ImageBuildOptions } from "../types";

function secretArg(secret: BuildSecret): string {
  const parts = [`id=${secret.id}`];
  if (secret.src) {
    parts.push(`src=${secret.src}`);
  }
  if (secret.env) {
    parts.push(`env=${secret.env}`);
  }
  return parts.join(",");
}

export function buildDockerArgs(opts: ImageBuildOptions): string[] {
  const args: string[] = ["buildx", "build", "--progress=rawjson"];
  if (opts.containerfilePath) {
    args.push("-f", opts.containerfilePath);
  }
  for (const tag of opts.tags) {
    args.push("-t", tag);
  }
  for (const [key, value] of Object.entries(opts.buildArgs)) {
    args.push("--build-arg", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(opts.labels)) {
    args.push("--label", `${key}=${value}`);
  }
  if (opts.target) {
    args.push("--target", opts.target);
  }
  if (opts.platforms.length > 0) {
    args.push("--platform", opts.platforms.join(","));
  }
  for (const secret of opts.secrets) {
    args.push("--secret", secretArg(secret));
  }
  for (const mount of opts.sshMounts) {
    args.push("--ssh", mount.source ? `${mount.id}=${mount.source}` : mount.id);
  }
  for (const context of opts.namedContexts) {
    args.push("--build-context", `${context.name}=${context.value}`);
  }
  for (const cache of opts.cacheFrom) {
    args.push("--cache-from", cache);
  }
  for (const cache of opts.cacheTo) {
    args.push("--cache-to", cache);
  }
  if (opts.noCache) {
    args.push("--no-cache");
  }
  if (opts.pull) {
    args.push("--pull");
  }
  // Output routing: --push wins, then an explicit --output, otherwise --load a single-platform build into
  // the local image store. A multi-platform build with none of these stays in the build cache only.
  if (opts.push) {
    args.push("--push");
  } else if (opts.output) {
    args.push("--output", opts.output);
  } else if (opts.platforms.length <= 1) {
    args.push("--load");
  }
  args.push(opts.contextDir);
  return args;
}
