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
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
      .bp6-toast-container, .bp6-overlay-backdrop { display: none !important; }
    `,
  });
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

export async function openRowActions(page, rowSelector) {
  const row = page.locator(rowSelector).first();
  await row.waitFor({ timeout: 30_000 });
  await row.hover();
  await row.locator("button").last().click();
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
    } else {
      throw new Error(`Unknown screenshot pre action: ${action.action}`);
    }
  }
}

export async function captureWindow(page, path) {
  await page.locator(".App").screenshot({ path });
}
