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
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const APP_BINARY =
  process.env.CONTAINER_DESKTOP_E2E_APP ?? path.join(repoRoot, "src-tauri/target/debug/container-desktop");
const NATIVE_DRIVER = process.env.WEBKIT_WEB_DRIVER ?? "/usr/bin/WebKitWebDriver";
const TAURI_DRIVER = process.env.TAURI_DRIVER ?? path.join(os.homedir(), ".cargo", "bin", "tauri-driver");

// A throwaway user-data dir the e2e app is pinned to (see beforeSession), so it never touches the developer's
// daily release-app data. get_user_data_path honors this on every shell.
const E2E_USER_DATA = process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(repoRoot, "webdriver", ".e2e-user-data");
// Where workspace-access.e2e.js's fixture workspace lives (a subdir of the isolated data dir).
const E2E_WORKSPACE = path.join(E2E_USER_DATA, "workspace-fixture");

let tauriDriver;

export const config = {
  runner: "local",
  host: "127.0.0.1",
  port: 4444,
  // Two suites, and the difference is what a FAILURE is allowed to mean.
  //
  //   specs/*.e2e.js  — the mock app only. Nothing outside the app is involved, so a failure can only mean the
  //                     app is wrong. These always run and are never gated on anything.
  //   smoke/*.smoke.js — real integration: real engines, real machines, a real account, a real model. Their
  //                     SUBJECT is the integration, so when the thing they integrate with is absent there is
  //                     nothing to prove — they skip and say what was missing (webdriver/support/prerequisites.js).
  //                     Failing there would blame the app; passing would claim coverage nobody has.
  //
  // This config IS the e2e suite. The smoke one has its own config (wdio.smoke.conf.js), which reuses everything
  // here except `specs` — deliberately not a `--suite`, because a suite in the run script stops `--spec` from
  // narrowing anything, and on that suite a full run starts real containers.
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
    // Seed the isolated user-data dir BEFORE the app launches. Doing this at runtime from a spec races the app's
    // own first-run settings write (which clobbered ai.workspaceRoot); pre-seeding wins the race deterministically.
    // Start clean so every run has an identical fixture + settings, then let the app merge its own keys on top.
    rmSync(E2E_USER_DATA, { recursive: true, force: true });
    mkdirSync(E2E_WORKSPACE, { recursive: true });
    writeFileSync(path.join(E2E_WORKSPACE, "package.json"), '{ "name": "demo" }\n');
    writeFileSync(path.join(E2E_WORKSPACE, "greeting.txt"), "hello world\nsecond line\n");
    // Pre-set ai.workspaceRoot (for workspace-access) and mark first-run handled so the app does not overwrite
    // settings during boot. The app reads user-settings.json fresh per getAISettings call, so this is authoritative.
    writeFileSync(
      path.join(E2E_USER_DATA, "user-settings.json"),
      `${JSON.stringify({ ai: { workspaceRoot: E2E_WORKSPACE }, wizard: { skipAtStartup: true } }, null, 2)}\n`,
    );
  },

  beforeSession: () => {
    // Run standalone next to the developer's app (see the single-instance note above). Inherited by
    // tauri-driver → WebKitWebDriver → the app.
    process.env.CONTAINER_DESKTOP_E2E = "1";
    // The AI specs require the mock app — the renderer reads CONTAINER_DESKTOP_MOCK from the APP's process env
    // via the Tauri bridge, so it must be set HERE (on the wdio process that spawns the app), not merely on the
    // Vite dev server. Preserve any caller override so a non-mock run stays possible.
    process.env.CONTAINER_DESKTOP_MOCK ??= "1";
    // Isolate ALL app state (settings, logs, workspace fixtures) in a throwaway dir so the e2e app never touches
    // the developer's daily release-app data. get_user_data_path honors this override on every shell (the Tauri
    // Rust path has no `-dev` suffix of its own, so without this the debug binary would
    // read/write ~/.config/container-desktop — the release app's dir).
    process.env.CONTAINER_DESKTOP_USER_DATA_DIR ??= E2E_USER_DATA;
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
