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

/**
 * Setup watcher for `main` package
 * On file changed it totally re-launch electron app.
 * @param {import('vite').ViteDevServer} watchServer Renderer watch server instance.
 * Needs to set up `VITE_DEV_SERVER_URL` environment variable from {@link import('vite').ViteDevServer.resolvedUrls}
 */
function setupMainPackageWatcher({ resolvedUrls }) {
  process.env.VITE_DEV_SERVER_URL = resolvedUrls.local[0];

  /** @type {ChildProcess | null} */
  let electronApp = null;

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
          /** Kill electron if process already exist */
          if (electronApp !== null) {
            electronApp.removeListener("exit", process.exit);
            electronApp.kill("SIGINT");
            electronApp = null;
          }

          /** Spawn new electron process */
          electronApp = spawn(String(electronPath), ["--inspect", "."], {
            stdio: "inherit",
          });

          /** Stops the watch script when the application has been quit */
          electronApp.addListener("exit", process.exit);

          /** Handle SIGINT (Ctrl+C) to properly kill electron app */
          process.on("SIGINT", () => {
            if (electronApp && !electronApp.killed) {
              electronApp.kill("SIGINT");
            }
            process.exit(0);
          });
          /** Handle SIGTERM to properly kill electron app */
          process.on("SIGTERM", () => {
            if (electronApp && !electronApp.killed) {
              electronApp.kill("SIGTERM");
            }
            process.exit(0);
          });
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
