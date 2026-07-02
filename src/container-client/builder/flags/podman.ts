// Pure options → `podman build …` argv (everything AFTER the `podman` program; context dir last). Podman
// builds straight into local storage (no --load) and emits plain STEP text (no --progress=rawjson). Layer
// caching of intermediate steps requires --layers, which we default ON so the cache diagnostics have data.

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

export function buildPodmanArgs(opts: ImageBuildOptions): string[] {
  const args: string[] = ["build"];
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
  // Cache intermediate layers unless the caller explicitly opts out — the cache diagnostics depend on it.
  if (opts.layers !== false) {
    args.push("--layers");
  }
  if (opts.noCache) {
    args.push("--no-cache");
  }
  if (opts.pull) {
    args.push("--pull");
  }
  if (opts.push) {
    args.push("--push");
  }
  args.push(opts.contextDir);
  return args;
}
