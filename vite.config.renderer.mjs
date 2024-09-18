import react from "@vitejs/plugin-react";
import merge from "lodash.merge";
import mimeTypes from "mime-types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import svgrPlugin from "vite-plugin-svgr";

import { createEJSContext, ENVIRONMENT, getCommonViteConfig, getElectronVendorsCache, PROJECT_HOME, sourceEnv, sourcemap } from "./vite.config.common.mjs";

import pkg from "./package.json";

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
          } else if (req.originalUrl?.includes("/docs")) {
            let resource = path.join(__dirname, `${req.originalUrl}`);
            if (fs.lstatSync(resource).isDirectory()) {
              resource = path.join(resource, "index.html");
              res.setHeader("Content-Type", mimeTypes.lookup(resource) || "application/octet-stream");
              res.setHeader("Location", "/docs/index.html");
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
    name: "docs-server"
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
  console.debug(`Website running at http://${host === "0.0.0.0" ? "localhost" : host}:${port}/docs/index.html`);
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
      react(),
      svgrPlugin(),
      ViteEjsPlugin(ejsContext)
    ],
    publicDir: "./public",
    build: {
      target: `chrome${cache.chrome}`,
      sourcemap: sourcemap,
      emptyOutDir: false
    },
    rollupOptions: {
      input: path.join(PROJECT_HOME, "index.html")
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: "globalThis"
        }
      }
    },
    outputName: "renderer"
  });
  return viteConfig;
};

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  let host = process.env.HOST || "0.0.0.0";
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
        strict: true
      }
    }
  });
  config.base = "";
  config.build.rollupOptions.external = ["electron"];
  return config;
};
