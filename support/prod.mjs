#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_HOME = path.dirname(__dirname);

const pkg = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(path.join(PROJECT_HOME, "package.json"), "utf8")),
);
const mainEntry = path.resolve(PROJECT_HOME, pkg.main);

if (!(await import("node:fs").then((fs) => fs.existsSync(mainEntry)))) {
  console.error(`[container-desktop] Built entry not found: ${mainEntry}`);
  console.error('[container-desktop] Run "yarn prod:build" first, or "yarn prod" which builds before launching.');
  process.exit(1);
}

// 9223, not Chrome's usual 9222 — that one routinely collides with a running podman API forward.
const remoteDebuggingPort = process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT || "9223";
const remoteDebuggingOrigin =
  process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN || `http://localhost:${remoteDebuggingPort}`;
// The renderer in production has no `process.env`; surface log level to main so
// `--enable-logging` shows startup traces.
const logLevel = process.env.CONTAINER_DESKTOP_LOG_LEVEL || "debug";

// Electron must NOT inherit `ELECTRON_RUN_AS_NODE`: with it set, the Electron binary boots as a plain
// Node runtime. Some shells/terminals export it globally, so strip it here.
function electronEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  env.CONTAINER_DESKTOP_LOG_LEVEL = logLevel;
  return env;
}

function buildElectronArgs() {
  const args = [
    mainEntry,
    `--enable-logging`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--remote-allow-origins=${remoteDebuggingOrigin}`,
    "--no-sandbox",
  ];
  // Forward any extra CLI args so `yarn prod --ozone-platform=x11` works.
  for (const arg of process.argv.slice(2)) {
    args.push(arg);
  }
  return args;
}

console.log(`[container-desktop] Launching production build (log=${logLevel}, cdp=:${remoteDebuggingPort})`);
console.log(`[container-desktop] Entry: ${mainEntry}`);

const electronApp = spawn(String(electronPath), buildElectronArgs(), {
  stdio: "inherit",
  env: electronEnv(),
});

electronApp.on("exit", (code) => {
  process.exit(code ?? 0);
});

// Forward signals so Ctrl-C / SIGTERM reach Electron cleanly.
const shutdown = (signal) => {
  if (electronApp && !electronApp.killed) {
    try {
      electronApp.kill(signal);
    } catch {
      // already gone
    }
  }
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
