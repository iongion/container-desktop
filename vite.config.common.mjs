import fs from "node:fs";
import path from "node:path";
// vendors
import * as dotenv from "dotenv";
import { merge } from "lodash-es";
import { checker } from "vite-plugin-checker";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";

// pkg
import pkg from "./package.json";

// module
export const ENVIRONMENT = process.env.ENVIRONMENT || "development";
export const PROJECT_HOME = path.resolve(__dirname);
export const APP_MAIN = "application";
export const ELECTRON_VENDORS_CACHE_PATH = path.join(PROJECT_HOME, ".electron-vendors.cache.json");
export function getElectronVendorsCache() {
  if (fs.existsSync(ELECTRON_VENDORS_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(ELECTRON_VENDORS_CACHE_PATH, "utf8"));
    return cache;
  }
  return { chrome: "128", node: "20" };
}
export function sourceEnv(env) {
  // template
  dotenv.config({ path: path.join(PROJECT_HOME, ".env") });
  dotenv.config({ path: path.join(PROJECT_HOME, ".env.local"), override: true });
  // target env
  dotenv.config({ path: path.join(PROJECT_HOME, `.env.${env}`), override: true });
  dotenv.config({ path: path.join(PROJECT_HOME, `.env.${env}.local`), override: true });
}
export function createEJSContext() {
  return {
    name: pkg.name,
    title: pkg.title,
    description: pkg.description,
    version: pkg.version,
    environment: ENVIRONMENT,
    PUBLIC_URL: ".",
    PROJECT_VERSION: pkg.version,
    PROJECT_TITLE: pkg.title,
    PROJECT_DESCRIPTION: pkg.description,
    ENVIRONMENT
  };
}
export const sourcemap = true;

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export function getCommonViteConfig({ mode, define, resolve, outputName, plugins, rollupOptions }) {
  const userDefine = {
    // Define environment variables
    "import.meta.env.NODE_ENV": `"${mode}"`,
    "import.meta.env.ENVIRONMENT": JSON.stringify(ENVIRONMENT),
    "import.meta.env.PUBLIC_URL": JSON.stringify("."),
    "import.meta.env.PROJECT_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.PROJECT_NAME": JSON.stringify(pkg.name),
    "import.meta.env.PROJECT_TITLE": JSON.stringify(pkg.title),
    "import.meta.env.PROJECT_DESCRIPTION": JSON.stringify(pkg.description),
    "import.meta.env.ONLINE_API": JSON.stringify(process.env.ONLINE_API),
    // Bugs
    "process.env.NODE_DEBUG": JSON.stringify(false),
    // Defines
    ...define
  };
  const minify = false; // mode === "production";
  const config = {
    clearScreen: false,
    plugins: [
      // viteCommonjs(),
      topLevelAwait(),
      checker({
        typescript: true
      }),
      tsconfigPaths(),
      ...(plugins ?? [])
    ],
    define: userDefine,
    build: {
      outDir: path.join(__dirname, "build"),
      emptyOutDir: false,
      sourcemap: sourcemap,
      chunkSizeWarningLimit: 50 * 1024,
      reportCompressedSize: mode === "production",
      minify: minify,
      cssMinify: minify,
      rollupOptions: merge({}, rollupOptions || {}, {
        output: {
          manualChunks: (filename) => outputName,
          preserveModules: false,
          // format: "esm",
          inlineDynamicImports: false,
          assetFileNames: `assets/${outputName}-${pkg.version}.[ext]`,
          entryFileNames: `${outputName}-${pkg.version}.mjs`,
          chunkFileNames: `${outputName}-${pkg.version}.[hash].mjs`
        }
      })
    },
    resolve: merge(
      {},
      {
        alias: {
          "@": path.resolve(__dirname, "src")
        }
      },
      resolve ?? {}
    )
  };
  return config;
}

export const createDefine = (mode) => {
  // Bootstrap
  const define = {
    // Define environment variables
    "import.meta.env.NODE_ENV": `"${mode}"`,
    "import.meta.env.ENVIRONMENT": JSON.stringify(ENVIRONMENT),
    "import.meta.env.PUBLIC_URL": JSON.stringify("."),
    "import.meta.env.PROJECT_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.PROJECT_NAME": JSON.stringify(pkg.name),
    "import.meta.env.PROJECT_TITLE": JSON.stringify(pkg.title),
    "import.meta.env.PROJECT_DESCRIPTION": JSON.stringify(pkg.description),
    "import.meta.env.ONLINE_API": JSON.stringify(process.env.ONLINE_API),
    // Bugs
    "process.env.NODE_DEBUG": JSON.stringify(false)
  };
  return define;
};
