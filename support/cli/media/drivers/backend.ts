import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import type { CaptureBackend, CaptureBackendKind } from "./types";

// Backend selection + output. The recording backend is chosen by CONTAINER_DESKTOP_CAPTURE_BACKEND (default and
// only value: tauri) and can be overridden per-run with --backend. It writes the published website assets.

export function resolveCaptureBackend(override?: string): CaptureBackendKind {
  const raw = (override || process.env.CONTAINER_DESKTOP_CAPTURE_BACKEND || "tauri").toLowerCase();
  if (raw !== "tauri") {
    throw new Error(`Unknown capture backend: ${raw} (expected "tauri")`);
  }
  return raw;
}

export async function createBackend(_kind: CaptureBackendKind): Promise<CaptureBackend> {
  // Lazy so a missing tauri toolchain only bites capture runs.
  const { tauriBackend } = await import("../backends/tauriBackend");
  return tauriBackend;
}

// Screenshots root: <root>/<engine>/<file>, the published website images.
export function screenshotOutDir(): string {
  return path.join(PROJECT_HOME, "website-src", "static", "img");
}

// Demo output path for a scenario's relative asset path (e.g. "website-src/static/replays/podman.json"),
// written in place at the published location.
export function demoOutputPath(relPath: string): string {
  return path.join(PROJECT_HOME, relPath);
}
