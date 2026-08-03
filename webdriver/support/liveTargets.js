// Live-target loading for the WebDriver specs. The specs run in Node under wdio, but the target grammar
// (CDT_TARGET_* over the .env chain plus targets.env) is owned by src/__tests__/live/targets.ts and unit-tested
// there. Rather than reimplement that parser in JS, shell out to it through tsx once and read the JSON — one
// source of truth, no drift.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadLiveTargets() {
  try {
    const out = execFileSync("yarn", ["-s", "tsx", "src/__tests__/live/printTargets.ts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
    });
    return JSON.parse(out.trim() || "[]");
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
