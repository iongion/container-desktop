// WebdriverIO config for driving the real Tauri app over W3C WebDriver (WebKitGTK has no CDP). Pipeline:
//   WebdriverIO ──4444──▶ tauri-driver ──▶ WebKitWebDriver ──▶ container-desktop (the Tauri app)
// tauri-driver is the official Tauri harness (https://v2.tauri.app/develop/tests/webdriver/example/webdriverio/).
//
// Run:  yarn test:e2e:tauri
// Prereqs (all already provisioned on this box):
//   • tauri-driver     → ~/.cargo/bin/tauri-driver          (cargo install tauri-driver --locked)
//   • WebKitWebDriver  → /usr/bin/WebKitWebDriver           (sudo apt install webkitgtk-webdriver)
//   • the app binary   → src-tauri/target/debug/container-desktop (kept fresh by a running `yarn tauri dev`)
//
// The DEBUG binary loads the renderer from the Vite dev server (devUrl http://localhost:3000), so a
// `yarn tauri dev` (or `yarn tauri:serve`) must be serving :3000 during the run. Point at a self-contained
// RELEASE binary instead with CONTAINER_DESKTOP_E2E_APP=…/target/release/container-desktop (no Vite needed).
//
// Single-instance: the app skips tauri-plugin-single-instance when CONTAINER_DESKTOP_E2E is set (see
// src-tauri/src/lib.rs), so this launched instance runs standalone ALONGSIDE the developer's running app
// instead of forwarding-and-exiting. That env is set in beforeSession and inherited down the process chain.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const APP_BINARY = process.env.CONTAINER_DESKTOP_E2E_APP ?? path.join(repoRoot, "src-tauri/target/debug/container-desktop");
const NATIVE_DRIVER = process.env.WEBKIT_WEB_DRIVER ?? "/usr/bin/WebKitWebDriver";
const TAURI_DRIVER = process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver");

let tauriDriver;

export const config = {
  runner: "local",
  host: "127.0.0.1",
  port: 4444,
  specs: [path.join(__dirname, "specs", "**", "*.e2e.js")],
  maxInstances: 1,
  capabilities: [
    {
      // tauri-driver reads this to launch the app under WebKitWebDriver.
      "tauri:options": { application: APP_BINARY },
    },
  ],
  logLevel: "warn",
  bail: 0,
  // The debug binary is large and boots + connects to engines before it is interactive — be patient.
  waitforTimeout: 20000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 180000 },

  onPrepare: () => {
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
  },

  beforeSession: () => {
    // Run standalone next to the developer's app (see the single-instance note above). Inherited by
    // tauri-driver → WebKitWebDriver → the app.
    process.env.CONTAINER_DESKTOP_E2E = "1";
    tauriDriver = spawn(TAURI_DRIVER, ["--native-driver", NATIVE_DRIVER], {
      stdio: [null, process.stdout, process.stderr],
      env: process.env,
    });
    tauriDriver.on("error", (error) => {
      console.error("tauri-driver failed to start:", error);
      process.exit(1);
    });
  },

  afterSession: () => {
    tauriDriver?.kill();
  },
};
