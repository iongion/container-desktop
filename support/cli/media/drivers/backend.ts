import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { electronBackend } from "../backends/electronBackend";
import type { CaptureBackend, CaptureBackendKind } from "./types";

// Backend selection + output. The recording backend is chosen by CONTAINER_DESKTOP_CAPTURE_BACKEND
// (electron | tauri | wails, default tauri) and can be overridden per-run with --backend. ALL backends write
// the same published website assets — the Tauri (WebKitGTK/WebDriver) shell is the default producer, with
// Electron (Playwright/CDP) and Wails (MCP + X11 grab) available for a like-for-like comparison via --backend.

export function resolveCaptureBackend(override?: string): CaptureBackendKind {
  const raw = (override || process.env.CONTAINER_DESKTOP_CAPTURE_BACKEND || "tauri").toLowerCase();
  if (raw !== "electron" && raw !== "tauri" && raw !== "wails") {
    throw new Error(`Unknown capture backend: ${raw} (expected "electron", "tauri" or "wails")`);
  }
  return raw;
}

export async function createBackend(kind: CaptureBackendKind): Promise<CaptureBackend> {
  if (kind === "tauri") {
    // Lazy so the electron path never loads WebdriverIO (and so a missing tauri toolchain only bites Tauri runs).
    const { tauriBackend } = await import("../backends/tauriBackend");
    return tauriBackend;
  }
  if (kind === "wails") {
    // Lazy so the electron/tauri paths never touch the MCP client / X11 capture deps.
    const { wailsBackend } = await import("../backends/wailsBackend");
    return wailsBackend;
  }
  return electronBackend;
}

// Screenshots root: <root>/<engine>/<file>. Both backends write the published website images.
export function screenshotOutDir(): string {
  return path.join(PROJECT_HOME, "website-src", "static", "img");
}

// Demo output path for a scenario's relative asset path (e.g. "website-src/static/replays/podman.json"),
// written in place. Both backends target the same published location.
export function demoOutputPath(relPath: string): string {
  return path.join(PROJECT_HOME, relPath);
}
