#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  captureWindow,
  freezeUi,
  navigate,
  resolveRoute,
  runPreActions,
  waitReady,
  waitForSelectorCount,
} from "./screenshotActions.mjs";
import {
  SCREENSHOT_ENGINES,
  SCREENSHOT_VIEWPORT,
  STALE_FLAT_SCREENSHOTS,
  screenshotManifest,
} from "./screenshots.manifest.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "website-src", "static", "img");
const DEFAULT_PORT = 9322;

function parseArgs(argv) {
  const args = { mode: "dev", killStray: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kill-stray") {
      args.killStray = true;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--mode") {
      args.mode = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function electronEnv(engine, port) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.CONTAINER_DESKTOP_MOCK = engine;
  env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT = `${port}`;
  env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN = `http://localhost:${port}`;
  env.ENVIRONMENT = "development";
  env.NODE_ENV = "development";
  env.CI = env.CI || "true";
  return env;
}

function commandFor(mode, port) {
  if (mode === "dev") {
    return { command: "yarn", args: ["dev"] };
  }
  if (mode === "built") {
    const version = require(path.join(ROOT, "package.json")).version;
    return {
      command: String(require("electron")),
      args: [
        path.join(ROOT, "build", version, "main.cjs"),
        `--remote-debugging-port=${port}`,
        `--remote-allow-origins=http://localhost:${port}`,
        "--no-sandbox",
      ],
    };
  }
  throw new Error(`Unsupported screenshot mode: ${mode}`);
}

async function waitForApp(port, timeoutMs = 60_000) {
  const endpoint = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      const page = await findAppPage(browser, timeoutMs);
      return { browser, page };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error(`Timed out waiting for ${endpoint}`);
}

async function findAppPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith("devtools://")) {
          continue;
        }
        const preloaded = await page.evaluate(() => globalThis.Preloaded === true).catch(() => false);
        if (preloaded) {
          await page.setViewportSize(SCREENSHOT_VIEWPORT);
          return page;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No app page with preload bridge found");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  const signalProcessTree = (signal) => {
    if (process.platform !== "win32" && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        /* fall through to the direct child */
      }
    }
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  };
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalProcessTree("SIGKILL");
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    signalProcessTree("SIGTERM");
  });
}

async function killStray() {
  for (const pattern of ["support/watch.mjs", "dist/electron"]) {
    await new Promise((resolve) => {
      const child = spawn("pkill", ["-f", pattern], { stdio: "ignore" });
      child.once("exit", resolve);
      child.once("error", resolve);
    });
  }
}

async function withApp(engine, mode, port, fn) {
  const spec = commandFor(mode, port);
  const child = spawn(spec.command, spec.args, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    env: electronEnv(engine, port),
    stdio: ["ignore", "inherit", "inherit"],
  });
  let browser;
  try {
    const session = await waitForApp(port);
    browser = session.browser;
    await waitReady(session.page);
    await session.page.waitForLoadState("load").catch(() => undefined);
    await freezeUi(session.page);
    await fn(session.page);
  } finally {
    await browser?.close().catch(() => {});
    await stopProcess(child);
  }
}

function valueForEngine(item, key, engine) {
  const byEngine = item[`${key}ByEngine`];
  return byEngine?.[engine] ?? item[key];
}

function materializeItem(item, engine) {
  return {
    ...item,
    route: valueForEngine(item, "route", engine),
    resolve: valueForEngine(item, "resolve", engine),
    waitFor: valueForEngine(item, "waitFor", engine),
    minCount: valueForEngine(item, "minCount", engine),
    pre: valueForEngine(item, "pre", engine),
  };
}

async function cleanOutputDirectories() {
  for (const file of STALE_FLAT_SCREENSHOTS) {
    await rm(path.join(OUT_DIR, file), { force: true });
  }
  for (const engine of SCREENSHOT_ENGINES) {
    const engineOutDir = path.join(OUT_DIR, engine);
    await rm(engineOutDir, { recursive: true, force: true });
    mkdirSync(engineOutDir, { recursive: true });
  }
}

async function captureItem(page, engine, item) {
  const engineItem = materializeItem(item, engine);
  console.log(`capturing ${engine}/${engineItem.file}`);
  const route = await resolveRoute(page, engineItem);
  await navigate(page, route);
  await runPreActions(page, engineItem.pre);
  if (engineItem.waitFor) {
    await waitForSelectorCount(page, engineItem.waitFor, engineItem.minCount || 1);
  }
  await captureWindow(page, path.join(OUT_DIR, engine, engineItem.file));
  console.log(`captured ${engine}/${engineItem.file}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(OUT_DIR, { recursive: true });
  if (args.killStray) {
    await killStray();
  }
  await cleanOutputDirectories();
  let port = DEFAULT_PORT;
  for (const engine of SCREENSHOT_ENGINES) {
    await withApp(engine, args.mode, port, async (page) => {
      for (const item of screenshotManifest) {
        await captureItem(page, engine, item);
      }
    });
    port += 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  await killStray();
  process.exit(1);
});
