// Live-target loading for the WebDriver specs. The specs run in Node under wdio, but the target grammar
// (CDT_TARGET_* over the .env chain plus targets.env) is owned by src/__tests__/live/targets.ts and unit-tested
// there. Rather than reimplement that parser in JS, shell out to it through tsx once and read the JSON — one
// source of truth, no drift.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The child's stdout is NOT pure JSON: dotenvx announces every env file it injects on stdout ("◇ injected env (13)
// from .env"), so parsing the whole stream reported "no targets configured" for a machine that had them. Ask it to be
// quiet AND read only the JSON line, so any future banner on stdout cannot silence the live suite again.
function jsonLineOf(output) {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[") || line.startsWith("{"));
  return lines.at(-1) ?? "";
}

export function loadLiveTargets() {
  try {
    const out = execFileSync("yarn", ["-s", "tsx", "src/__tests__/live/printTargets.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DOTENVX_QUIET: "true", DOTENV_CONFIG_QUIET: "true" },
    });
    return JSON.parse(jsonLineOf(out) || "[]");
  } catch (error) {
    console.warn(`[live] could not load targets: ${error?.message ?? error}`);
    return [];
  }
}

export function selectLiveTargets(selection) {
  const targets = loadLiveTargets();
  const ids = `${selection ?? ""}`
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return ids.length === 0 ? targets.filter((t) => t.enabled) : targets.filter((t) => ids.includes(t.id));
}

// Shape the probe expects — the subset of a TestTarget that survives structured-cloning into the webview.
export function toProbeTarget(target, engine) {
  return {
    id: target.id,
    os: target.os,
    socket: target.sockets?.[engine],
    scope: target.wslDistro ?? target.limaInstance,
    ssh: target.ssh,
  };
}

export const isNativeHost = (host) => host === "podman.native" || host === "docker.native";
export const isRemoteHost = (host) => host === "podman.remote" || host === "docker.remote";
export const engineOfHost = (host) => (host.startsWith("podman") ? "podman" : "docker");
