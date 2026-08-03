// The LIVE AI arm over W3C WebDriver: real provider calls (OpenRouter free tier) against a NON-mock app, running
// the same backend-agnostic flows the mock arm does (support/e2e/ai/liveFlows.mjs). Previously this arm existed
// only behind a standalone Chromium runner; it now runs on the shell that ships.
//
// SKIPS LOUD when OPENROUTER_API_KEY is absent, and treats free-tier variance as SKIP rather than FAIL — the
// same contract src/__tests__/live/ai-agent.live.test.ts follows.
//
//   CONTAINER_DESKTOP_MOCK= yarn test:e2e:ai:live
import { runLiveFlows } from "../../support/e2e/ai/liveFlows.mjs";
import { createWebdriverioDriver } from "../../support/e2e/ai/webdriverioDriver.mjs";

// The app reads OPENROUTER_API_KEY from .env.development.local (vite loads it into the app's process); this wdio
// process does not, so load it the same way for the skip-loud pre-check. Node 24 `loadEnvFile`.
function liveKeyPresent() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return true;
  try {
    process.loadEnvFile(".env.development.local");
  } catch {
    // no env file — fall through to the empty check
  }
  return !!process.env.OPENROUTER_API_KEY?.trim();
}

describe("AI subsystem LIVE end-to-end (WebKitGTK / WebDriver)", () => {
  it("runs the live provider flows", async function () {
    if (!liveKeyPresent()) {
      console.warn("[live] OPENROUTER_API_KEY not set (checked env + .env.development.local) — skipping the live AI arm.");
      this.skip();
    }
    await browser.pause(3000);
    const driver = createWebdriverioDriver(browser);
    const results = await runLiveFlows(driver);
    let failed = 0;
    let skipped = 0;
    for (const result of results) {
      const tag = result.skipped ? "SKIP" : result.ok ? "PASS" : "FAIL";
      console.log(`${tag}  ${result.name} — ${result.detail}`);
      if (result.skipped) skipped += 1;
      else if (!result.ok) failed += 1;
    }
    console.log(`AI e2e LIVE: ${results.length - failed - skipped}/${results.length} passed, ${skipped} skipped`);
    expect(failed).toBe(0);
  });
});
