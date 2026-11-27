// Pure options → `container build …` argv for Apple Container (everything AFTER the `container` program;
// context dir last). Apple's `container build` (1.7) is BuildKit-backed but exposes a REDUCED surface: it supports
// -t/--target/--build-arg/--secret, a repeated --platform, the resource flags (-a/--arch, --os, -c/--cpus,
// -m/--memory), -l/--label, --no-cache/--pull, -o/--output and `--ssh default` — but NOT other ssh mounts,
// --cache-from/--cache-to, --build-context or --push. Unsupported options are dropped here so a stray field never
// reaches the CLI.

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

export function buildAppleArgs(opts: ImageBuildOptions): string[] {
  const args: string[] = ["build", "--progress=plain"];
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
  // One image with every platform: --platform repeats.
  for (const platform of opts.platforms) {
    args.push("--platform", platform);
  }
  for (const secret of opts.secrets) {
    args.push("--secret", secretArg(secret));
  }
  // The SSH agent is the only mount `container build --ssh` takes.
  if (opts.sshMounts.some((mount) => mount.id === "default")) {
    args.push("--ssh", "default");
  }
  if (opts.arch) {
    args.push("--arch", opts.arch);
  }
  if (opts.os) {
    args.push("--os", opts.os);
  }
  if (opts.cpus) {
    args.push("--cpus", opts.cpus);
  }
  if (opts.memory) {
    args.push("--memory", opts.memory);
  }
  if (opts.output) {
    args.push("--output", opts.output);
  }
  if (opts.noCache) {
    args.push("--no-cache");
  }
  if (opts.pull) {
    args.push("--pull");
  }
  // Deliberately NOT emitted (unsupported by `container build`): --cache-from/--cache-to, --build-context, --push.
  // These are gated off in the config panel too (see FEATURE_MATRIX.apple).
  args.push(opts.contextDir);
  return args;
}
