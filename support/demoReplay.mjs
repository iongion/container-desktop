#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { clearCdpEndpointFile, resolveCdpEndpoint } from "./cdpEndpoint.mjs";
import { dataUrlForLocalAsset, sanitizeLocalDevReferences } from "./demoSanitize.mjs";
import { demoScenarios } from "./demoScenarios.mjs";
import {
  captureWindow,
  freezeUi,
  navigate,
  resolveRoute,
  runPreActions,
  setSidebarExpanded,
  settleOnScreen,
  waitForSelectorCount,
  waitReady,
} from "./screenshotActions.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 9422;

function parseArgs(argv) {
  const args = { mode: "dev", killStray: false, engines: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kill-stray") {
      args.killStray = true;
    } else if (arg.startsWith("--mode=")) {
      args.mode = arg.slice("--mode=".length);
    } else if (arg === "--mode") {
      args.mode = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--engine=")) {
      args.engines = parseCsvArg(arg.slice("--engine=".length));
    } else if (arg === "--engine") {
      args.engines = parseCsvArg(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function parseCsvArg(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function electronEnv(engine, port, viewport) {
  const env = { ...process.env };
  const userDataDir = path.join(ROOT, ".tmp", "mock-user-data", "demo", engine);
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });
  seedWindowSettings(userDataDir, viewport);
  delete env.ELECTRON_RUN_AS_NODE;
  env.CONTAINER_DESKTOP_MOCK = engine;
  env.CONTAINER_DESKTOP_USER_DATA_DIR = userDataDir;
  env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_PORT = `${port}`;
  // Don't pin the CDP origin: watch.mjs may fall back from `port` to a free port and would then keep
  // this stale origin in --remote-allow-origins, rejecting the websocket. Unset lets it derive the
  // allow-origin from the port it actually bound, so origin and port always agree (see cdpEndpoint.mjs).
  delete env.CONTAINER_DESKTOP_REMOTE_DEBUGGING_ORIGIN;
  env.CONTAINER_DESKTOP_CAPTURE_OFFSCREEN = "1";
  env.CONTAINER_DESKTOP_DISABLE_EXTERNAL_OPEN = "1";
  env.ENVIRONMENT = "development";
  env.NODE_ENV = "development";
  env.CI = env.CI || "true";
  return env;
}

function seedWindowSettings(userDataDir, viewport) {
  writeFileSync(
    path.join(userDataDir, "user-settings.json"),
    JSON.stringify(
      {
        minimizeToSystemTray: false,
        trayWidgetEnabled: false,
        expandSidebar: false,
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
  throw new Error(`Unsupported demo replay mode: ${mode}`);
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
          return page;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No app page with preload bridge found");
}

async function waitForApp(endpoint, timeoutMs = 60_000) {
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

async function withApp(scenario, mode, port, fn) {
  const spec = commandFor(mode, port);
  clearCdpEndpointFile();
  const child = spawn(spec.command, spec.args, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    env: electronEnv(scenario.engine, port, scenario.viewport),
    stdio: ["ignore", "inherit", "inherit"],
  });
  let browser;
  try {
    const session = await waitForApp(await resolveCdpEndpoint(mode, port));
    browser = session.browser;
    await waitForAppViewport(session.page, scenario.viewport);
    await session.page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await freezeUi(session.page);
    await fn(session.page);
  } finally {
    await browser?.close().catch(() => {});
    await stopProcess(child);
  }
}

async function waitForAppViewport(page, viewport) {
  await page.waitForFunction(
    ([width, height]) => window.innerWidth === width && window.innerHeight === height,
    [viewport.width, viewport.height],
    { timeout: 10_000 },
  );
}

async function waitForNoToasts(page) {
  await page.waitForFunction(
    () => {
      const elements = document.querySelectorAll(
        '.AppToaster,.NotificationAppToaster,.bp6-toast,.bp6-toast-container,.bp6-overlay-toaster,[class*="Toaster"],[class*="toast"],[class*="Toast"]',
      );
      return [...elements].every((element) => {
        const style = getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0";
      });
    },
    undefined,
    { timeout: 10_000 },
  );
}

function packageRoot(packageName) {
  return path.resolve(path.dirname(require.resolve(packageName)), "..");
}

function recordScriptPath() {
  return path.join(packageRoot("@rrweb/record"), "dist", "record.umd.min.cjs");
}

async function startRecording(page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.addScriptTag({ path: recordScriptPath() });
      await page.evaluate(() => {
        const recorder = globalThis.rrwebRecord?.record;
        if (typeof recorder !== "function") {
          throw new Error("rrweb recorder did not load");
        }
        globalThis.__containerDesktopDemoEvents = [];
        globalThis.__containerDesktopStopDemoRecording = recorder({
          emit(event) {
            globalThis.__containerDesktopDemoEvents.push(event);
          },
          collectFonts: false,
          inlineStylesheet: true,
          maskAllInputs: false,
          recordCanvas: false,
          sampling: {
            mousemove: 20,
            mouseInteraction: true,
            scroll: 100,
          },
        });
      });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

async function stopRecording(page) {
  return page.evaluate(() => {
    globalThis.__containerDesktopStopDemoRecording?.();
    return globalThis.__containerDesktopDemoEvents || [];
  });
}

async function actionTimestamp(page) {
  return page.evaluate(() => Date.now());
}

async function addReplayPause(page, pauses, duration, settleMs = 80) {
  if (!duration || duration <= 0) {
    return;
  }
  await page.waitForTimeout(settleMs);
  pauses.push({
    afterTimestamp: await actionTimestamp(page),
    duration,
  });
}

async function moveToSelector(page, selector, duration = 900) {
  const locator = page.locator(selector).first();
  await locator.waitFor({ timeout: 30_000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error(`Unable to move to ${selector}: element has no bounding box`);
  }
  const target = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const steps = Math.max(8, Math.round(duration / 24));
  await page.mouse.move(target.x, target.y, { steps });
  await page.waitForTimeout(160);
  return box;
}

function firstResolverSelector(action) {
  return Object.values(action.resolve || {}).find((resolver) => typeof resolver?.selector === "string")?.selector;
}

async function clickSelector(page, action, context) {
  await moveToSelector(page, action.selector, action.duration || 900);
  await addReplayPause(page, context.pauses, action.focusMs ?? context.actionFocusMs);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await addReplayPause(page, context.pauses, action.pulseMs ?? context.actionPulseMs);
  if (action.waitReady !== false) {
    await waitReady(page).catch(() => undefined);
  }
  if (action.waitFor) {
    await waitForSelectorCount(page, action.waitFor, action.minCount || 1);
  }
  // A click can trigger a screen change (sidebar nav, row → detail); let it settle before the hold.
  await settleOnScreen(page, action.settleMs ?? context.actionSettleMs);
  await addReplayPause(page, context.pauses, action.resultMs ?? context.actionResultMs);
}

async function runAction(page, action, context) {
  if (action.type === "navigate") {
    const route = await resolveRoute(page, action);
    const selector = action.highlightSelector || firstResolverSelector(action);
    if (selector) {
      await moveToSelector(page, selector, action.duration || 900);
      await addReplayPause(page, context.pauses, action.focusMs ?? context.navigationFocusMs);
    }
    await navigate(page, route);
    if (action.waitFor) {
      await waitForSelectorCount(page, action.waitFor, action.minCount || 1);
    }
    // Let the previous screen unmount and the new one render+paint before recording the hold, so the
    // rrweb pause never freezes on a mid-transition frame.
    await settleOnScreen(page, action.settleMs ?? context.navigationSettleMs);
    await addReplayPause(page, context.pauses, action.resultMs ?? context.navigationResultMs);
    return;
  }
  if (action.type === "hover") {
    await moveToSelector(page, action.selector, action.duration || 900);
    if (action.waitFor) {
      await waitForSelectorCount(page, action.waitFor, action.minCount || 1);
    }
    if (action.hold) {
      await addReplayPause(page, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "move") {
    await page.mouse.move(action.x, action.y, { steps: Math.max(8, Math.round((action.duration || 900) / 24)) });
    if (action.hold) {
      await addReplayPause(page, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "wait") {
    await addReplayPause(page, context.pauses, action.ms || 500);
    return;
  }
  if (action.type === "key") {
    await page.keyboard.press(action.key);
    if (action.hold) {
      await addReplayPause(page, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "waitReady") {
    await waitReady(page);
    return;
  }
  if (action.type === "sidebar") {
    await setSidebarExpanded(page, action.expanded !== false);
    if (action.hold) {
      await addReplayPause(page, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "pre") {
    await runPreActions(page, action.pre);
    return;
  }
  if (action.type === "click") {
    await clickSelector(page, action, context);
    return;
  }
  if (action.type === "waitFor") {
    await waitForSelectorCount(page, action.selector, action.minCount || 1);
    return;
  }
  throw new Error(`Unknown demo scenario action: ${action.type}`);
}

async function runScenario(page, scenario) {
  const chapters = [];
  const pauses = [];
  const defaultScreenHold = scenario.screenHoldMs ?? 0;
  const captureSettleMs = scenario.captureSettleMs ?? 250;
  const context = {
    pauses,
    actionFocusMs: scenario.actionFocusMs ?? 1600,
    actionPulseMs: scenario.actionPulseMs ?? 700,
    actionResultMs: scenario.actionResultMs ?? 2200,
    actionSettleMs: scenario.actionSettleMs ?? 250,
    navigationFocusMs: scenario.navigationFocusMs ?? 1800,
    navigationResultMs: scenario.navigationResultMs ?? 2600,
    navigationSettleMs: scenario.navigationSettleMs ?? 400,
  };
  await waitReady(page);
  await page.waitForTimeout(scenario.recordingSettleMs ?? 1000);
  await setSidebarExpanded(page, false);
  await waitForNoToasts(page);
  await page.mouse.move(scenario.viewport.width / 2, scenario.viewport.height / 2);
  await startRecording(page);
  await page
    .waitForFunction(() => (globalThis.__containerDesktopDemoEvents || []).length > 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(250);
  for (const step of scenario.steps) {
    console.log(`${step.keyword} ${step.text}`);
    chapters.push({
      keyword: step.keyword,
      label: step.label,
      title: step.text,
      timestamp: await actionTimestamp(page),
    });
    for (const action of step.actions) {
      await runAction(page, action, context);
    }
    await page.waitForTimeout(step.captureSettleMs ?? captureSettleMs);
    const duration = Math.max(step.hold ?? defaultScreenHold, defaultScreenHold);
    await addReplayPause(page, pauses, duration, 0);
  }
  await page.waitForTimeout(250);
  const events = await stopRecording(page);
  if (events.length === 0) {
    throw new Error("rrweb recording produced no events");
  }
  return { events, chapters, pauses };
}

async function writePoster(page, posterPath) {
  mkdirSync(path.dirname(posterPath), { recursive: true });
  await captureWindow(page, posterPath);
}

function replayOffsetAt(timestamp, pauses) {
  return pauses.reduce((offset, pause) => (timestamp > pause.afterTimestamp ? offset + pause.duration : offset), 0);
}

function isLocalDevUrl(value) {
  return typeof value === "string" && /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?:\/|$)/.test(value);
}

function sanitizeNode(node) {
  if (!node || typeof node !== "object") {
    return node;
  }

  const tagName = typeof node.tagName === "string" ? node.tagName.toLowerCase() : "";
  const attributes = node.attributes && typeof node.attributes === "object" ? { ...node.attributes } : undefined;

  if (tagName === "script" || tagName === "base") {
    return null;
  }
  if (tagName === "link" && (isLocalDevUrl(attributes?.href) || attributes?.rel === "manifest")) {
    return null;
  }

  if (attributes) {
    for (const key of ["src", "href", "srcset"]) {
      const value = attributes[key];
      if (typeof value === "string" && key === "srcset") {
        attributes[key] = value
          .split(",")
          .map((part) => {
            const [url, ...descriptor] = part.trim().split(/\s+/);
            return [dataUrlForLocalAsset(url) || url, ...descriptor].join(" ");
          })
          .join(", ");
      } else if (typeof value === "string") {
        const dataUrl = dataUrlForLocalAsset(value);
        if (dataUrl) {
          attributes[key] = dataUrl;
        } else if (isLocalDevUrl(value)) {
          delete attributes[key];
        }
      }
    }
    for (const [key, value] of Object.entries(attributes)) {
      attributes[key] = sanitizeLocalDevReferences(value);
    }
    node.attributes = attributes;
  }

  if (Array.isArray(node.childNodes)) {
    node.childNodes = node.childNodes.map((child) => sanitizeNode(child)).filter(Boolean);
  }

  return node;
}

function sanitizeRecordingEvent(event) {
  if (event.type === 3 && event.data?.source === 10) {
    return null;
  }
  event.data = event.data && typeof event.data === "object" ? { ...event.data } : event.data;
  if (event.data && isLocalDevUrl(event.data.href)) {
    event.data.href = sanitizeLocalDevReferences(event.data.href);
  }
  if (event.data?.node) {
    event.data.node = sanitizeNode(event.data.node);
  }
  if (Array.isArray(event.data?.adds)) {
    event.data.adds = event.data.adds
      .map((add) => ({ ...add, node: sanitizeNode(add.node) }))
      .filter((add) => add.node);
  }
  if (Array.isArray(event.data?.attributes)) {
    event.data.attributes = event.data.attributes.map((mutation) => {
      const attributes = {};
      for (const [key, value] of Object.entries(mutation.attributes || {})) {
        attributes[key] = sanitizeLocalDevReferences(value);
      }
      return { ...mutation, attributes };
    });
  }
  return event;
}

function normalizeRecording(scenario, recording) {
  const firstTimestamp = recording.events[0].timestamp;
  const pauses = recording.pauses || [];
  const events = recording.events
    .map((event) =>
      sanitizeRecordingEvent({
        ...event,
        timestamp:
          scenario.baseTimestamp + (event.timestamp - firstTimestamp + replayOffsetAt(event.timestamp, pauses)),
      }),
    )
    .filter(Boolean);
  const finalPause = pauses.at(-1);
  if (finalPause) {
    events.push({
      type: 5,
      data: {
        tag: "container-desktop.demo.end",
        payload: {},
      },
      timestamp:
        scenario.baseTimestamp +
        (finalPause.afterTimestamp - firstTimestamp + replayOffsetAt(finalPause.afterTimestamp + 1, pauses)),
    });
  }
  return {
    version: 1,
    id: scenario.id,
    title: scenario.title,
    engine: scenario.engine,
    viewport: scenario.viewport,
    chapters: recording.chapters.map((chapter) => ({
      keyword: chapter.keyword,
      label: chapter.label,
      title: chapter.title,
      atMs: Math.max(0, chapter.timestamp - firstTimestamp + replayOffsetAt(chapter.timestamp, pauses)),
    })),
    events,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.killStray) {
    await killStray();
  }
  const scenarios = args.engines
    ? demoScenarios.filter((scenario) => args.engines.has(scenario.engine))
    : demoScenarios;
  if (scenarios.length === 0) {
    throw new Error(`No demo scenario matched engine(s): ${[...(args.engines || [])].join(", ")}`);
  }
  let port = DEFAULT_PORT;
  for (const scenario of scenarios) {
    const outPath = path.join(ROOT, scenario.output);
    const posterPath = path.join(ROOT, scenario.poster);
    mkdirSync(path.dirname(outPath), { recursive: true });
    await withApp(scenario, args.mode, port, async (page) => {
      await waitReady(page);
      await page.waitForTimeout(scenario.posterSettleMs ?? 1000);
      await setSidebarExpanded(page, false);
      await waitForNoToasts(page);
      await writePoster(page, posterPath);
      const recording = await runScenario(page, scenario);
      const replay = normalizeRecording(scenario, recording);
      writeFileSync(outPath, `${JSON.stringify(replay)}\n`);
      console.log(`wrote ${path.relative(ROOT, outPath)} (${replay.events.length} events)`);
    });
    port += 1;
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
