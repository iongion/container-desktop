import path from "node:path";
import fs from "node:fs";
import { normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

import pkg from "./package.json";
import { ENVIRONMENT, getCommonViteConfig, getElectronVendorsCache, PROJECT_HOME, sourceEnv } from "./vite.config.common.mjs";

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export default ({ mode, command }) => {
  sourceEnv(ENVIRONMENT);
  const cache = getElectronVendorsCache();
  const runtimeIconsDir = path.resolve(PROJECT_HOME, "src/resources/icons");
  const buildOutputDir = path.resolve(PROJECT_HOME, "build", pkg.version);
  // Main process is bundled as CommonJS (electron exposes its API via the CJS
  // require hook, not as ESM named exports). Source stays ESM/TS; only the output
  // is CJS. This mirrors the industry-standard electron + vite setup.
  const outputFormat = "cjs";
  const config = getCommonViteConfig({ mode: mode || process.env.MODE || "development", command, outputName: "main", outputFormat });
  // Main builds first in `yarn build`; clean the versioned output directory once,
  // then let preload/renderer add their files without wiping main.cjs. In dev watch,
  // preload builds before main, so do not let the main watcher delete preload.cjs.
  config.build.emptyOutDir = !process.env.VITE_DEV_SERVER_URL;
  config.build.ssr = true;
  // build.ssr auto-externalizes node_modules, which breaks ESM-only deps when
  // require()'d from the CJS bundle. Bundle everything except electron (provided by
  // the runtime) so the bundler resolves all interop at build time.
  config.ssr = { ...(config.ssr || {}), noExternal: true };
  config.build.target = `node${cache.node}`;
  config.build.lib = {
    name: "main",
    entry: "src/packages/platform/src/electron/main.ts",
    formats: [outputFormat]
  };
  // Only electron itself is provided by the runtime and must stay external. The
  // electron helper libs are bundled so the bundler applies CJS interop to their
  // `import { ... } from "electron"` (they ship raw ESM that cannot link otherwise).
  config.build.rollupOptions.external = ["electron"];
  config.build.rollupOptions.preserveEntrySignatures = "exports-only";
  config.build.rollupOptions.output.exports = "auto";
  config.build.rollupOptions.output.format = outputFormat;
  config.plugins.push({
    name: "copy-runtime-icons",
    closeBundle() {
      fs.mkdirSync(buildOutputDir, { recursive: true });
      for (const fileName of fs.readdirSync(runtimeIconsDir)) {
        const source = path.join(runtimeIconsDir, fileName);
        if (fs.statSync(source).isFile()) {
          fs.copyFileSync(source, path.join(buildOutputDir, fileName));
        }
      }
    }
  });
  if (ENVIRONMENT === "production") {
    config.plugins.push(
      viteStaticCopy({
        targets: [
          {
            src: normalizePath(path.resolve(PROJECT_HOME, "support/resources/appx")),
            dest: normalizePath(path.resolve(PROJECT_HOME, "build", pkg.version))
          },
          {
            src: normalizePath(path.resolve(PROJECT_HOME, "support/gnome-shell-extension")),
            dest: normalizePath(path.resolve(PROJECT_HOME, "build", pkg.version))
          }
        ]
      })
    );
  }
  return config;
};
