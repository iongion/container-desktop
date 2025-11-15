import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// vendors
import ncc from "@vercel/ncc";
import * as dotenv from "dotenv";
import merge from "lodash.merge";
import MagicString from "magic-string";
import { checker } from "vite-plugin-checker";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";

// pkg
import pkg from "./package.json";

export function createSingleFile(patch) {
  let currentOutputConfig = {};
  return [
    {
      name: "create-single-file",
      apply: "build",
      async writeBundle(outputConfig) {
        currentOutputConfig = outputConfig;
      },
      async closeBundle() {
        const outFile = path.join(currentOutputConfig.dir, currentOutputConfig.entryFileNames);
        if (!outFile.endsWith(".mjs")) {
          console.debug("Skipped from bundling", outFile);
          return;
        }
        await new Promise((resolve, reject) => {
          ncc(outFile, {
            externals: ["electron"],
            cache: false,
            minify: true,
            sourceMap: false,
            quiet: false,
            target: "es2020",
            debugLog: true,
          })
            .then(({ code, map, assets }) => {
              // ssh2 issues
              const singleFile = outFile;
              const s = new MagicString(code);
              s.prepend(`
                import __path from 'path';
                import { fileURLToPath as __fileURLToPath } from 'url';
                import { createRequire as __createRequire } from 'module';
                if (typeof __dirname === 'undefined') {
                  const __getFilename = () => __fileURLToPath(import.meta.url);
                  const __getDirname = () => __path.dirname(__getFilename());
                  const __dirname = __getDirname();
                  const __filename = __getFilename();
                  const self = globalThis;
                  const require = __createRequire(import.meta.url);
                  self.__filename = __filename;
                  self.__dirname = __dirname;
                }
               `);
              fs.writeFileSync(singleFile, patch ? s.toString() : code, "utf8");
              Object.keys(assets).forEach((asset) => {
                const assetFilePath = path.join(currentOutputConfig.dir, asset);
                fs.mkdirSync(path.dirname(assetFilePath), { recursive: true });
                fs.writeFileSync(assetFilePath, assets[asset].source);
              });
              console.debug("Single file generated");
              resolve();
            })
            .catch(reject);
        });
        console.debug("<<< BUNDLE CLOSED >>>", outFile);
      },
    },
  ];
}

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
    // Fix
    __dirname: "import.meta.dirname",
  };
  const minify = false; // mode === "production";
  const outputExtension = outputFormat === "umd" ? "js" : "mjs";
  const config = {
    clearScreen: false,
    plugins: [
      // viteCommonjs(),
      topLevelAwait(),
      checker({
        typescript: true,
      }),
      tsconfigPaths(),
      ...(plugins ?? []),
    ],
    define: userDefine,
    build: {
      target: "es2020",
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
          format: outputFormat === "umd" ? "umd" : "es",
          inlineDynamicImports: false,
          assetFileNames: `assets/${outputName}-${pkg.version}.[ext]`,
          entryFileNames: `${outputName}-${pkg.version}.${outputExtension}`,
          chunkFileNames: `${outputName}-${pkg.version}.[hash].${outputExtension}`,
        },
      }),
    },
    resolve: merge(
      {},
      {
        alias: {
          "@": path.resolve(__dirname, "src"),
        },
      },
      resolve ?? {},
    ),
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
    // Features
    "import.meta.env.FEATURE_WSL_RELAY_METHOD": JSON.stringify(process.env.FEATURE_WSL_RELAY_METHOD),
    // Bugs
    "process.env.NODE_DEBUG": JSON.stringify(false),
  };
  return define;
};
