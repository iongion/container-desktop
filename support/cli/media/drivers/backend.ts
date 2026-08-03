import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import type { CaptureBackend, CaptureBackendKind } from "./types";

// Backend selection + output. The recording backend is chosen by CONTAINER_DESKTOP_CAPTURE_BACKEND
// (tauri | wails, default tauri) and can be overridden per-run with --backend. Both backends write the same
// published website assets — Tauri (WebKitGTK/WebDriver) is the default producer, Wails (MCP + X11 grab) the
// like-for-like comparison.

export function resolveCaptureBackend(override?: string): CaptureBackendKind {
  const raw = (override || process.env.CONTAINER_DESKTOP_CAPTURE_BACKEND || "tauri").toLowerCase();
  if (raw !== "tauri" && raw !== "wails") {
    throw new Error(`Unknown capture backend: ${raw} (expected "tauri" or "wails")`);
  }
  return raw;
}

export async function createBackend(kind: CaptureBackendKind): Promise<CaptureBackend> {
  if (kind === "wails") {
    // Lazy so the Tauri path never touches the MCP client / X11 capture deps.
    const { wailsBackend } = await import("../backends/wailsBackend");
    return wailsBackend;
  }
  // Lazy so a missing tauri toolchain only bites Tauri runs.
  const { tauriBackend } = await import("../backends/tauriBackend");
  return tauriBackend;
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
