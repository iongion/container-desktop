import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "playwright-core";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { clearCdpEndpointFile, resolveCdpEndpoint } from "../cdpEndpoint";
import { createPlaywrightDriver } from "../drivers/playwrightDriver";
import { RUNTIME_NAME_SHIM } from "../drivers/runtimeShim";
import type { CaptureApp, CaptureBackend, LaunchOptions, Viewport } from "../drivers/types";

// Electron capture lifecycle (shared by screenshots + demo replay): boot a mock Electron app and
// attach Playwright over CDP. Extracted verbatim from the two scripts' former withApp/electronEnv/
// waitForApp helpers so the Electron path is unchanged; only the driver seam is new.

const require = createRequire(import.meta.url);
const ROOT = PROJECT_HOME;

function seedWindowSettings(userDataDir: string, viewport: Viewport): void {
  writeFileSync(
    path.join(userDataDir, "user-settings.json"),
    JSON.stringify(
      {
        minimizeToSystemTray: false,
        trayWidgetEnabled: false,
        expandSidebar: false,
        // Suppress the first-run provisioning wizard: on this fresh profile it would auto-open and its
        // full-screen overlay would cover every capture and intercept clicks. skipAtStartup gates it off.
        wizard: { skipAtStartup: true },
        window: {
          width: viewport.width,
          height: viewport.height,
          isMaximized: false,
        },
      },
      null,
      2,
    ),
  );
}

function electronEnv(engine: string, port: number, viewport: Viewport, label: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const userDataDir = path.join(ROOT, ".tmp", "mock-user-data", label, engine);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedWindowSettings(userDataDir, viewport);
  delete env.ELECTRON_RUN_AS_NODE;
  env.CONTAINER_DESKTOP_MOCK = engine;
  env.CONTAINER_DESKTOP_USER_DATA_DIR = userDataDir;
  env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT = `${port}`;
  // Don't pin the CDP origin: watch.mjs may fall back from `port` to a free port and would then keep
  // this stale origin in --remote-allow-origins, rejecting the websocket. Unset lets it derive the
  // allow-origin from the port it actually bound, so origin and port always agree (see cdpEndpoint.ts).
  delete env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN;
  env.CONTAINER_DESKTOP_CAPTURE_OFFSCREEN = "1";
  env.CONTAINER_DESKTOP_DISABLE_EXTERNAL_OPEN = "1";
  env.ENVIRONMENT = "development";
  env.NODE_ENV = "development";
  env.CI = env.CI || "true";
  return env;
}

function commandFor(mode: string, port: number): { command: string; args: string[] } {
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
  throw new Error(`Unsupported capture mode: ${mode}`);
}

async function findAppPage(browser: any, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith("devtools://")) {
          continue;
        }
        const preloaded = await page.evaluate(() => globalThis.Preloaded === true).catch(() => false);
        if (preloaded) {
          return page;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No app page with preload bridge found");
}

async function waitForApp(endpoint: string, timeoutMs = 60_000): Promise<{ browser: any; page: any }> {
  const deadline = Date.now() + timeoutMs;
  let lastError: any;
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

async function waitForAppViewport(page: any, viewport: Viewport): Promise<void> {
  await page.waitForFunction(
    ([width, height]: [number, number]) => window.innerWidth === width && window.innerHeight === height,
    [viewport.width, viewport.height],
    { timeout: 10_000 },
  );
}

async function stopProcess(child: any): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  const signalProcessTree = (signal: NodeJS.Signals) => {
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
  await new Promise<void>((resolve) => {
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

export const electronBackend: CaptureBackend = {
  kind: "electron",

  async launch(opts: LaunchOptions): Promise<CaptureApp> {
    const spec = commandFor(opts.mode, opts.port);
    clearCdpEndpointFile();
    const child = spawn(spec.command, spec.args, {
      cwd: ROOT,
      detached: process.platform !== "win32",
      env: electronEnv(opts.engine, opts.port, opts.viewport, opts.label),
      stdio: ["ignore", "inherit", "inherit"],
    });
    let browser: any;
    try {
      const session = await waitForApp(await resolveCdpEndpoint(opts.mode, opts.port));
      browser = session.browser;
      await waitForAppViewport(session.page, opts.viewport);
      // Make the esbuild __name helper resolvable in the app realm before any driver.evaluate runs:
      // now for the attached document, and on any future reload. See runtimeShim.ts.
      await session.page.addInitScript({ content: RUNTIME_NAME_SHIM });
      await session.page.evaluate(RUNTIME_NAME_SHIM);
      return {
        driver: createPlaywrightDriver(session.page),
        async close() {
          await browser?.close().catch(() => {});
          await stopProcess(child);
        },
      };
    } catch (error) {
      await browser?.close().catch(() => {});
      await stopProcess(child);
      throw error;
    }
  },

  async killStray(): Promise<void> {
    for (const pattern of ["support/watch.mjs", "dist/electron"]) {
      await new Promise((resolve) => {
        const child = spawn("pkill", ["-f", pattern], { stdio: "ignore" });
        child.once("exit", resolve);
        child.once("error", resolve);
      });
    }
  },
};
