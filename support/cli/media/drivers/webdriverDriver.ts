import type { Box, CaptureDriver, Nth, Viewport } from "./types";

// CaptureDriver over a WebdriverIO `browser` (W3C WebDriver → tauri-driver → WebKitWebDriver → the Tauri
// app). WebKitGTK has no CDP, so this is the Tauri counterpart of the Playwright adapter. Notable seams:
//  - execute() passes the single arg positionally to match Playwright's evaluate(fn, arg) semantics.
//  - evaluateAsync() reconstructs the promise-returning page function via indirect eval, because
//    browser.execute does NOT await a returned Promise (only executeAsync's done-callback does).
//  - pointerMove() drives the pointer via the W3C Actions API (performActions) so screenshot
//    pre-actions can position the cursor over a computed box before clicking (e.g. row action menus).
// The __name shim (see runtimeShim.ts) must already be injected in the page before any of these run.

const POINTER_ID = "mouse";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

async function elementFor(browser: any, selector: string, nth?: Nth) {
  if (nth === "last") {
    const elements = await browser.$$(selector);
    return elements[elements.length - 1];
  }
  if (typeof nth === "number") {
    const elements = await browser.$$(selector);
    return elements[nth];
  }
  return browser.$(selector);
}

// Resolve the nth match of a selector and return its viewport-relative box (optionally scrolling it into
// view first). Kept as one page-side query so nth + missing-element handling is uniform.
function measureInPage(browser: any, selector: string, nth: Nth, scrollIntoView: boolean): Promise<Box | null> {
  return browser.execute(
    (sel: string, nthArg: Nth, scroll: boolean) => {
      const nodes = document.querySelectorAll(sel);
      let element: Element | undefined;
      if (nthArg === "last") {
        element = nodes[nodes.length - 1];
      } else if (typeof nthArg === "number") {
        element = nodes[nthArg];
      } else {
        element = nodes[0];
      }
      if (!element) {
        return null;
      }
      if (scroll) {
        element.scrollIntoView({ block: "center", inline: "center" });
      }
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },
    selector,
    nth,
    scrollIntoView,
  );
}

