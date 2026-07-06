// adapter (environment + filesystem layout): resolves dev/debug mode, the renderer URL, and the
// preload/icon paths. The path roots are passed in by the composition root (which derives them from
// Electron's `app` + the bundle location), so this module itself imports no Electron and is trivial to
// reason about. A different shell would supply its own RuntimePaths + URL.

import fs from "node:fs";
import path from "node:path";
import * as url from "node:url";

import { OperatingSystem } from "@/env/Types";
import { CURRENT_OS_TYPE } from "@/platform/electron/host";

export interface RuntimePaths {
  /** Directory of the built `main.cjs` (build/<version>/) — holds preload.cjs, index.html, packaged icons. */
  appDir: string;
  /** `dirname(app.getPath("exe"))` when packaged, else `app.getAppPath()`. */
  appPath: string;
  /** Repo root in dev — for `src/resources/icons`. */
  projectHome: string;
}

const DEBUG_FLAGS = ["yes", "true", "1"];
type RuntimeIconEngine = "docker" | "podman" | "unified";

function normalizeIconEngine(engine?: string): RuntimeIconEngine {
  if (engine === "docker" || engine === "unified") {
    return engine;
  }
  return "podman";
}

export function createRuntime(paths: RuntimePaths) {
  // Standard Vite-Electron rule: development iff the build was made in development mode OR a Vite dev-server
  // URL was injected (hot reload). NOT keyed on app.isPackaged — an unpackaged *production* build launched
  // directly (e.g. Playwright `electron.launch` in E2E) must behave as production.
  const isDevelopment = (): boolean =>
    import.meta.env.ENVIRONMENT === "development" || Boolean(import.meta.env.VITE_DEV_SERVER_URL);
  const isDebug = DEBUG_FLAGS.includes(`${process.env.CONTAINER_DESKTOP_DEBUG || ""}`.toLowerCase());
  let currentIconEngine: RuntimeIconEngine = "podman";
  const iconsDir = (): string => (isDevelopment() ? path.join(paths.projectHome, "src/resources/icons") : paths.appDir);
  const iconPath = (file: string): string => path.join(iconsDir(), file);
  const existingIconPath = (file: string, fallback: string): string => {
    const candidate = iconPath(file);
    return fs.existsSync(candidate) ? candidate : iconPath(fallback);
  };
  const engineIconPath = (base: string, engine?: string): string => {
    const fallback = `${base}.png`;
    const normalizedEngine = normalizeIconEngine(engine ?? currentIconEngine);
    // Every engine (podman included) uses its own colored mark; the monochrome `${base}.png` is only the
    // last-resort fallback when a per-engine asset is missing.
    return existingIconPath(`${base}-${normalizedEngine}.png`, fallback);
  };

  return {
    isDevelopment,
    isDebug,
    appPath: paths.appPath,
    appDir: paths.appDir,
    setIconEngine: (engine?: string): void => {
      currentIconEngine = normalizeIconEngine(engine);
    },
    preloadPath: (): string => path.join(paths.appDir, "preload.cjs"),
    // Dev server when present (hot reload), otherwise the built renderer from file:// — works packaged AND
    // for an unpackaged production build launched directly.
    rendererURL: (): string =>
      import.meta.env.VITE_DEV_SERVER_URL ||
      url.format({ pathname: path.join(paths.appDir, "index.html"), protocol: "file:", slashes: true }),
    appIconPath: (engine?: string): string =>
      engineIconPath("appIcon", CURRENT_OS_TYPE === OperatingSystem.Linux ? "unified" : engine),
    trayIconPath: (isDark: boolean, engine?: string): string => {
      const theme = isDark ? "dark" : "light";
      const base = CURRENT_OS_TYPE === OperatingSystem.MacOS ? `trayIcon-${theme}-mac` : `trayIcon-${theme}`;
      return path.resolve(engineIconPath(base, engine));
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
