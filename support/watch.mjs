#!/usr/bin/env node

import { spawn } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
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

// CDP debug port. Prefer the configured/default port, but if it is already taken — e.g. a podman
// rootless port-forward squatting 9222 — auto-fall back to an OS-assigned free port so `yarn dev`
// never loses the race and comes up without a DevTools endpoint. The resolved endpoint is written to
// a temp handshake file that support/cdp.mjs auto-discovers, so no port is hardcoded on either side.
const CDP_ENDPOINT_FILE = path.join(os.tmpdir(), "container-desktop-cdp.json");
const probePortFree = (port) =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port, "127.0.0.1");
  });
const pickFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const preferredDebuggingPort = Number(process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT || "9222");
const remoteDebuggingPort = String(
  (await probePortFree(preferredDebuggingPort)) ? preferredDebuggingPort : await pickFreePort(),
);
const remoteDebuggingOrigin =
  process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN || `http://localhost:${remoteDebuggingPort}`;
if (remoteDebuggingPort !== String(preferredDebuggingPort)) {
  console.log(
    `[container-desktop] CDP port ${preferredDebuggingPort} is busy — using free port ${remoteDebuggingPort}`,
  );
}
try {
  writeFileSync(
    CDP_ENDPOINT_FILE,
    JSON.stringify({ cdpUrl: `http://localhost:${remoteDebuggingPort}`, port: Number(remoteDebuggingPort) }),
  );
} catch {
  /* non-fatal: cdp.mjs falls back to $CDP_URL then :9222 */
}
console.log(`[container-desktop] CDP endpoint: http://localhost:${remoteDebuggingPort} (cdp.mjs auto-discovers it)`);
// When set to a port, expose the Electron main-process V8 inspector so an IDE (the
// VS Code "Debug All" launch) can attach a Node debugger and hit breakpoints in the
// real TypeScript sources. Empty by default so a normal `yarn dev` is unchanged.
const inspectPort = `${process.env.CONTAINER_DESKTOP_INSPECT || ""}`.trim();

function buildElectronArgs() {
  // Expose the renderer over the Chrome DevTools Protocol so tools such as the
  // Playwright MCP can attach to the running app in dev. When debugging from an IDE
  // the CDP origin is widened to `*` so the IDE's renderer attach can connect.
  const allowOrigins = inspectPort ? "*" : remoteDebuggingOrigin;
  const args = [
    ".",
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--remote-allow-origins=${allowOrigins}`,
    "--no-sandbox",
  ];
  if (inspectPort) {
    // Main-process inspector for the IDE Node-debugger attach. Must precede "." so
    // Electron treats it as a runtime flag rather than an application argument.
    args.unshift(`--inspect=${inspectPort}`);
  }
  if (isHeadless) {
    args.push(
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--in-process-gpu",
      "--no-zygote",
      "--disable-features=VizDisplayCompositor",
      "--disable-dev-shm-usage",
      "--disable-web-security",
    );
  }
  return args;
}

/** @type {import('node:child_process').ChildProcess | null} */
let electronApp = null;
let relaunching = false;

function cleanupCdpEndpoint() {
  try {
    unlinkSync(CDP_ENDPOINT_FILE);
  } catch {
    /* already gone */
  }
}

/** Stops the watch script when the application has been quit. */
function onElectronExit() {
  cleanupCdpEndpoint();
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
  cleanupCdpEndpoint();
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

// Single-shot startup marker: lets an IDE background task detect that the watcher has
// begun before the dev server / main-process inspector come up (see .vscode/tasks.json).
console.log(`[container-desktop] dev watcher starting (inspect=${inspectPort || "off"})`);

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
