import type { Box, CaptureDriver } from "./drivers/types";

// Screen-driving actions shared by the screenshot + demo capture scripts. Written against CaptureDriver
// (not a raw Playwright page) so a single action layer drives either shell — Electron over CDP or Tauri
// over WebDriver. DOM reads/writes stay inside evaluate() (identical page-side JS on both); only pointer,
// screenshot and injection go through backend-specific primitives.

export async function waitReady(driver: CaptureDriver, opts: { timeout?: number } = {}) {
  const timeout = opts.timeout ?? 45_000;
  await driver.waitForFunction(
    () => {
      const html = document.documentElement;
      return html.dataset.phase === "ready" && html.dataset.running === "yes" && html.dataset.provisioned === "yes";
    },
    undefined,
    { timeout },
  );
}

export async function freezeUi(driver: CaptureDriver) {
  const content = `
    *, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
      caret-color: transparent !important;
    }
    .AppToaster,
    .NotificationAppToaster,
    .bp6-toast,
    .bp6-toast-container,
    .bp6-overlay-toaster,
    .bp6-overlay-backdrop,
    [class*="Toaster"],
    [class*="toast"],
    [class*="Toast"] {
      display: none !important;
    }
  `;
  let lastError: any;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await driver.injectStyle(content);
      await driver.evaluate(() => {
        const selectors = [
          ".AppToaster",
          ".NotificationAppToaster",
          ".bp6-toast",
          ".bp6-toast-container",
          ".bp6-overlay-toaster",
          '[class*="Toaster"]',
          '[class*="toast"]',
          '[class*="Toast"]',
        ];
        const hideToasts = () => {
          for (const element of document.querySelectorAll<HTMLElement>(selectors.join(","))) {
            element.style.setProperty("display", "none", "important");
            element.style.setProperty("visibility", "hidden", "important");
            element.style.setProperty("opacity", "0", "important");
            element.style.setProperty("pointer-events", "none", "important");
          }
        };
        hideToasts();
        if (!globalThis.__containerDesktopCaptureToastObserver) {
          globalThis.__containerDesktopCaptureToastObserver = new MutationObserver(hideToasts);
          globalThis.__containerDesktopCaptureToastObserver.observe(document.body, { childList: true, subtree: true });
        }
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

export async function navigate(driver: CaptureDriver, route: string) {
  await driver.evaluate((nextRoute: string) => {
    if (window.location.hash !== `#${nextRoute}`) {
      window.location.hash = nextRoute;
    }
  }, route);
  await waitReady(driver);
  await driver.pause(50);
}

export async function waitForSelectorCount(driver: CaptureDriver, selector: string, minCount = 1, timeout = 30_000) {
  await driver.waitForFunction(
    ([targetSelector, targetCount]: [string, number]) =>
      document.querySelectorAll(targetSelector).length >= targetCount,
    [selector, minCount],
    { timeout },
  );
}

// After landing on a screen, wait for the route transition to FULLY settle before capturing or
// recording: the previous screen must unmount and the new one must render its data and paint.
// Without this a frame (or an rrweb pause) can land mid-transition where the old screen still overlaps
// the new one. Waits until DOM mutations go quiet for `quietMs` (bounded by `maxWaitMs` so a steadily
// polling screen can't hang it), then two animation frames so the settled tree has actually painted.
export async function settleOnScreen(driver: CaptureDriver, quietMs = 350, maxWaitMs = 4000) {
  if (!quietMs || quietMs <= 0) {
    return;
  }
  await waitReady(driver).catch(() => undefined);
  await driver.evaluateAsync(
    ([quiet, maxWait]: [number, number]) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        let timer: any;
        const done = () => {
          clearTimeout(timer);
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        };
        const bump = () => {
          clearTimeout(timer);
          if (performance.now() - start >= maxWait) {
            done();
            return;
          }
          timer = setTimeout(done, quiet);
        };
        const observer = new MutationObserver(bump);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
        bump();
      }),
    [quietMs, maxWaitMs],
  );
}

export async function setSidebarExpanded(driver: CaptureDriver, expanded: boolean) {
  await driver.waitForSelector(".AppSidebar", { timeout: 30_000 });
  const desired = expanded ? "yes" : "no";
  const current = await driver.getAttribute(".AppSidebar", "data-expanded", { nth: "first" });
  if (current === desired) {
    return;
  }
  await driver.click(".AppSidebarFooterOverlay button", { nth: "last" });
  await driver.waitForFunction(
    (value: string) => document.querySelector(".AppSidebar")?.getAttribute("data-expanded") === value,
    desired,
    { timeout: 10_000 },
  );
}

export async function resolveFirstId(driver: CaptureDriver, resolver: any) {
  await navigate(driver, resolver.route);
  await waitForSelectorCount(driver, resolver.selector, 1);
  if (resolver.attr === "text") {
    const text = await driver.innerText(resolver.selector, { nth: "first" });
    return text.trim();
  }
  const value = await driver.getAttribute(resolver.selector, resolver.attr, { nth: "first" });
  if (!value) {
    throw new Error(`Unable to resolve ${resolver.attr} from ${resolver.selector}`);
  }
  if (resolver.attr === "href") {
    const parts = value.split("/");
    return decodeURIComponent(parts.at(-2) || parts.at(-1) || "");
  }
  return value;
}

export async function resolveRoute(driver: CaptureDriver, item: any) {
  let route = item.route;
  for (const [name, resolver] of Object.entries((item.resolve || {}) as Record<string, any>)) {
    const value = await resolveFirstId(driver, resolver);
    route = route.replace(`$${name}`, encodeURIComponent(value));
  }
  return route;
}

// Move the pointer to the centre of a measured box over `duration` ms of interpolated motion, then
// settle. Shared by both capture scripts so the recorded cursor track is identical across backends.
export async function pointerToBox(driver: CaptureDriver, box: Box | null, duration = 700, settleMs = 120) {
  if (!box) {
    throw new Error("Unable to move pointer: element has no bounding box");
  }
  const steps = Math.max(8, Math.round(duration / 24));
  await driver.pointerMove(box.x + box.width / 2, box.y + box.height / 2, steps);
  await driver.pause(settleMs);
  return box;
}

// Resolve the first match of `selector`, scroll it into view, and move the pointer onto it.
export async function moveToSelector(driver: CaptureDriver, selector: string, duration = 700, settleMs = 120) {
  await driver.waitForSelector(selector, { timeout: 30_000 });
  const box = await driver.boundingBox(selector, { nth: "first", scrollIntoView: true });
  return pointerToBox(driver, box, duration, settleMs);
}

export async function openRowActions(driver: CaptureDriver, rowSelector: string) {
  await moveToSelector(driver, rowSelector, 800);
  // The trailing action-menu button lives inside the first matching row; measure it in-page so the
  // "first row → last button" targeting is one portable query rather than a nested locator.
  const menuButton = await driver.evaluate<Box | null>((sel: string) => {
    const row = document.querySelector(sel);
    if (!row) {
      return null;
    }
    const buttons = row.querySelectorAll("button");
    const button = buttons[buttons.length - 1];
    if (!button) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, rowSelector);
  await pointerToBox(driver, menuButton, 450);
  await driver.pointerDown();
  await driver.pause(80);
  await driver.pointerUp();
  await driver.waitForSelector(".bp6-portal .bp6-menu", { timeout: 10_000 });
}

export async function openNetworkCreate(driver: CaptureDriver) {
  await driver.evaluate(() => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (element) => (element.textContent || "").trim() === "Create",
    );
    button?.click();
  });
  await driver.waitForSelector('[data-form="network.create"]', { timeout: 10_000 });
}