export function createWebdriverDriver(browser: any): CaptureDriver {
  // The W3C input state tracks the pointer location across performActions calls, so we mirror it here to
  // interpolate each move from the real current position (down/up then press at that same spot).
  let lastPointer = { x: 0, y: 0 };

  async function performPointer(actions: any[]) {
    await browser.performActions([{ type: "pointer", id: POINTER_ID, parameters: { pointerType: "mouse" }, actions }]);
  }

  return {
    async evaluate(fn, arg) {
      return arg === undefined ? browser.execute(fn) : browser.execute(fn, arg);
    },

    async evaluateAsync(fn, arg) {
      const source = fn.toString();
      const result = await browser.executeAsync(
        (src: string, pageArg: any, done: (value: any) => void) => {
          try {
            // Reconstruct the (tsx-transpiled) page function from its source and run it in the app realm.
            // biome-ignore lint/security/noGlobalEval: runs in the app's own page via WebDriver, not our Node process
            const rebuilt = eval(`(${src})`);
            Promise.resolve(rebuilt(pageArg)).then(
              (value) => done(value === undefined ? null : value),
              (error) => done({ __captureError: String(error?.message || error) }),
            );
          } catch (error) {
            done({ __captureError: String((error as any)?.message || error) });
          }
        },
        source,
        arg,
      );
      if (result && typeof result === "object" && "__captureError" in result) {
        throw new Error(`evaluateAsync failed in page: ${(result as any).__captureError}`);
      }
      return result as any;
    },

    async waitForFunction(fn, arg, opts) {
      await browser.waitUntil(
        async () => {
          try {
            return Boolean(arg === undefined ? await browser.execute(fn) : await browser.execute(fn, arg));
          } catch {
            // Context can be torn down mid-navigation; treat a transient execute failure as "not yet".
            return false;
          }
        },
        { timeout: opts?.timeout ?? 30_000, interval: 100, timeoutMsg: "waitForFunction timed out" },
      );
    },

    async pause(ms) {
      await browser.pause(ms);
    },

    async waitForLoadState(state = "load") {
      await browser
        .waitUntil(
          async () => {
            try {
              const readyState = await browser.execute(() => document.readyState);
              return state === "domcontentloaded" ? readyState !== "loading" : readyState === "complete";
            } catch {
              return false;
            }
          },
          { timeout: 15_000, interval: 100 },
        )
        .catch(() => undefined);
    },

    async injectScript(source) {
      await browser.execute((src: string) => {
        const element = document.createElement("script");
        element.textContent = src;
        document.head.appendChild(element);
        element.remove();
      }, source);
    },

    async injectStyle(css) {
      await browser.execute((content: string) => {
        const element = document.createElement("style");
        element.textContent = content;
        document.head.appendChild(element);
      }, css);
    },

    async waitForSelector(selector, opts) {
      const element = await browser.$(selector);
      await element.waitForDisplayed({ timeout: opts?.timeout ?? 30_000 });
    },

    async boundingBox(selector, opts): Promise<Box | null> {
      return measureInPage(browser, selector, opts?.nth ?? "first", Boolean(opts?.scrollIntoView));
    },

    async getAttribute(selector, name, opts) {
      return browser.execute(
        (sel: string, attr: string, nthArg: Nth) => {
          const nodes = document.querySelectorAll(sel);
          let element: Element | undefined;
          if (nthArg === "last") {
            element = nodes[nodes.length - 1];
          } else if (typeof nthArg === "number") {
            element = nodes[nthArg];
          } else {
            element = nodes[0];
          }
          return element ? element.getAttribute(attr) : null;
        },
        selector,
        name,
        opts?.nth ?? "first",
      );
    },

    async innerText(selector, opts) {
      return browser.execute(
        (sel: string, nthArg: Nth) => {
          const nodes = document.querySelectorAll(sel);
          let element: any;
          if (nthArg === "last") {
            element = nodes[nodes.length - 1];
          } else if (typeof nthArg === "number") {
            element = nodes[nthArg];
          } else {
            element = nodes[0];
          }
          return element ? element.innerText || element.textContent || "" : "";
        },
        selector,
        opts?.nth ?? "first",
      );
    },

    async fill(selector, value, opts) {
      const element = await elementFor(browser, selector, opts?.nth);
      await element.setValue(value);
    },

    async click(selector, opts) {
      const element = await elementFor(browser, selector, opts?.nth);
      await element.click();
    },

    async pointerMove(x, y, steps) {
      const from = lastPointer;
      const count = Math.max(1, steps);
      // Spread the move over a short window (a few interpolated sub-moves) so WebKit settles hover state.
      const totalMs = clamp(Math.round(count * 12), 120, 700);
      const perStep = Math.max(1, Math.round(totalMs / count));
      const actions: any[] = [];
      for (let index = 1; index <= count; index += 1) {
        actions.push({
          type: "pointerMove",
          duration: perStep,
          origin: "viewport",
          x: Math.round(from.x + ((x - from.x) * index) / count),
          y: Math.round(from.y + ((y - from.y) * index) / count),
        });
      }
      await performPointer(actions);
      lastPointer = { x: Math.round(x), y: Math.round(y) };
    },

    async pointerDown() {
      await performPointer([{ type: "pointerDown", button: 0 }]);
    },

    async pointerUp() {
      await performPointer([{ type: "pointerUp", button: 0 }]);
    },

    async pressKey(key) {
      await browser.keys(key);
    },

    async screenshotElement(selector, path) {
      try {
        const element = await browser.$(selector);
        await element.waitForExist({ timeout: 5_000 });
        await element.saveScreenshot(path);
      } catch {
        // WebKitWebDriver element screenshots can be flaky; the Tauri window is frameless so the full
        // viewport is effectively the .App surface anyway.
        await browser.saveScreenshot(path);
      }
    },

    async screenshotViewport(path) {
      await browser.saveScreenshot(path);
    },

    async url() {
      return browser.getUrl();
    },

    async viewportSize(): Promise<Viewport> {
      return browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
    },
  };
}
