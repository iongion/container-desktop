// Where the app lands at boot, per engine scenario — selected by CONTAINER_DESKTOP_MOCK_CONNECTED, which both shells
// forward into the webview: unset → an engine comes up, "none" → none does (mock/connections.ts mockAvailability).
// Same shape as swarm-ui.e2e.js: one spec, the scenario in the title, and each scenario asserting what it should
// produce — so the default suite run is never vacuous. Routes come from the screens' own Route.Path, never invented.

import { reloadApp } from "../support/appReload.js";

const SCENARIO = (process.env.CONTAINER_DESKTOP_MOCK_CONNECTED || "connected").toLowerCase();
const NOTHING_CONNECTED = SCENARIO === "none";

const CONNECTIONS = "/screens/connections/manage";
const CONTAINERS = "/screens/containers";

const hash = () => browser.execute(() => window.location.hash);

// The app's own readiness contract on <html>. `running` is the scenario's whole point, so it is asserted rather than
// waited past.
async function waitBooted(timeout = 90000) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (wantRunning) => {
          const html = document.documentElement;
          return html.dataset.phase === "ready" && html.dataset.running === wantRunning;
        },
        NOTHING_CONNECTED ? "no" : "yes",
      ),
    {
      timeout,
      interval: 500,
      timeoutMsg: `the app never reached ready with running=${NOTHING_CONNECTED ? "no" : "yes"}`,
    },
  );
}

describe(`landing — ${SCENARIO} scenario`, () => {
  it("boots into the state this scenario asks for", async () => {
    await waitBooted();
    const state = await browser.execute(() => ({ ...document.documentElement.dataset }));
    expect(state.phase).toBe("ready");
    // Without this the rest measures the wrong scenario entirely.
    expect(state.running).toBe(NOTHING_CONNECTED ? "no" : "yes");
  });

  it("redirects to the connection manager only when nothing came up", async () => {
    await waitBooted();
    // From the DEFAULT route: with no engine there is something to fix, so the app takes the user there; with one up
    // there is nothing to fix and it must not move them.
    if (NOTHING_CONNECTED) {
      expect(await hash()).toBe(`#${CONNECTIONS}`);
    } else {
      expect(await hash()).not.toBe(`#${CONNECTIONS}`);
    }
  });

  it("never hijacks a route the user asked for", async () => {
    await waitBooted();
    // A deliberate route, then a reload — which keeps the hash, and is how a real window arrives somewhere other than
    // the default with bootstrap about to run again. It must survive in BOTH scenarios.
    await browser.execute((route) => {
      window.location.hash = route;
    }, CONTAINERS);
    await browser.waitUntil(async () => (await hash()) === `#${CONTAINERS}`, { timeout: 10000 });
    await reloadApp();
    await waitBooted();
    expect(await hash()).toBe(`#${CONTAINERS}`);
  });
});
