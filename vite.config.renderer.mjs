import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import react from "@vitejs/plugin-react";
import merge from "deepmerge";
import mimeTypes from "mime-types";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import svgrPlugin from "vite-plugin-svgr";
import pkg from "./package.json";
import {
  createEJSContext,
  ENVIRONMENT,
  getCommonViteConfig,
  getElectronVendorsCache,
  PROJECT_HOME,
  sourceEnv,
  sourcemap,
} from "./vite.config.common.mjs";

// Vite 8 / rolldown 1.1.3 can't follow @popperjs/core's `export * from "./enums.js"` re-export of its
// computed placement enums (Blueprint imports `placements`), so `vite build` fails with MISSING_EXPORT.
// Redirect the bare specifier to a shim that re-exports those names explicitly. Build-only: esbuild's dev
// pre-bundle already handles the wildcard. `enforce: "pre"` so it wins over default resolution; sub-path
// imports inside the shim aren't the bare specifier, so they resolve normally (no recursion).
export function popperCoreShim() {
  const shim = path.resolve(PROJECT_HOME, "support/popper-core-shim.mjs");
  return {
    name: "popper-core-shim",
    enforce: "pre",
    apply: "build",
    resolveId(source) {
      return source === "@popperjs/core" ? shim : null;
    },
  };
}

export function docsServer() {
  return {
    apply: "serve",
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.originalUrl?.startsWith("/VERSION") || req.originalUrl?.startsWith(`/VERSION-${os.type()}`)) {
            res.setHeader("Content-Type", "text/plain");
            res.writeHead(200);
            res.write(pkg.version);
            res.end();
          } else if (req.originalUrl?.includes("/website")) {
            let resource = path.join(__dirname, `${req.originalUrl}`);
            if (fs.lstatSync(resource).isDirectory()) {
              resource = path.join(resource, "index.html");
              res.setHeader("Content-Type", mimeTypes.lookup(resource) || "application/octet-stream");
              res.setHeader("Location", "/website/index.html");
              res.writeHead(301);
            } else {
              if (fs.existsSync(resource)) {
                res.setHeader("Content-Type", mimeTypes.lookup(resource) || "application/octet-stream");
                res.writeHead(200);
                res.write(fs.readFileSync(resource));
              } else {
                console.error(`Resource not found: ${resource}`);
                res.setHeader("Content-Type", "text/plain");
                res.writeHead(404);
                res.write("Resource not found");
              }
            }
            res.end();
          }
          next();
        });
      };
    },
    name: "docs-server",
  };
}

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export const createConfig = ({ mode, command, host, port }) => {
  // Bootstrap
  sourceEnv(ENVIRONMENT);
  const cache = getElectronVendorsCache();
  console.debug({ PROJECT_HOME, command, host, port });
  console.debug(`Website running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}/website/index.html`);
  // Bootstrap
  // Build context
  const ejsContext = createEJSContext();
  // vite main
  const viteConfig = getCommonViteConfig({
    mode,
    command,
    // app specific
    // outputName: APP_MAIN,
    plugins: [
      // All current plugins are extending the Vite configuration
      // Frontend specific
      popperCoreShim(),
      react(),
      svgrPlugin(),
      ViteEjsPlugin(ejsContext),
    ],
    publicDir: "./public",
    build: {
      target: `chrome${cache.chrome}`,
      sourcemap: sourcemap,
      emptyOutDir: false,
    },
    rollupOptions: {
      input: path.join(PROJECT_HOME, "index.html"),
    },
    optimizeDeps: {
      // Pre-bundle the heavy, lazy-loaded deps at dev-server startup. Otherwise the first visit to a screen that
      // dynamically imports them (Terminal/Logs → xterm; editors → monaco) makes Vite discover + re-optimize
      // them mid-session, which 504s the in-flight dynamic import ("Outdated Optimize Dep") and trips the error
      // boundary. Build mode ignores optimizeDeps, so this is dev-server only (Electron dev + Tauri dev alike).
      include: [
        "@xterm/xterm",
        "@xterm/addon-fit",
        "@xterm/addon-search",
        "@xterm/addon-unicode11",
        "@xterm/addon-web-links",
        "@xterm/addon-webgl",
        "@monaco-editor/react",
        "monaco-editor",
      ],
      esbuildOptions: {
        define: {
          global: "globalThis",
        },
      },
    },
    outputName: "renderer",
  });
  return viteConfig;
};

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  const host = process.env.HOST || "0.0.0.0";
  const port = Number(process.env.PORT) || 3000;
  const baseConfig = createConfig({ mode, command, host, port });
  baseConfig.plugins.push(docsServer());
  const config = merge(baseConfig, {
    clearScreen: false,
    root: PROJECT_HOME,
    envDir: PROJECT_HOME,
    server: {
      host,
      port,
      strictPort: true,
      cors: true,
      watch: {},
      fs: {
        strict: true,
      },
    },
  });
  config.base = "";
  // Emit Monaco's language workers as their own cleanly-named files (editor.worker.js,
  // json.worker.js) next to renderer.mjs — offline, no base64 bloat, no hashes.
  config.worker = {
    rollupOptions: {
      output: {
        entryFileNames: "[name].js",
      },
    },
  };
  config.build.rollupOptions.external = ["electron"];
  // Renderer-only: enable code-splitting so React.lazy() emits real chunks (Monaco ~10 MB / xterm load
  // on demand) instead of inlining everything into renderer.mjs and parsing it before first paint.
  // main/preload stay single-file CJS (their common-config `codeSplitting:false` is untouched). The
  // chunks load as file:// siblings of renderer.mjs in the packaged app — the same mechanism the bundled
  // monaco workers (editor.worker.js / json.worker.js) already use.
  config.build.rollupOptions.output.codeSplitting = true;
  config.build.rollupOptions.output.chunkFileNames = "chunks/[name]-[hash].mjs";
  return config;
};
