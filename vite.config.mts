import path from "node:path";
// vendors
import { viteCommonjs } from "@originjs/vite-plugin-commonjs";
import inject from "@rollup/plugin-inject";
import react from "@vitejs/plugin-react";
import { ModuleFormat, RollupOptions } from "rollup";
import { UserConfig, defineConfig } from "vite";
import { checker } from "vite-plugin-checker";
import { ViteEjsPlugin } from "vite-plugin-ejs";
import electron from "vite-plugin-electron/simple";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import svgrPlugin from "vite-plugin-svgr";
import topLevelAwait from "vite-plugin-top-level-await";
import tsconfigPaths from "vite-tsconfig-paths";

// pkg
import pkg from "./package.json";

// module
const ENVIRONMENT = process.env.ENVIRONMENT || "development";
const PROJECT_HOME = path.resolve(__dirname);
const APP_MAIN = "application";

export function createEJSContext() {
  return {
    name: pkg.name,
    title: pkg.title,
    description: pkg.description,
    version: pkg.version,
    environment: ENVIRONMENT,
    env_code: ENVIRONMENT[0].toLowerCase(),
    PUBLIC_URL: ".",
    PROJECT_VERSION: pkg.version,
    PROJECT_TITLE: pkg.title,
    PROJECT_DESCRIPTION: pkg.description,
    ENVIRONMENT
  };
}

export function getCommonViteConfig({
  mode,
  define,
  resolve,
  outputName,
  plugins,
  rollupOptions
}: Partial<UserConfig> & { outputName: string; rollupOptions?: Partial<RollupOptions> }) {
  const minify = false; // mode === "production";
  const config: Partial<UserConfig> = {
    plugins: [
      viteCommonjs(),
      topLevelAwait(),
      checker({
        typescript: true
      }),
      tsconfigPaths(),
      ...(plugins ?? [])
    ],
    define,
    build: {
      outDir: path.join(__dirname, "build"),
      emptyOutDir: false,
      sourcemap: true,
      chunkSizeWarningLimit: 50 * 1024,
      reportCompressedSize: mode === "production",
      minify: minify,
      cssMinify: minify,
      rollupOptions: {
        ...(rollupOptions || {}),
        output: {
          manualChunks: (filename) => outputName,
          preserveModules: false,
          format: "esm" as ModuleFormat,
          inlineDynamicImports: false,
          assetFileNames: `assets/[name]-${pkg.version}.[ext]`,
          entryFileNames: `[name]-${pkg.version}.mjs`,
          chunkFileNames: `[name]-${pkg.version}.[hash].mjs`
        }
      }
    },
    resolve
  };
  return config;
}

/** @type {import('vite').UserConfig} */
export const createConfig = ({ mode, command, host, port }) => {
  console.debug({ PROJECT_HOME, command, host, port });
  // Bootstrap
  // Build context
  const ejsContext = createEJSContext();
  const define = {
    // Define environment variables
    "import.meta.env.NODE_ENV": `"${mode}"`,
    "import.meta.env.ENVIRONMENT": JSON.stringify(ENVIRONMENT),
    "import.meta.env.PUBLIC_URL": JSON.stringify("."),
    "import.meta.env.PROJECT_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.PROJECT_NAME": JSON.stringify(pkg.name),
    "import.meta.env.PROJECT_TITLE": JSON.stringify(pkg.title),
    "import.meta.env.PROJECT_DESCRIPTION": JSON.stringify(pkg.description)
  };
  const resolve = {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  };
  if (mode !== "test") {
    console.debug("Environment", define);
  }
  // vite electron
  const viteConfig = getCommonViteConfig({
    mode,
    define,
    resolve,
    // app specific
    outputName: APP_MAIN,
    plugins: [
      // All current plugins are extending the Vite configuration
      // Frontend specific
      nodePolyfills(),
      react(),
      svgrPlugin(),
      ViteEjsPlugin(ejsContext),
      // Electron specific
      electron({
        main: {
          // Shortcut of `build.lib.entry`
          entry: "src/electron-shell/main.ts",
          onstart(args) {
            if (process.env.VSCODE_DEBUG) {
              console.log("[startup] Electron App");
            } else {
              args.startup();
            }
          },
          vite: getCommonViteConfig({ mode, define, resolve, outputName: "main" })
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: "src/electron-shell/preload.ts",
          vite: getCommonViteConfig({ mode, define, resolve, outputName: "preload" })
        }
      })
    ],
    publicDir: "./public",
    rollupOptions: {
      input: {
        application: path.join(PROJECT_HOME, "index.html")
      },
      plugins: [inject({ Buffer: ["buffer", "Buffer"] })]
    },
    optimizeDeps: {
      esbuildOptions: {
        define: {
          global: "globalThis"
        }
      }
    }
  });
  // Only entry point is allowed to empty outDir
  viteConfig.build.emptyOutDir = true;
  return viteConfig;
};

export default ({ mode, command }) => {
  let host = process.env.HOST || "0.0.0.0";
  const port = Number(process.env.PORT) || 3000;
  const config = createConfig({ mode, command, host, port });
  return defineConfig({
    ...config,
    clearScreen: false,
    server: {
      host,
      port,
      strictPort: true,
      cors: true,
      watch: {}
    }
  });
};
