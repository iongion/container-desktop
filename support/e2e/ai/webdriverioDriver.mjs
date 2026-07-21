// WebdriverIO/W3C-WebDriver adapter of the AiE2eDriver port. Wraps the wdio `browser` global (Tauri / WebKitGTK,
// via tauri-driver → WebKitWebDriver — see webdriver/wdio.conf.js). Used from a wdio spec, where `browser` exists.

/**
 * @param {import("webdriverio").Browser} browser
 * @returns {import("./flows.mjs").AiE2eDriver & { backend: string }}
 */
export function createWebdriverioDriver(browser) {
  return {
    backend: "tauri/webdriverio",
    async goto(hashRoute) {
      await browser.execute((hash) => {
        location.hash = hash;
      }, hashRoute);
      await browser.pause(700);
    },
    evaluate(fn, arg) {
      return browser.execute(fn, arg);
    },
    async waitFor(fn, arg, opts = {}) {
      await browser.waitUntil(async () => !!(await browser.execute(fn, arg)), {
        timeout: opts.timeout ?? 15000,
        timeoutMsg: opts.message || "waitFor timed out",
      });
    },
    async screenshot(filePath) {
      await browser.saveScreenshot(filePath).catch(() => {});
    },
    async close() {
      // The wdio session lifecycle is owned by the runner (wdio.conf.js), not this adapter.
    },
  };
}
