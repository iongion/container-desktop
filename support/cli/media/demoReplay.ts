import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PROJECT_HOME } from "@/cli/lib/paths";
import { dataUrlForLocalAsset, sanitizeLocalDevReferences } from "./demoSanitize";
import { demoScenarios } from "./demoScenarios";
import { createBackend, demoOutputPath, resolveCaptureBackend } from "./drivers/backend";
import type { CaptureBackend, CaptureDriver } from "./drivers/types";
import {
  captureWindow,
  freezeUi,
  moveToSelector,
  navigate,
  resolveRoute,
  runPreActions,
  setSidebarExpanded,
  settleOnScreen,
  waitForSelectorCount,
  waitReady,
} from "./screenshotActions";

// Record the website rrweb demo replays: boot a mock app per engine, drive the scenario, and harvest the
// rrweb event stream + poster. Backend (Electron over CDP or Tauri over WebDriver) is chosen by
// CONTAINER_DESKTOP_CAPTURE_BACKEND / --backend; the smooth cursor motion the replay shows is produced by
// the driver's interpolated pointer primitive, identical across backends.

const require = createRequire(import.meta.url);
const ROOT = PROJECT_HOME;
const DEFAULT_PORT = 9422;
// Demo scenarios move the pointer with a longer settle than screenshots so the cursor reads as deliberate.
const POINTER_SETTLE_MS = 160;

