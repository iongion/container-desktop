import { createSingleFile, ENVIRONMENT, getCommonViteConfig, getElectronVendorsCache, sourceEnv } from "./vite.config.common.mjs";

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  sourceEnv(ENVIRONMENT);
  const cache = getElectronVendorsCache();
  const outputFormat = "es";
  const config = getCommonViteConfig({ mode: mode || process.env.MODE || "development", command, outputName: "preload", outputFormat: outputFormat });
  config.build.emptyOutDir = false;
  config.build.ssr = true;
  config.build.target = `node${cache.node}`;
  config.build.lib = {
    name: "preload",
    entry: "src/electron-shell/preload.ts",
    formats: [outputFormat]
  };
  // config.build.manifest = true;
  config.build.rollupOptions.external = ["electron", "electron-dl", "electron-context-menu"];
  config.build.rollupOptions.preserveEntrySignatures = "exports-only";
  config.build.rollupOptions.output.exports = "auto";
  config.build.rollupOptions.output.format = outputFormat;
  if (ENVIRONMENT === "production") {
    config.plugins.push(createSingleFile(false));
  }
  return config;
};
