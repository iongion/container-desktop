#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { build, createServer } from "vite";

/** @type 'production' | 'development'' */
const mode = process.env.MODE || "development";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_HOME = path.dirname(__dirname);

/** @type {import('vite').LogLevel} */
const logLevel = "warn";

// Aggressive GPU/sandbox flags are only safe for headless/CI. On a real desktop
// `--in-process-gpu` + a disabled compositor cause a GPU "context lost" crash/restart
// spin-loop that pegs CPU and can freeze the whole machine. Gate them behind an env var.
const isHeadless = ["1", "true", "yes"].includes(`${process.env.CONTAINER_DESKTOP_HEADLESS || ""}`.toLowerCase());
const remoteDebuggingPort = process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT || "9222";
const remoteDebuggingOrigin =
  process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN || `http://localhost:${remoteDebuggingPort}`;

function buildElectronArgs() {
  // Expose the renderer over the Chrome DevTools Protocol so tools such as the
  // Playwright MCP can attach to the running app in dev.
  const args = [
    ".",
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--remote-allow-origins=${remoteDebuggingOrigin}`,
    "--no-sandbox",
  ];
  if (isHeadless) {
    args.push("--disable-gpu", "--disable-gpu-sandbox", "--in-process-gpu", "--no-zygote", "--disable-features=VizDisplayCompositor", "--disable-dev-shm-usage", "--disable-web-security");
  }
  return args;
}

/** @type {import('node:child_process').ChildProcess | null} */
let electronApp = null;
let relaunching = false;

/** Stops the watch script when the application has been quit. */
function onElectronExit() {
  process.exit(0);
}

/** Kill the running electron process and wait for it to actually exit (SIGKILL fallback). */
function killElectron() {
  return new Promise((resolve) => {
    const proc = electronApp;
    electronApp = null;
    if (!proc || proc.killed || proc.exitCode !== null) {
      resolve();
      return;
    }
    proc.removeListener("exit", onElectronExit);
    const forceKill = setTimeout(() => {
      if (proc.exitCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    }, 2000);
    proc.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}

/**
 * Electron must NOT inherit `ELECTRON_RUN_AS_NODE`: with it set, the Electron binary boots as a plain
 * Node runtime and the app dies immediately with "Not running in an Electron environment!". Some shells,
 * IDE-integrated terminals and CI runners export it globally, so strip it from the child env here.
 */
function electronEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Relaunch electron, ensuring the previous instance is gone first (no process pile-up). */
async function relaunchElectron() {
  if (relaunching) {
    return;
  }
  relaunching = true;
  try {
    await killElectron();
    electronApp = spawn(String(electronPath), buildElectronArgs(), { stdio: "inherit", env: electronEnv() });
    electronApp.addListener("exit", onElectronExit);
  } finally {
    relaunching = false;
  }
}

// Register signal handlers ONCE (registering them per-rebuild leaks listeners).
const shutdown = (signal) => {
  if (electronApp && !electronApp.killed) {
    try {
      electronApp.kill(signal);
    } catch {
      /* already gone */
    }
  }
  process.exit(0);
};
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

/**
 * Setup watcher for `main` package
 * On file changed it totally re-launch electron app.
 * @param {import('vite').ViteDevServer} watchServer Renderer watch server instance.
 * Needs to set up `VITE_DEV_SERVER_URL` environment variable from {@link import('vite').ViteDevServer.resolvedUrls}
 */
function setupMainPackageWatcher({ resolvedUrls }) {
  process.env.VITE_DEV_SERVER_URL = resolvedUrls.local[0];

  return build({
    mode,
    logLevel,
    configFile: path.join(PROJECT_HOME, "vite.config.main.mjs"),
    build: {
      /**
       * Set to {} to enable rollup watcher
       * @see https://vitejs.dev/config/build-options.html#build-watch
       */
      watch: {},
    },
    plugins: [
      {
        name: "reload-app-on-main-package-change",
        writeBundle() {
          void relaunchElectron();
        },
      },
    ],
  });
}

/**
 * Setup watcher for `preload` package
 * On file changed it reload web page.
 * @param {import('vite').ViteDevServer} watchServer Renderer watch server instance.
 * Required to access the web socket of the page. By sending the `full-reload` command to the socket, it reloads the web page.
 */
function setupPreloadPackageWatcher({ ws }) {
  return build({
    mode,
    logLevel,
    configFile: path.join(PROJECT_HOME, "vite.config.preload.mjs"),
    build: {
      /**
       * Set to {} to enable rollup watcher
       * @see https://vitejs.dev/config/build-options.html#build-watch
       */
      watch: {},
    },
    plugins: [
      {
        name: "reload-page-on-preload-package-change",
        writeBundle() {
          ws.send({
            type: "full-reload",
          });
        },
      },
    ],
  });
}

/**
 * Dev server for Renderer package
 * This must be the first,
 * because the {@link setupMainPackageWatcher} and {@link setupPreloadPackageWatcher}
 * depend on the dev server properties
 */
const rendererWatchServer = await createServer({
  mode,
  logLevel,
  configFile: path.join(PROJECT_HOME, "vite.config.renderer.mjs"),
}).then((s) => s.listen());

await setupPreloadPackageWatcher(rendererWatchServer);
await setupMainPackageWatcher(rendererWatchServer);