function parseArgs(argv: string[]) {
  const args: { mode: string; killStray: boolean; engines: Set<string> | null; backend?: string } = {
    mode: "dev",
    killStray: false,
    engines: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--kill-stray") {
      args.killStray = true;
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

async function withApp(
  backend: CaptureBackend,
  scenario: any,
  mode: string,
  port: number,
  fn: (driver: CaptureDriver) => Promise<void>,
) {
  const app = await backend.launch({
    engine: scenario.engine,
    viewport: scenario.viewport,
    mode,
    label: "demo",
    port,
  });
  try {
    const { driver } = app;
    await driver.waitForLoadState("domcontentloaded");
    await freezeUi(driver);
    await fn(driver);
  } finally {
    await app.close();
  }
}

async function waitForNoToasts(driver: CaptureDriver) {
  await driver.waitForFunction(
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

function packageRoot(packageName: string) {
  return path.resolve(path.dirname(require.resolve(packageName)), "..");
}

function recordScriptSource() {
  return readFileSync(path.join(packageRoot("@rrweb/record"), "dist", "record.umd.min.cjs"), "utf8");
}

async function startRecording(driver: CaptureDriver) {
  const source = recordScriptSource();
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await driver.injectScript(source);
      await driver.evaluate(() => {
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
      await driver.waitForLoadState("domcontentloaded");
      await driver.pause(250);
    }
  }
  throw lastError;
}

async function stopRecording(driver: CaptureDriver) {
  return driver.evaluate(() => {
    globalThis.__containerDesktopStopDemoRecording?.();
    return globalThis.__containerDesktopDemoEvents || [];
  });
}

async function actionTimestamp(driver: CaptureDriver): Promise<number> {
  return driver.evaluate(() => Date.now());
}

async function addReplayPause(driver: CaptureDriver, pauses: any[], duration: number, settleMs = 80) {
  if (!duration || duration <= 0) {
    return;
  }
  await driver.pause(settleMs);
  pauses.push({
    afterTimestamp: await actionTimestamp(driver),
    duration,
  });
}

function firstResolverSelector(action: any) {
  const resolvers = Object.values((action.resolve || {}) as Record<string, any>);
  return resolvers.find((resolver) => typeof resolver?.selector === "string")?.selector;
}

async function clickSelector(driver: CaptureDriver, action: any, context: any) {
  await moveToSelector(driver, action.selector, action.duration || 900, POINTER_SETTLE_MS);
  await addReplayPause(driver, context.pauses, action.focusMs ?? context.actionFocusMs);
  await driver.pointerDown();
  await driver.pause(80);
  await driver.pointerUp();
  await addReplayPause(driver, context.pauses, action.pulseMs ?? context.actionPulseMs);
  if (action.waitReady !== false) {
    await waitReady(driver).catch(() => undefined);
  }
  if (action.waitFor) {
    await waitForSelectorCount(driver, action.waitFor, action.minCount || 1);
  }
  // A click can trigger a screen change (sidebar nav, row → detail); let it settle before the hold.
  await settleOnScreen(driver, action.settleMs ?? context.actionSettleMs);
  await addReplayPause(driver, context.pauses, action.resultMs ?? context.actionResultMs);
}

async function runAction(driver: CaptureDriver, action: any, context: any) {
  if (action.type === "navigate") {
    const route = await resolveRoute(driver, action);
    const selector = action.highlightSelector || firstResolverSelector(action);
    if (selector) {
      await moveToSelector(driver, selector, action.duration || 900, POINTER_SETTLE_MS);
      await addReplayPause(driver, context.pauses, action.focusMs ?? context.navigationFocusMs);
    }
    await navigate(driver, route);
    if (action.waitFor) {
      await waitForSelectorCount(driver, action.waitFor, action.minCount || 1);
    }
    // Let the previous screen unmount and the new one render+paint before recording the hold, so the
    // rrweb pause never freezes on a mid-transition frame.
    await settleOnScreen(driver, action.settleMs ?? context.navigationSettleMs);
    await addReplayPause(driver, context.pauses, action.resultMs ?? context.navigationResultMs);
    return;
  }
  if (action.type === "hover") {
    await moveToSelector(driver, action.selector, action.duration || 900, POINTER_SETTLE_MS);
    if (action.waitFor) {
      await waitForSelectorCount(driver, action.waitFor, action.minCount || 1);
    }
    if (action.hold) {
      await addReplayPause(driver, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "move") {
    await driver.pointerMove(action.x, action.y, Math.max(8, Math.round((action.duration || 900) / 24)));
    if (action.hold) {
      await addReplayPause(driver, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "wait") {
    await addReplayPause(driver, context.pauses, action.ms || 500);
    return;
  }
  if (action.type === "key") {
    await driver.pressKey(action.key);
    if (action.hold) {
      await addReplayPause(driver, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "waitReady") {
    await waitReady(driver);
    return;
  }
  if (action.type === "sidebar") {
    await setSidebarExpanded(driver, action.expanded !== false);
    if (action.hold) {
      await addReplayPause(driver, context.pauses, action.hold);
    }
    return;
  }
  if (action.type === "pre") {
    await runPreActions(driver, action.pre);
    return;
  }
  if (action.type === "click") {
    await clickSelector(driver, action, context);
    return;
  }
  if (action.type === "waitFor") {
    await waitForSelectorCount(driver, action.selector, action.minCount || 1);
    return;
  }
  throw new Error(`Unknown demo scenario action: ${action.type}`);
}

async function runScenario(driver: CaptureDriver, scenario: any) {
  const chapters: Array<{ keyword: string; label: string; title: string; timestamp: number }> = [];
  const pauses: any[] = [];
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
  await waitReady(driver);
  await driver.pause(scenario.recordingSettleMs ?? 1000);
  await setSidebarExpanded(driver, false);
  await waitForNoToasts(driver);
  await driver.pointerMove(scenario.viewport.width / 2, scenario.viewport.height / 2, 1);
  await startRecording(driver);
  await driver
    .waitForFunction(() => (globalThis.__containerDesktopDemoEvents || []).length > 0, undefined, { timeout: 5000 })
    .catch(() => undefined);
  await driver.pause(250);
  for (const step of scenario.steps) {
    console.log(`${step.keyword} ${step.text}`);
    chapters.push({
      keyword: step.keyword,
      label: step.label,
      title: step.text,
      timestamp: await actionTimestamp(driver),
    });
    for (const action of step.actions) {
      await runAction(driver, action, context);
    }
    await driver.pause(step.captureSettleMs ?? captureSettleMs);
    const duration = Math.max(step.hold ?? defaultScreenHold, defaultScreenHold);
    await addReplayPause(driver, pauses, duration, 0);
  }
  await driver.pause(250);
  const events = await stopRecording(driver);
  if (events.length === 0) {
    throw new Error("rrweb recording produced no events");
  }
  return { events, chapters, pauses };
}

async function writePoster(driver: CaptureDriver, posterPath: string) {
  mkdirSync(path.dirname(posterPath), { recursive: true });
  await captureWindow(driver, posterPath);
}

function replayOffsetAt(timestamp: number, pauses: any[]) {
  return pauses.reduce((offset, pause) => (timestamp > pause.afterTimestamp ? offset + pause.duration : offset), 0);
}

function isLocalDevUrl(value: any) {
  return typeof value === "string" && /^https?:\/\/(?:localhost|127\.0\.0\.1):3000(?:\/|$)/.test(value);
}

function sanitizeNode(node: any) {
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
    node.childNodes = node.childNodes.map((child: any) => sanitizeNode(child)).filter(Boolean);
  }

  return node;
}

function sanitizeRecordingEvent(event: any) {
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
      .map((add: any) => ({ ...add, node: sanitizeNode(add.node) }))
      .filter((add: any) => add.node);
  }
  if (Array.isArray(event.data?.attributes)) {
    event.data.attributes = event.data.attributes.map((mutation: any) => {
      const attributes: Record<string, any> = {};
      for (const [key, value] of Object.entries(mutation.attributes || {})) {
        attributes[key] = sanitizeLocalDevReferences(value);
      }
      return { ...mutation, attributes };
    });
  }
  return event;
}

function normalizeRecording(scenario: any, recording: any) {
  const firstTimestamp = recording.events[0].timestamp;
  const pauses = recording.pauses || [];
  const events = recording.events
    .map((event: any) =>
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
    chapters: recording.chapters.map((chapter: any) => ({
      keyword: chapter.keyword,
      label: chapter.label,
      title: chapter.title,
      atMs: Math.max(0, chapter.timestamp - firstTimestamp + replayOffsetAt(chapter.timestamp, pauses)),
    })),
    events,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const kind = resolveCaptureBackend(args.backend);
  const backend = await createBackend(kind);
  if (args.killStray) {
    await backend.killStray();
  }
  const scenarios = args.engines
    ? demoScenarios.filter((scenario) => args.engines?.has(scenario.engine))
    : demoScenarios;
  if (scenarios.length === 0) {
    throw new Error(`No demo scenario matched engine(s): ${[...(args.engines || [])].join(", ")}`);
  }
  let port = DEFAULT_PORT;
  for (const scenario of scenarios) {
    const outPath = demoOutputPath(kind, scenario.output);
    const posterPath = demoOutputPath(kind, scenario.poster);
    mkdirSync(path.dirname(outPath), { recursive: true });
    await withApp(backend, scenario, args.mode, port, async (driver) => {
      await waitReady(driver);
      await driver.pause(scenario.posterSettleMs ?? 1000);
      await setSidebarExpanded(driver, false);
      await waitForNoToasts(driver);
      await writePoster(driver, posterPath);
      const recording = await runScenario(driver, scenario);
      const replay = normalizeRecording(scenario, recording);
      writeFileSync(outPath, `${JSON.stringify(replay)}\n`);
      console.log(`wrote ${path.relative(ROOT, outPath)} (${replay.events.length} events)`);
    });
    port += 1;
  }
}
