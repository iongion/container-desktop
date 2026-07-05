import type { Locator, Page } from "playwright-core";
import type { Box, CaptureDriver, Nth, Viewport } from "./types";

// CaptureDriver over a Playwright Page (CDP → Chromium → Electron). A thin 1:1 wrapper: every method
// maps straight to the page call the capture scripts used before the port was introduced, so the
// Electron capture output is unchanged.

function locatorFor(page: Page, selector: string, nth?: Nth): Locator {
  const base = page.locator(selector);
  if (nth === "last") {
    return base.last();
  }
  if (typeof nth === "number") {
    return base.nth(nth);
  }
  return base.first();
}

export function createPlaywrightDriver(page: Page): CaptureDriver {
  return {
    async evaluate(fn, arg) {
      return (await page.evaluate(fn as any, arg)) as any;
    },
    async evaluateAsync(fn, arg) {
      // page.evaluate awaits a returned Promise natively, so an async page function just works here.
      return (await page.evaluate(fn as any, arg)) as any;
    },
    async waitForFunction(fn, arg, opts) {
      await page.waitForFunction(fn as any, arg, opts);
    },
    async pause(ms) {
      await page.waitForTimeout(ms);
    },
    async waitForLoadState(state = "load") {
      await page.waitForLoadState(state).catch(() => undefined);
    },
    async injectScript(source) {
      await page.addScriptTag({ content: source });
    },
    async injectStyle(css) {
      await page.addStyleTag({ content: css });
    },
    async waitForSelector(selector, opts) {
      await locatorFor(page, selector).waitFor({ timeout: opts?.timeout });
    },
    async boundingBox(selector, opts): Promise<Box | null> {
      const locator = locatorFor(page, selector, opts?.nth);
      if (opts?.scrollIntoView) {
        await locator.scrollIntoViewIfNeeded();
      }
      return locator.boundingBox();
    },
    async getAttribute(selector, name, opts) {
      return locatorFor(page, selector, opts?.nth).getAttribute(name);
    },
    async innerText(selector, opts) {
      return locatorFor(page, selector, opts?.nth).innerText();
    },
    async fill(selector, value, opts) {
      await locatorFor(page, selector, opts?.nth).fill(value);
    },
    async click(selector, opts) {
      await locatorFor(page, selector, opts?.nth).click();
    },
    async pointerMove(x, y, steps) {
      await page.mouse.move(x, y, { steps });
    },
    async pointerDown() {
      await page.mouse.down();
    },
    async pointerUp() {
      await page.mouse.up();
    },
    async pressKey(key) {
      await page.keyboard.press(key);
    },
    async screenshotElement(selector, path) {
      await page.locator(selector).first().screenshot({ path, scale: "css" });
    },
    async screenshotViewport(path) {
      await page.screenshot({ path });
    },
    async url() {
      return page.url();
    },
    async viewportSize(): Promise<Viewport> {
      return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    },
  };
}
