import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { electronBackend } from "../backends/electronBackend";
import type { CaptureBackend, CaptureBackendKind } from "./types";

// Backend selection + output routing. The recording backend is chosen by CONTAINER_DESKTOP_CAPTURE_BACKEND
// (electron | tauri, default electron) and can be overridden per-run with --backend. Electron writes the
// published website assets; Tauri writes a parallel, unpublished set under webdriver/artifacts/capture/ so
// the two shells can be compared side by side.

const TAURI_CAPTURE_ROOT = path.join("webdriver", "artifacts", "capture");

export function resolveCaptureBackend(override?: string): CaptureBackendKind {
  const raw = (override || process.env.CONTAINER_DESKTOP_CAPTURE_BACKEND || "electron").toLowerCase();
  if (raw !== "electron" && raw !== "tauri") {
    throw new Error(`Unknown capture backend: ${raw} (expected "electron" or "tauri")`);
  }
  return raw;
}

export async function createBackend(kind: CaptureBackendKind): Promise<CaptureBackend> {
  if (kind === "tauri") {
    // Lazy so the electron path never loads WebdriverIO (and so a missing tauri toolchain only bites Tauri runs).
    const { tauriBackend } = await import("../backends/tauriBackend");
    return tauriBackend;
  }
  return electronBackend;
}

// Screenshots root: <root>/<engine>/<file>. Electron → published website img; Tauri → capture artifacts.
export function screenshotOutDir(kind: CaptureBackendKind): string {
  if (kind === "tauri") {
    return path.join(PROJECT_HOME, TAURI_CAPTURE_ROOT, "screenshots");
  }
  return path.join(PROJECT_HOME, "website-src", "static", "img");
}

// Demo output path for a scenario's relative asset path (e.g. "website-src/static/replays/podman.json").
// Electron writes it in place; Tauri re-roots it (stripping the website prefix) under the capture artifacts.
export function demoOutputPath(kind: CaptureBackendKind, relPath: string): string {
  if (kind === "tauri") {
    const stripped = relPath.replace(/^website-src[\\/]+static[\\/]+/, "");
    return path.join(PROJECT_HOME, TAURI_CAPTURE_ROOT, stripped);
  }
  return path.join(PROJECT_HOME, relPath);
}
