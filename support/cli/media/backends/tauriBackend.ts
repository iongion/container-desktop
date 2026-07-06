import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { remote } from "webdriverio";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { RUNTIME_NAME_SHIM } from "../drivers/runtimeShim";
import type { CaptureApp, CaptureBackend, LaunchOptions } from "../drivers/types";
import { createWebdriverDriver } from "../drivers/webdriverDriver";

// Tauri capture lifecycle: WebdriverIO (programmatic remote()) → tauri-driver → WebKitWebDriver → the
// Tauri app. Mirrors webdriver/wdio.conf.js. Per-engine mock is set on the launched app's process env
// (CONTAINER_DESKTOP_MOCK) — the renderer reads it at runtime via invoke("get_env_var") — so one running
// vite serve covers every engine; only the env differs per launch. CONTAINER_DESKTOP_E2E gates the
// single-instance plugin OFF (src-tauri/src/lib.rs) so this runs standalone.

const ROOT = PROJECT_HOME;
const TAURI_DRIVER_PORT = 4444;
const DEV_URL_PORT = 3000;

const APP_BINARY =
  process.env.CONTAINER_DESKTOP_E2E_APP ?? path.join(ROOT, "src-tauri", "target", "debug", "container-desktop");
const NATIVE_DRIVER = process.env.WEBKIT_WEB_DRIVER ?? "/usr/bin/WebKitWebDriver";
const TAURI_DRIVER = process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver");

// The debug binary loads the renderer from the Vite dev server (devUrl :3000); a release binary embeds it.
const USES_DEV_URL = APP_BINARY.includes(`${path.sep}debug${path.sep}`);

function assertPrereqs() {
  if (!existsSync(APP_BINARY)) {
    throw new Error(
      `Tauri app binary not found: ${APP_BINARY}\n` +
        "A running `yarn tauri dev` keeps the debug binary fresh, or set CONTAINER_DESKTOP_E2E_APP to a built binary.",
    );
  }
  if (!existsSync(NATIVE_DRIVER)) {
    throw new Error(
      `WebKitWebDriver not found: ${NATIVE_DRIVER}\n` +
        "Install it (`sudo apt install webkitgtk-webdriver`) or set WEBKIT_WEB_DRIVER.",
    );
  }
  if (!existsSync(TAURI_DRIVER)) {
    throw new Error(
      `tauri-driver not found: ${TAURI_DRIVER}\n` +
        "Install it (`cargo install tauri-driver --locked`) or set TAURI_DRIVER.",
    );
  }
}

function portIsOpen(port: number, host = "127.0.0.1", timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function tauriEnv(engine: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Gate single-instance OFF and select the mock engine on the launched app's own process env.
  env.CONTAINER_DESKTOP_E2E = "1";
  env.CONTAINER_DESKTOP_MOCK = engine;
  env.CONTAINER_DESKTOP_DISABLE_EXTERNAL_OPEN = "1";
  env.ENVIRONMENT = "development";
  env.NODE_ENV = "development";
  env.CI = env.CI || "true";
  return env;
}

async function waitForPreload(browser: any, timeoutMs = 90_000) {
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(() => (globalThis as any).Preloaded === true);
      } catch {
        return false;
      }
    },
    { timeout: timeoutMs, interval: 500, timeoutMsg: "Tauri app preload bridge did not initialize" },
  );
}

export const tauriBackend: CaptureBackend = {
  kind: "tauri",

  async launch(opts: LaunchOptions): Promise<CaptureApp> {
    assertPrereqs();
    if (USES_DEV_URL && !(await portIsOpen(DEV_URL_PORT))) {
      throw new Error(
        `The Tauri debug binary loads the renderer from http://localhost:${DEV_URL_PORT}, but nothing is serving it.\n` +
          "Start it first:  CONTAINER_DESKTOP_MOCK=1 yarn tauri:serve\n" +
          "Or point CONTAINER_DESKTOP_E2E_APP at a self-contained release binary.",
      );
    }
    const env = tauriEnv(opts.engine);
    const tauriDriver = spawn(TAURI_DRIVER, ["--native-driver", NATIVE_DRIVER], {
      stdio: ["ignore", "inherit", "inherit"],
      env,
    });
    let browser: any;
    try {
      // Give tauri-driver a moment to bind its port before WebdriverIO connects.
      await new Promise((resolve) => setTimeout(resolve, 750));
      browser = await remote({
        logLevel: "error",
        hostname: "127.0.0.1",
        port: TAURI_DRIVER_PORT,
        path: "/",
        connectionRetryCount: 3,
        connectionRetryTimeout: 180_000,
        capabilities: { "tauri:options": { application: APP_BINARY } } as any,
      });
      await waitForPreload(browser);
      // Frameless window → outer size ≈ inner size; size it to the capture viewport.
      await browser.setWindowSize(opts.viewport.width, opts.viewport.height);
      // Install the esbuild __name shim before any driver.evaluate. Injected via an eval wrapper so the
      // bootstrap itself is never esbuild-rewritten to reference __name (see runtimeShim.ts).
      await browser.execute((src: string) => {
        // biome-ignore lint/security/noGlobalEval: installs the __name shim in the app realm via WebDriver
        eval(src);
      }, RUNTIME_NAME_SHIM);
      return {
        driver: createWebdriverDriver(browser),
        async close() {
          await browser?.deleteSession().catch(() => {});
          tauriDriver.kill();
        },
      };
    } catch (error) {
      await browser?.deleteSession().catch(() => {});
      tauriDriver.kill();
      throw error;
    }
  },

  async killStray(): Promise<void> {
    for (const pattern of ["tauri-driver", "WebKitWebDriver"]) {
      await new Promise((resolve) => {
        const child = spawn("pkill", ["-f", pattern], { stdio: "ignore" });
        child.once("exit", resolve);
        child.once("error", resolve);
      });
    }
  },
};
