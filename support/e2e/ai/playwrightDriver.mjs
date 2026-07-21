// Playwright/CDP adapter of the AiE2eDriver port. ATTACHES to the already-running Electron dev app over the
// Chrome DevTools Protocol (never launches a second instance — the project's hard rule); endpoint discovery
// mirrors support/cdp.mjs (explicit $CDP_URL, else the handshake file support/watch.mjs writes, else :9222).

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const CDP_ENDPOINT_FILE = path.join(os.tmpdir(), "container-desktop-cdp.json");

function discoverCdpUrl() {
  if (process.env.CDP_URL) return process.env.CDP_URL;
  try {
    if (existsSync(CDP_ENDPOINT_FILE)) {
      const { cdpUrl } = JSON.parse(readFileSync(CDP_ENDPOINT_FILE, "utf8"));
      if (cdpUrl) return cdpUrl;
    }
  } catch {
    // fall through to the default port
  }
  return "http://localhost:9222";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<import("./flows.mjs").AiE2eDriver & { backend: string }>} */
export async function createPlaywrightDriver() {
  const endpoint = discoverCdpUrl();
  const browser = await chromium.connectOverCDP(endpoint).catch((error) => {
    throw new Error(`Unable to attach to ${endpoint} — is the dev app running (CONTAINER_DESKTOP_MOCK=1 yarn dev)? ${error.message}`);
  });
  const pickPage = () => {
    const pages = browser.contexts().flatMap((context) => context.pages());
    return pages.find((page) => page.url().startsWith("http://localhost") || page.url().startsWith("file://")) || pages[0];
  };

  // Settle through dev-boot navigations until the renderer reports ready.
  let page = pickPage();
  for (let attempt = 0; attempt < 45; attempt += 1) {
    page = pickPage();
    if (page) {
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      const phase = await page.evaluate(() => document.documentElement?.getAttribute("data-phase")).catch(() => null);
      if (phase === "ready") break;
    }
    await sleep(1000);
  }

  return {
    backend: "electron/playwright",
    async goto(hashRoute) {
      page = pickPage();
      await page.evaluate((hash) => {
        location.hash = hash;
      }, hashRoute);
      await sleep(700);
    },
    evaluate(fn, arg) {
      return pickPage().evaluate(fn, arg);
    },
    async waitFor(fn, arg, opts = {}) {
      // Timer polling, not the default requestAnimationFrame: rAF is throttled/paused while the Electron window is
      // backgrounded (this attaches to a possibly-unfocused app), which would stall the wait until timeout.
      await pickPage().waitForFunction(fn, arg, { timeout: opts.timeout ?? 15000, polling: 300 });
    },
    async screenshot(filePath) {
      await pickPage()
        .screenshot({ path: filePath, animations: "disabled", timeout: 15000 })
        .catch(() => {});
    },
    async close() {
      // Attached, not launched: release the CDP connection without closing the user's app.
      await browser.close().catch(() => {});
    },
  };
}
