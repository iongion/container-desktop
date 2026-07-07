// Pure Docker Compose CLI helpers — argv builders for the `docker compose` v2 subcommands the app shells,
// plus a parser mapping compose v2's progress output to the engine-neutral ComposeChangeSummary. No host,
// no I/O, no node builtins (this file bundles into the renderer via ComposeAdapter) — just strings.

import type { ComposeChangeSummary } from "@/container-client/compose/types";

export interface ComposeUpArgsOptions {
  file: string;
  project?: string;
  removeOrphans?: boolean;
}

export interface ComposeDownArgsOptions {
  project: string;
  removeVolumes?: boolean;
}

// `docker compose -f <file> -p <project> up -d [--remove-orphans]` — the global -f/-p precede the subcommand;
// -d/--remove-orphans follow it.
export function buildComposeUpArgs({ file, project, removeOrphans }: ComposeUpArgsOptions): string[] {
  const args = ["compose", "-f", file];
  if (project) args.push("-p", project);
  args.push("up", "-d");
  if (removeOrphans) args.push("--remove-orphans");
  return args;
}

// `docker compose -p <project> down [-v]` — teardown finds the project's resources by the compose project
// label, so the project name alone is enough (no file needed).
export function buildComposeDownArgs({ project, removeVolumes }: ComposeDownArgsOptions): string[] {
  const args = ["compose", "-p", project, "down"];
  if (removeVolumes) args.push("-v");
  return args;
}

// `docker compose version` — the pre-flight probe that the compose v2 plugin is installed.
export function buildComposeVersionArgs(): string[] {
  return ["compose", "version"];
}

// ESC (0x1B) built at runtime so the regex literal carries no control character (Biome noControlCharactersInRegex).
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
// A per-container progress line: `… Container <name>  <Status>` — keyed on "Container" so Network/Volume/
// header lines are ignored.
const CONTAINER_LINE = /\bContainer\s+(\S+)\s+(Created|Recreated|Started|Running|Removed)\b/;

// Map compose v2's human progress output (stdout+stderr) to the engine-neutral summary. A fresh container
// emits both "Created" and "Started" lines → it lands in BOTH arrays, mirroring the libpod orchestrator's
// two-pass (create then start) summary. "Running" = already up (unchanged); "Recreated" = config changed;
// "Removed" = orphan pruned by --remove-orphans.
export function parseComposeUpSummary(output: string): ComposeChangeSummary {
  const created = new Set<string>();
  const recreated = new Set<string>();
  const unchanged = new Set<string>();
  const started = new Set<string>();
  const orphansRemoved = new Set<string>();
  for (const raw of output.split(/\r?\n/)) {
    const match = CONTAINER_LINE.exec(raw.replace(ANSI, ""));
    if (!match) continue;
    const [, name, status] = match;
    switch (status) {
      case "Created":
        created.add(name);
        break;
      case "Recreated":
        recreated.add(name);
        break;
      case "Started":
        started.add(name);
        break;
      case "Running":
        unchanged.add(name);
        break;
      case "Removed":
        orphansRemoved.add(name);
        break;
    }
  }
  return {
    created: [...created],
    recreated: [...recreated],
    unchanged: [...unchanged],
    started: [...started],
    orphansRemoved: [...orphansRemoved],
  };
}
