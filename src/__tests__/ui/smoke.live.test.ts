import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppSession, headlessFromEnv, launchApp, productionMainPath } from "./app-harness";

// Smallest possible CDP machinery check: launch the packaged app, confirm the preload bridge comes up
// and the window renders. Real UI assertions come later. Skips loudly when it can't run.
const skipReason = !existsSync(productionMainPath())
  ? "no production build — run `cross-env ENVIRONMENT=production yarn build`"
  : process.platform === "linux" && !process.env.DISPLAY && !headlessFromEnv()
    ? "no DISPLAY on Linux — run under a display, or set CONTAINER_DESKTOP_HEADLESS=1 (with xvfb)"
    : null;

if (skipReason) {
  console.warn(`[ui] smoke skipped: ${skipReason}`);
}

const suite = skipReason ? describe.skip : describe;

suite("app CDP smoke", () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await launchApp();
  }, 60_000);

  afterAll(async () => {
    await session?.close().catch(() => {});
  });

  it("brings up the renderer with the preload bridge ready", async () => {
    const ready = await session.page.evaluate(() => (window as unknown as { Preloaded?: boolean }).Preloaded === true);
    expect(ready).toBe(true);
  });

  it("renders a titled window with body content", async () => {
    expect(await session.page.title()).toBeTruthy();
    await session.page.waitForSelector("body", { timeout: 10_000 });
    const childCount = await session.page.evaluate(() => document.body.childElementCount);
    expect(childCount).toBeGreaterThan(0);
  });
});
