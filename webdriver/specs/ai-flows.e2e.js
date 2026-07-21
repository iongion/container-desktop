// AI subsystem end-to-end over W3C WebDriver (Tauri / WebKitGTK). Drives the SAME backend-agnostic flows the
// Electron/Playwright runner uses (support/e2e/ai/flows.mjs) through the WebdriverIO adapter — the pluggable point
// is the driver, the assertions are shared. Verifies the XState→robot3/closure AI rewrite behaves identically on
// the WebKitGTK shell: a generation streams a Containerfile into the editor, and a chat message is echoed and
// answered. Requires a mock app serving the renderer (see wdio.conf.js).

import { runAiFlows } from "../../support/e2e/ai/flows.mjs";
import { createWebdriverioDriver } from "../../support/e2e/ai/webdriverioDriver.mjs";

describe("AI subsystem end-to-end (WebKitGTK / WebDriver)", () => {
  it("streams a generation into the editor and answers a chat message", async () => {
    // The debug binary boots and connects to engines before it is interactive — settle first.
    await browser.pause(3000);
    const driver = createWebdriverioDriver(browser);
    const results = await runAiFlows(driver);
    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name} — ${result.detail}`);
    }
    expect(results.every((result) => result.ok)).toBe(true);
  });
});
