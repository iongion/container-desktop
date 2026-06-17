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

export async function setSidebarExpanded(page, expanded) {
  await page.locator(".AppSidebar").waitFor({ timeout: 30_000 });
  const desired = expanded ? "yes" : "no";
  const current = await page.locator(".AppSidebar").first().getAttribute("data-expanded");
  if (current === desired) {
    return;
  }
  await page.locator(".AppSidebarFooterOverlay button").last().click();
  await page.waitForFunction((value) => document.querySelector(".AppSidebar")?.getAttribute("data-expanded") === value, desired, {
    timeout: 10_000,
  });
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

export async function runPreActions(page, actions = []) {
  for (const action of actions) {
    if (action.action === "openRowActions") {
      await openRowActions(page, action.rowSelector);
    } else if (action.action === "openNetworkCreate") {
      await openNetworkCreate(page);
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
