export async function waitReady(page, opts = {}) {
  const timeout = opts.timeout ?? 45_000;
  await page.waitForFunction(
    () => {
      const html = document.documentElement;
      return html.dataset.phase === "ready" && html.dataset.running === "yes" && html.dataset.provisioned === "yes";
    },
    undefined,
    { timeout },
  );
}

export async function freezeUi(page) {
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
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await page.addStyleTag({ content });
      await page.evaluate(() => {
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
          for (const element of document.querySelectorAll(selectors.join(","))) {
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
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  throw lastError;
}

export async function navigate(page, route) {
  await page.evaluate((nextRoute) => {
    if (window.location.hash !== `#${nextRoute}`) {
      window.location.hash = nextRoute;
    }
  }, route);
  await waitReady(page);
  await page.waitForTimeout(50);
}

export async function waitForSelectorCount(page, selector, minCount = 1, timeout = 30_000) {
  await page.waitForFunction(
    ([targetSelector, targetCount]) => document.querySelectorAll(targetSelector).length >= targetCount,
    [selector, minCount],
    { timeout },
  );
}

// After landing on a screen, wait for the route transition to FULLY settle before capturing or
// recording: the previous screen must unmount and the new one must render its data and paint.
// Without this a frame (or an rrweb pause) can land mid-transition where the old screen still overlaps
// the new one. Waits until DOM mutations go quiet for `quietMs` (bounded by `maxWaitMs` so a steadily
// polling screen can't hang it), then two animation frames so the settled tree has actually painted.
export async function settleOnScreen(page, quietMs = 350, maxWaitMs = 4000) {
  if (!quietMs || quietMs <= 0) {
    return;
  }
  await waitReady(page).catch(() => undefined);
  await page.evaluate(
    ([quiet, maxWait]) =>
      new Promise((resolve) => {
        const start = performance.now();
        let timer;
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

export async function setSidebarExpanded(page, expanded) {
  await page.locator(".AppSidebar").waitFor({ timeout: 30_000 });
  const desired = expanded ? "yes" : "no";
  const current = await page.locator(".AppSidebar").first().getAttribute("data-expanded");
  if (current === desired) {
    return;
  }
  await page.locator(".AppSidebarFooterOverlay button").last().click();
  await page.waitForFunction(
    (value) => document.querySelector(".AppSidebar")?.getAttribute("data-expanded") === value,
    desired,
    {
      timeout: 10_000,
    },
  );
}

export async function resolveFirstId(page, resolver) {
  await navigate(page, resolver.route);
  await waitForSelectorCount(page, resolver.selector, 1);
  if (resolver.attr === "text") {
    const text = await page.locator(resolver.selector).first().innerText();
    return text.trim();
  }
  const value = await page.locator(resolver.selector).first().getAttribute(resolver.attr);
  if (!value) {
    throw new Error(`Unable to resolve ${resolver.attr} from ${resolver.selector}`);
  }
  if (resolver.attr === "href") {
    const parts = value.split("/");
    return decodeURIComponent(parts.at(-2) || parts.at(-1) || "");
  }
  return value;
}

export async function resolveRoute(page, item) {
  let route = item.route;
  for (const [name, resolver] of Object.entries(item.resolve || {})) {
    const value = await resolveFirstId(page, resolver);
    route = route.replace(`$${name}`, encodeURIComponent(value));
  }
  return route;
}

async function moveToLocator(page, locator, duration = 700) {
  await locator.waitFor({ timeout: 30_000 });
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Unable to move pointer: element has no bounding box");
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: Math.max(8, Math.round(duration / 24)),
  });
  await page.waitForTimeout(120);
}

export async function openRowActions(page, rowSelector) {
  const row = page.locator(rowSelector).first();
  await moveToLocator(page, row, 800);
  const menuButton = row.locator("button").last();
  await moveToLocator(page, menuButton, 450);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.locator(".bp6-portal .bp6-menu").first().waitFor({ timeout: 10_000 });
}

export async function openNetworkCreate(page) {
  await page.getByRole("button", { name: "Create" }).first().click();
  await page.locator('[data-form="network.create"]').waitFor({ timeout: 10_000 });
}

// Drive the AI assistant into a rendered generative-UI card for the screenshot: type a prompt and send it.
// In mock mode the ModelPicker auto-selects a model on first discovery (async), so Send stays disabled until
// then — wait for it to enable before submitting. A read-only "list" prompt (containers/images/…) resolves to
// a typed-tool card with no approval step, so the transcript settles on prose + the card without interaction.
export async function askAssistant(page, prompt) {
  const input = page.locator(".AIComposerInput").first();
  await input.waitFor({ timeout: 30_000 });
  await input.click();
  await input.fill(prompt);
  await page.waitForFunction(
    () => {
      const button = document.querySelector(".AIComposerSend");
      return !!button && !button.hasAttribute("disabled") && !button.disabled;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.locator(".AIComposerSend").first().click();
  // Wait for the streamed turn to render its typed-tool card (tool-result) before the frame is captured.
  await page.locator('[data-screen="ai.assistant"] .AICard').first().waitFor({ timeout: 30_000 });
}

// Drive the Build Studio into a completed build for the screenshot: click "Build image" and wait for the run
// to reach the succeeded state. The studio seeds a starter Containerfile and defaults to a native connection,
// so the button is enabled on load; in mock mode buildFixtures replays engine-shaped output so the timeline
// fills and the run succeeds without a real engine.
export async function runBuild(page) {
  const button = page.locator(".BuildActionButton").first();
  await button.waitFor({ timeout: 30_000 });
  await button.click();
  await page.locator('[data-region="run"][data-build-status="succeeded"]').first().waitFor({ timeout: 60_000 });
}

export async function runPreActions(page, actions = []) {
  for (const action of actions) {
    if (action.action === "openRowActions") {
      await openRowActions(page, action.rowSelector);
    } else if (action.action === "openNetworkCreate") {
      await openNetworkCreate(page);
    } else if (action.action === "askAssistant") {
      await askAssistant(page, action.prompt);
    } else if (action.action === "runBuild") {
      await runBuild(page);
    } else if (action.action === "setSidebarExpanded") {
      await setSidebarExpanded(page, action.expanded !== false);
    } else {
      throw new Error(`Unknown screenshot pre action: ${action.action}`);
    }
  }
}

export async function captureWindow(page, path) {
  await page.locator(".App").screenshot({ path, scale: "css" });
}
