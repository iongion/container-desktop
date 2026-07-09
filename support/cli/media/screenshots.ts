import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { writeDemoManifests } from "./demoManifest";
import { createBackend, resolveCaptureBackend, screenshotOutDir } from "./drivers/backend";
import type { CaptureBackend, CaptureDriver } from "./drivers/types";
import {
  captureWindow,
  freezeUi,
  navigate,
  resolveRoute,
  runPreActions,
  setSidebarExpanded,
  waitForSelectorCount,
  waitReady,
} from "./screenshotActions";
import {
  SCREENSHOT_ENGINES,
  SCREENSHOT_VIEWPORT,
  STALE_FLAT_SCREENSHOTS,
  screenshotManifest,
} from "./screenshots.manifest";

// Regenerate the deterministic website screenshots by driving a mock app across the manifest, one
// engine at a time. The recording backend (Electron over CDP, or Tauri over WebDriver) is chosen by
// CONTAINER_DESKTOP_CAPTURE_BACKEND / --backend; the app lifecycle + page primitives live behind
// CaptureBackend / CaptureDriver, so this file is pure orchestration.

const DEFAULT_PORT = 9322;
const DEFAULT_CAPTURE_SETTLE_MS = 1000;

function parseArgs(argv: string[]) {
  const args: {
    mode: string;
    killStray: boolean;
    engines: Set<string> | null;
    only: Set<string> | null;
    clean: boolean;
    backend?: string;
  } = { mode: "dev", killStray: false, engines: null, only: null, clean: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kill-stray") {
      args.killStray = true;
    } else if (arg === "--clean") {
      args.clean = true;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--mode") {
      args.mode = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--backend=")) {
      args.backend = arg.slice("--backend=".length);
    } else if (arg === "--backend") {
      args.backend = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--engine=")) {
      args.engines = parseCsvArg(arg.slice("--engine=".length));
    } else if (arg === "--engine") {
      args.engines = parseCsvArg(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--only=")) {
      args.only = parseCsvArg(arg.slice("--only=".length));
    } else if (arg === "--only") {
      args.only = parseCsvArg(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function parseCsvArg(value: string) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function resolveEngines(args: { engines: Set<string> | null }) {
  if (!args.engines) {
    return SCREENSHOT_ENGINES;
  }
  const engines = SCREENSHOT_ENGINES.filter((engine) => args.engines?.has(engine));
  if (engines.length !== args.engines.size) {
    const unknown = [...args.engines].filter((engine) => !SCREENSHOT_ENGINES.includes(engine));
    throw new Error(`Unknown screenshot engine: ${unknown.join(", ")}`);
  }
  return engines;
}

function valueForEngine(item: any, key: string, engine: string) {
  const byEngine = item[`${key}ByEngine`];
  return byEngine?.[engine] ?? item[key];
}

function materializeItem(item: any, engine: string) {
  return {
    ...item,
    route: valueForEngine(item, "route", engine),
    resolve: valueForEngine(item, "resolve", engine),
    waitFor: valueForEngine(item, "waitFor", engine),
    minCount: valueForEngine(item, "minCount", engine),
    pre: valueForEngine(item, "pre", engine),
  };
}

async function cleanOutputDirectories(outDir: string, engines: string[], only: Set<string> | null, clean: boolean) {
  if (clean && !only) {
    for (const file of STALE_FLAT_SCREENSHOTS) {
      await rm(path.join(outDir, file), { force: true });
    }
    for (const engine of engines) {
      const engineOutDir = path.join(outDir, engine);
      await rm(engineOutDir, { recursive: true, force: true });
      mkdirSync(engineOutDir, { recursive: true });
    }
    return;
  }
  for (const engine of engines) {
    mkdirSync(path.join(outDir, engine), { recursive: true });
  }
}

async function withApp(
  backend: CaptureBackend,
  engine: string,
  mode: string,
  port: number,
  fn: (driver: CaptureDriver) => Promise<void>,
) {
  const app = await backend.launch({ engine, viewport: SCREENSHOT_VIEWPORT, mode, label: "screenshots", port });
  try {
    const { driver } = app;
    await waitReady(driver);
    await driver.waitForLoadState("load");
    await freezeUi(driver);
    await fn(driver);
  } finally {
    await app.close();
  }
}

async function captureItem(driver: CaptureDriver, outDir: string, engine: string, item: any) {
  const engineItem = materializeItem(item, engine);
  console.log(`capturing ${engine}/${engineItem.file}`);
  const route = await resolveRoute(driver, engineItem);
  await navigate(driver, route);
  await setSidebarExpanded(driver, engineItem.expandSidebar === true);
  await runPreActions(driver, engineItem.pre);
  if (engineItem.waitFor) {
    await waitForSelectorCount(driver, engineItem.waitFor, engineItem.minCount || 1);
  }
  await driver.pause(engineItem.settleMs ?? DEFAULT_CAPTURE_SETTLE_MS);
  await captureWindow(driver, path.join(outDir, engine, engineItem.file));
  console.log(`captured ${engine}/${engineItem.file}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const kind = resolveCaptureBackend(args.backend);
  const backend = await createBackend(kind);
  const outDir = screenshotOutDir();
  const engines = resolveEngines(args);
  mkdirSync(outDir, { recursive: true });
  if (args.killStray) {
    await backend.killStray();
  }
  await cleanOutputDirectories(outDir, engines, args.only, args.clean);
  let port = DEFAULT_PORT;
  for (const engine of engines) {
    const manifest = args.only
      ? screenshotManifest.filter((item) => args.only?.has(materializeItem(item, engine).file))
      : screenshotManifest;
    if (manifest.length === 0) {
      throw new Error(`No screenshot manifest entries matched ${[...(args.only ?? [])].join(", ")} for ${engine}`);
    }
    await withApp(backend, engine, args.mode, port, async (driver) => {
      for (const item of manifest) {
        await captureItem(driver, outDir, engine, item);
      }
    });
    port += 1;
  }
  // The website demo is a slideshow of these very screenshots — write its per-engine manifests now that
  // the shots are captured (the demo is folded into the screenshot run, no separate capture step).
  if (!args.only) {
    writeDemoManifests(engines);
  }
}