// Drive the AI assistant into a rendered generative-UI card for the screenshot: type a prompt and send it.
// In mock mode the ModelPicker auto-selects a model on first discovery (async), so Send stays disabled until
// then — wait for it to enable before submitting. A read-only "list" prompt (containers/images/…) resolves to
// a typed-tool card with no approval step, so the transcript settles on prose + the card without interaction.
export async function askAssistant(driver: CaptureDriver, prompt: string) {
  await driver.waitForSelector(".AIComposerInput", { timeout: 30_000 });
  await driver.click(".AIComposerInput");
  await driver.fill(".AIComposerInput", prompt);
  await driver.waitForFunction(
    () => {
      const button = document.querySelector<HTMLButtonElement>(".AIComposerSend");
      return !!button && !button.hasAttribute("disabled") && !button.disabled;
    },
    undefined,
    { timeout: 30_000 },
  );
  await driver.click(".AIComposerSend");
  // Wait for the streamed turn to render its typed-tool card (tool-result) before the frame is captured.
  await driver.waitForSelector('[data-screen="ai.assistant"] .AICard', { timeout: 30_000 });
}

// Drive the Build Studio into a completed build for the screenshot: click "Build image" and wait for the run
// to reach the succeeded state. The studio seeds a starter Containerfile and defaults to a native connection,
// so the button is enabled on load; in mock mode buildFixtures replays engine-shaped output so the timeline
// fills and the run succeeds without a real engine.
export async function runBuild(driver: CaptureDriver) {
  await driver.waitForSelector(".BuildActionButton", { timeout: 30_000 });
  await driver.click(".BuildActionButton");
  await driver.waitForSelector('[data-region="run"][data-build-status="succeeded"]', { timeout: 60_000 });
}

export async function runPreActions(
  driver: CaptureDriver,
  actions: Array<{ action: string; rowSelector?: string; prompt?: string; expanded?: boolean }> = [],
) {
  for (const action of actions) {
    if (action.action === "openRowActions") {
      await openRowActions(driver, action.rowSelector!);
    } else if (action.action === "openNetworkCreate") {
      await openNetworkCreate(driver);
    } else if (action.action === "askAssistant") {
      await askAssistant(driver, action.prompt!);
    } else if (action.action === "runBuild") {
      await runBuild(driver);
    } else if (action.action === "setSidebarExpanded") {
      await setSidebarExpanded(driver, action.expanded !== false);
    } else {
      throw new Error(`Unknown screenshot pre action: ${action.action}`);
    }
  }
}

export async function captureWindow(driver: CaptureDriver, path: string) {
  await driver.screenshotElement(".App", path);
}
