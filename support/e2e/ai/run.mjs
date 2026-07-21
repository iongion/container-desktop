// Pluggable AI end-to-end runner. Picks the driver backend and runs the shared flows (support/e2e/ai/flows.mjs)
// against it. Backends:
//   electron (default) — Playwright/CDP, ATTACHES to the running `CONTAINER_DESKTOP_MOCK=1 yarn dev` app.
//   tauri              — WebdriverIO/WebDriver; run via `yarn test:e2e:tauri` (webdriver/specs/ai-flows.e2e.js),
//                        which owns the wdio session, so it is not launched from this standalone process.
// Select with CONTAINER_DESKTOP_E2E_BACKEND=electron|tauri. Exit code is nonzero if any flow fails.

import { runAiFlows } from "./flows.mjs";
import { createPlaywrightDriver } from "./playwrightDriver.mjs";

const backend = process.env.CONTAINER_DESKTOP_E2E_BACKEND || "electron";

async function main() {
  if (backend === "tauri") {
    console.error(
      "The Tauri/WebdriverIO backend runs under wdio: `yarn test:e2e:tauri` executes webdriver/specs/ai-flows.e2e.js against the same shared flows. This standalone runner is the Electron/Playwright (attach) backend only.",
    );
    process.exit(2);
  }

  const driver = await createPlaywrightDriver();
  try {
    const results = await runAiFlows(driver);
    let failed = 0;
    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(11)} ${result.detail}`);
      if (!result.ok) failed += 1;
    }
    console.log(`\nAI e2e (${driver.backend}): ${results.length - failed}/${results.length} flows passed`);
    process.exit(failed > 0 ? 1 : 0);
  } finally {
    await driver.close();
  }
}

main().catch((error) => {
  console.error("AI e2e runner failed:", error?.message || error);
  process.exit(1);
});
