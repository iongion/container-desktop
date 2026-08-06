// The agent's environment, for an engine that could not be handed a file from the app's own machine.
//
// `--env-file` is read by the engine's CLIENT, so a path under the app's user data means nothing to a podman running
// on another machine — a remote session died there, before any container existed. The app therefore writes the same
// contents into a session-scoped volume over the engine's own stdin and names it in `CD_ENV_FILE`; this loads it
// before anything reads a variable.
//
// The file, and not argv, for the reason the app's local path exists at all: the bridge token authorises the whole
// socket AND the in-container proxy a turn's inference is signed through, and argv is readable by every other user of
// that machine.

import { readFile } from "node:fs/promises";

import { createLogger } from "@/logger";

const logger = createLogger("pi-agent-host.envFile");

// An env line is `NAME=VALUE`, and a VALUE may contain the separator — a base URL does, a token may. Splitting on the
// FIRST one keeps it whole. `\r` is trimmed because the contents may have crossed a Windows host on the way here.
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    const separator = trimmed.indexOf("=");
    if (separator > 0) values[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }
  return values;
}

// Merged into `process.env`, so every reader downstream is the same code on every engine. A variable already set in
// the environment WINS: the file is how this container is configured, and a `--env` on the run is how one value is
// overridden without rewriting it.
export async function loadEnvFile(path: string | undefined): Promise<void> {
  if (!path) return;
  const contents = await readFile(path, "utf8");
  const parsed = parseEnvFile(contents);
  for (const [name, value] of Object.entries(parsed)) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
  logger.info(`the agent's environment was read from ${path} (${Object.keys(parsed).length} variables)`);
}
