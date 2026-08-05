// WebdriverIO/W3C-WebDriver adapter of the AiE2eDriver port. Wraps the wdio `browser` global (Tauri / WebKitGTK,
// via tauri-driver → WebKitWebDriver — see webdriver/wdio.conf.js). Used from a wdio spec, where `browser` exists.

/**
 * WebKitWebDriver collapses a run of identical keys inside one action chain — `browser.keys("all")` arrives as
 * "al", and `browser.keys(" add")` as " ad", silently. It is the chain, not the app: a plain textarea appended
 * outside React loses exactly the same characters. Split the text so no chain ever repeats a character; separate
 * calls each send their own keyDown/keyUp, so the repeat survives.
 * @param {string} text @returns {string[]}
 */
export function keystrokeChunks(text) {
  /** @type {string[]} */
  const chunks = [];
  let chunk = "";
  for (const character of text) {
    if (chunk && character === chunk.at(-1)) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

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
    async typeText(text) {
      for (const chunk of keystrokeChunks(text)) await browser.keys(chunk);
    },
    async press(key) {
      await browser.keys(key);
    },
    async screenshot(filePath) {
      await browser.saveScreenshot(filePath).catch(() => {});
    },
    async close() {
      // The wdio session lifecycle is owned by the runner (wdio.conf.js), not this adapter.
    },
  };
}
