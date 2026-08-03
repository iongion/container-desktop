// Swarm UI over the deterministic mock backend, ported from the deleted CDP suite. The scenario rides
// CONTAINER_DESKTOP_MOCK_SWARM, which both shells now forward into the webview: "manager" → populated tabs,
// "none" → the Initialize empty state.
import { expectAtLeast, navigate, waitReady } from "../support/mockApp.js";

const SCENARIO = (process.env.CONTAINER_DESKTOP_MOCK_SWARM || "manager").toLowerCase();

describe(`swarm mock UI — ${SCENARIO} scenario`, () => {
  before(async () => {
    await browser.pause(4000);
    await waitReady(browser);
  });

  it("renders the expected swarm surface", async () => {
    if (SCENARIO === "none") {
      await navigate(browser, "/screens/swarm");
      await browser.waitUntil(
        async () => browser.execute(() => document.body.textContent?.includes("Initialize Swarm") === true),
        { timeout: 30000, interval: 500, timeoutMsg: "the Initialize Swarm empty state never rendered" },
      );
      return;
    }
    await navigate(browser, "/screens/swarm?tab=services");
    await expectAtLeast(browser, '[data-table="swarm.services"] [data-service]', 1);
    await navigate(browser, "/screens/swarm?tab=nodes");
    await expectAtLeast(browser, '[data-table="swarm.nodes"] [data-node]', 1);
    await navigate(browser, "/screens/swarm?tab=stacks");
    await expectAtLeast(browser, '[data-table="swarm.stacks"] [data-stack]', 1);
  });
});
