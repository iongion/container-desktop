import path from "node:path";
import { normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

import { createSingleFile, ENVIRONMENT, getCommonViteConfig, getElectronVendorsCache, PROJECT_HOME, sourceEnv } from "./vite.config.common.mjs";

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  sourceEnv(ENVIRONMENT);
  const cache = getElectronVendorsCache();
  const outputFormat = "es";
  const config = getCommonViteConfig({ mode: mode || process.env.MODE || "development", command, outputName: "main", outputFormat });
  config.build.emptyOutDir = false;
  config.build.ssr = true;
  config.build.target = `node${cache.node}`;
  config.build.lib = {
    name: "main",
    entry: "src/electron-shell/main.ts",
    formats: [outputFormat]
  };
  // config.build.manifest = true;
  config.build.rollupOptions.external = ["electron", "electron-dl", "electron-context-menu"];
  config.build.rollupOptions.preserveEntrySignatures = "exports-only";
  config.build.rollupOptions.output.exports = "auto";
  config.build.rollupOptions.output.format = outputFormat;
  if (ENVIRONMENT === "production") {
    config.plugins.push(createSingleFile(false));
    config.plugins.push(
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(path.resolve(PROJECT_HOME, "support/resources/appx")),
            dest: normalizePath(path.resolve(PROJECT_HOME, "build"))
          }
        ]
      })
    );
  }
  return config;
};
