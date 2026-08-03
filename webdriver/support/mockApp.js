// WebDriver equivalents of the Playwright helpers the CDP UI suites used. The app signals readiness on <html>
// (data-phase/running/provisioned), which is shell-independent, so that contract carries over unchanged.
export async function waitReady(browser, timeout = 60000) {
  await browser.waitUntil(
    async () =>
      browser.execute(() => {
        const html = document.documentElement;
        return html.dataset.phase === "ready" && html.dataset.running === "yes" && html.dataset.provisioned === "yes";
      }),
    { timeout, interval: 500, timeoutMsg: "the app never reached the ready/running/provisioned phase" },
  );
}

export async function navigate(browser, route) {
  await browser.execute((nextRoute) => {
    if (window.location.hash !== `#${nextRoute}`) {
      window.location.hash = nextRoute;
    }
  }, route);
  await waitReady(browser);
}

export async function countOf(browser, selector) {
  return browser.execute((sel) => document.querySelectorAll(sel).length, selector);
}

export async function expectAtLeast(browser, selector, minimum, timeout = 30000) {
  await browser.waitUntil(async () => (await countOf(browser, selector)) >= minimum, {
    timeout,
    interval: 500,
    timeoutMsg: `fewer than ${minimum} nodes matched ${selector}`,
  });
}
