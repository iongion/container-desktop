// CDP machinery for driving the real Electron app from tests — the two standard Electron+Vite shapes:
//
//   launchApp()    — Playwright launches the BUILT app (self-contained E2E). Needs a production build;
//                    a real window appears. This is the canonical `_electron.launch` pattern and works
//                    because main.ts loads file:// for any prod build (packaged or not), not just packaged.
//   connectToApp() — attach over CDP to an already-running instance, e.g. `yarn dev` (hot reload) which
//                    exposes :9222. Use this to drive the live dev app while iterating.
//
// Both return a Playwright Page bound to the renderer, once the preload bridge (window.Preloaded) is up.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type ElectronApplication, _electron as electron, type Page } from "playwright-core";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const DEFAULT_ENDPOINT = `http://localhost:${process.env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT || "9222"}`;

// GPU flags only when headless (CI). Never on the default path — they caused a GPU crash-loop (CLAUDE.md).
const HEADLESS_GPU_ARGS = [
  "--disable-gpu",
  "--disable-gpu-sandbox",
  "--in-process-gpu",
  "--no-zygote",
  "--disable-features=VizDisplayCompositor",
  "--disable-dev-shm-usage",
  "--disable-web-security",
];

export function headlessFromEnv(): boolean {
  return ["1", "true", "yes"].includes(`${process.env.CONTAINER_DESKTOP_HEADLESS || ""}`.toLowerCase());
}

/** Absolute path to the packaged main entry (build/<version>/main.cjs). */
export function productionMainPath(): string {
  const version = require(path.join(ROOT, "package.json")).version as string;
  return path.join(ROOT, "build", version, "main.cjs");
}

export interface AppSession {
  page: Page;
  app?: ElectronApplication;
  browser?: Browser;
  /** Close the launched app (launchApp) or disconnect from the attached one (connectToApp). */
  close: () => Promise<void>;
}

const waitForPreloaded = (page: Page, timeoutMs: number) =>
  page.waitForFunction(() => (window as unknown as { Preloaded?: boolean }).Preloaded === true, undefined, {
    timeout: timeoutMs,
  });

/** Launch the BUILT app under Playwright (CDP-driven). Requires `cross-env ENVIRONMENT=production yarn build`. */
export async function launchApp(opts?: { headless?: boolean; preloadTimeoutMs?: number }): Promise<AppSession> {
  const mainPath = productionMainPath();
  if (!existsSync(mainPath)) {
    throw new Error(`No production build at ${mainPath}. Run:  cross-env ENVIRONMENT=production yarn build`);
  }
  const args = [mainPath, "--no-sandbox"];
  if (opts?.headless ?? headlessFromEnv()) {
    args.push(...HEADLESS_GPU_ARGS);
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.ENVIRONMENT = "production";
  // Electron must NOT inherit ELECTRON_RUN_AS_NODE — with it set it boots as plain Node and the
  // electron API is missing, so startup fails (CLAUDE.md).
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ executablePath: require("electron") as string, args, env });
  const page = await app.firstWindow();
  await waitForPreloaded(page, opts?.preloadTimeoutMs ?? 30_000);
  const close = async () => {
    // app.close() can hang if the app holds background work open — force-kill the process on timeout.
    try {
      await Promise.race([
        app.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("close timeout")), 8000)),
      ]);
    } catch {
      try {
        app.process()?.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  };
  return { page, app, close };
}

/** Attach to a running instance over CDP (e.g. `yarn dev` exposes :9222). Disconnects on close; app keeps running. */
export async function connectToApp(opts?: { endpoint?: string; preloadTimeoutMs?: number }): Promise<AppSession> {
  const endpoint = opts?.endpoint ?? DEFAULT_ENDPOINT;
  const browser = await chromium.connectOverCDP(endpoint);
  const timeoutMs = opts?.preloadTimeoutMs ?? 30_000;

  const deadline = Date.now() + timeoutMs;
  let page: Page | undefined;
  while (!page && Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        const ready = await candidate
          .evaluate(() => (window as unknown as { Preloaded?: boolean }).Preloaded === true)
          .catch(() => false);
        if (ready) {
          page = candidate;
          break;
        }
      }
      if (page) {
        break;
      }
    }
    if (!page) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!page) {
    await browser.close().catch(() => {});
    throw new Error(`No renderer page with the preload bridge (window.Preloaded) at ${endpoint} within ${timeoutMs}ms`);
  }
  return { page, browser, close: () => browser.close() };
}
