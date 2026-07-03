import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// vendors
import merge from "deepmerge";
import * as dotenv from "dotenv";
import { checker } from "vite-plugin-checker";

// pkg
import pkg from "./package.json";
// Single source of truth for the window chrome (logo + window controls), shared with the React header.
// Injected into index.html's boot splash via the EJS context below so the static, pre-React chrome never
// drifts from the live one. Dependency-free strings, safe to import at config-load time.
import { BOOT_CHROME_BODY, BOOT_CHROME_SCRIPT, BOOT_CHROME_STYLE } from "./src/web-app/chrome/appChrome";

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
  return { chrome: "128", node: "24" };
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
    ENVIRONMENT,
    // Boot window chrome, injected raw (<%- %>) into index.html — single source shared with the React header.
    BOOT_CHROME_STYLE,
    BOOT_CHROME_BODY,
    BOOT_CHROME_SCRIPT,
  };
}
export const sourcemap = ENVIRONMENT === "development";

/**
 * @type {import('vite').UserConfig}
 * @see https://vitejs.dev/config/
 */
export function getCommonViteConfig({ mode, define, resolve, outputName, outputFormat, plugins, rollupOptions }) {
  const userDefine = {
    // Define default environment variables
    ...createDefine(mode),
    // Define user overridden environment variables
    ...define,
    // In ESM output `__dirname` is unavailable, so map it to import.meta.dirname.
    // In CJS output (main/preload) `__dirname` is native — leave it untouched.
    ...(outputFormat === "cjs" ? {} : { __dirname: "import.meta.dirname" }),
  };
  const minify = false; // mode === "production";
  const outputExtension = outputFormat === "umd" ? "js" : outputFormat === "cjs" ? "cjs" : "mjs";
  const config = {
    clearScreen: false,
    plugins: [
      checker({
        typescript: true,
      }),
      // tsconfig path mappings are resolved by the explicit `resolve.alias` block below
      // (Vite 8 also supports them natively); the vite-tsconfig-paths plugin is redundant.
      ...(plugins ?? []),
    ],
    define: userDefine,
    build: {
      target: "es2022",
      outDir: path.join(__dirname, "build", pkg.version),
      emptyOutDir: false,
      sourcemap: sourcemap,
      chunkSizeWarningLimit: 50 * 1024,
      reportCompressedSize: mode === "production",
      minify: minify,
      cssMinify: minify,
      // One CSS file for the renderer instead of per-component chunks.
      cssCodeSplit: false,
      rollupOptions: merge.all([rollupOptions || {}, {
        output: {
          preserveModules: false,
          format: outputFormat === "umd" ? "umd" : outputFormat === "cjs" ? "cjs" : "es",
          // Single file per target: disable chunk splitting so dynamic imports are inlined
          // into the entry instead of emitting hashed chunk siblings.
          codeSplitting: false,
          // Version is the output directory (build/<version>/), not a filename suffix.
          assetFileNames: `assets/${outputName}.[ext]`,
          entryFileNames: `${outputName}.${outputExtension}`,
        },
      }]),
    },
    resolve: merge.all([
      {
        alias: {
          "@": path.resolve(__dirname, "src"),
          "@/container-client": path.resolve(__dirname, "src/container-client"),
          "@/container-provisioning": path.resolve(__dirname, "src/container-provisioning"),
          "@/electron-shell": path.resolve(__dirname, "src/electron-shell"),
          "@/env": path.resolve(__dirname, "src/env"),
          "@/logger": path.resolve(__dirname, "src/logger"),
          "@/platform": path.resolve(__dirname, "src/platform"),
          "@/resources": path.resolve(__dirname, "src/resources"),
          "@/rpc": path.resolve(__dirname, "src/rpc"),
          "@/utils": path.resolve(__dirname, "src/utils"),
          "@/web-app": path.resolve(__dirname, "src/web-app"),
          "@/ai-system": path.resolve(__dirname, "src/ai-system"),
        },
      },
      resolve ?? {},
    ]),
  };
  return config;
}

export const createDefine = (mode) => {
  // Bootstrap
  const define = {
    "import.meta.env.TARGET": `"${os.type()}"`,
    // Define environment variables
    "import.meta.env.NODE_ENV": `"${mode}"`,
    "import.meta.env.ENVIRONMENT": JSON.stringify(ENVIRONMENT),
    "import.meta.env.PUBLIC_URL": JSON.stringify("."),
    "import.meta.env.PROJECT_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.PROJECT_NAME": JSON.stringify(pkg.name),
    "import.meta.env.PROJECT_TITLE": JSON.stringify(pkg.title),
    "import.meta.env.PROJECT_DESCRIPTION": JSON.stringify(pkg.description),
    "import.meta.env.ONLINE_API": JSON.stringify(process.env.ONLINE_API),
    "import.meta.env.CONTAINER_DESKTOP_BOOTSTRAP_PREVIEW_DELAY": JSON.stringify(
      process.env.CONTAINER_DESKTOP_BOOTSTRAP_PREVIEW_DELAY === "true",
    ),
    // Build-time FALLBACK for the renderer log level. The runtime source is the preload bridge
    // (preload.ts exposes the live CONTAINER_DESKTOP_LOG_LEVEL), so the level can change at launch without a
    // rebuild; this baked value only applies if that bridge is unavailable. Defaults to "warn".
    "import.meta.env.CONTAINER_DESKTOP_LOG_LEVEL": JSON.stringify(process.env.CONTAINER_DESKTOP_LOG_LEVEL || "warn"),
    // Bugs
    "process.env.NODE_DEBUG": JSON.stringify(false),
  };
  return define;
};
