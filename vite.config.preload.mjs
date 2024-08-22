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
    // fileName: "preload"
  };
  config.build.rollupOptions.external = ["electron"];
  console.debug("<<< PRELOAD >>>", config);
  return config;
};
