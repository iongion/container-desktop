import { ENVIRONMENT, getCommonViteConfig, getElectronVendorsCache, sourceEnv } from "./vite.config.common.mjs";

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  sourceEnv(ENVIRONMENT);
  const cache = getElectronVendorsCache();
  const config = getCommonViteConfig({ mode: mode || process.env.MODE || "development", command, outputName: "preload" });
  config.build.ssr = true;
  config.build.target = `node${cache.node}`;
  config.build.lib = {
    entry: "src/electron-shell/preload.ts",
    formats: ["es"]
  };
  // config.build.manifest = true;
  config.build.rollupOptions.external = ["electron"];
  config.build.rollupOptions.preserveEntrySignatures = "exports-only";
  config.build.rollupOptions.output.exports = "auto";
  config.build.rollupOptions.output.format = "es";
  if (ENVIRONMENT === "production") {
    // config.plugins.push(createSingleFile(false));
  }
  return config;
};
