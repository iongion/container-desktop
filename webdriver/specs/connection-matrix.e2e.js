// Real connectivity matrix against the owner's machines, driven INSIDE the shell over W3C WebDriver. Replaces
// the deleted Vitest suite, which could only run because a Node executor existed; the engine ports live in
// Rust (Tauri) and Go (Wails), so the matrix runs where they do and proves the shipping path instead of a
// parallel Node one.
//
// Native hosts get a full /_ping + container list; SSH remotes are checked end-to-end by the bounded
// pre-flight; scoped hosts (WSL/LIMA/vendor) go through the real getAvailability detection. Unconfigured
// combos are skipped LOUDLY — never silently passed.
//
// Needs a NON-mock app: run with CONTAINER_DESKTOP_MOCK= (empty) so fixtures are off.
//   CONTAINER_DESKTOP_MOCK= yarn test:e2e:tauri --spec webdriver/specs/connection-matrix.e2e.js
import { engineOfHost, isNativeHost, isRemoteHost, selectLiveTargets, toProbeTarget } from "../support/liveTargets.js";

const targets = selectLiveTargets(process.env.CONTAINER_DESKTOP_TEST_TARGETS);

async function waitForProbe() {
  await browser.waitUntil(async () => browser.execute(() => typeof window.__cdLiveProbe?.connectionMatrix === "function"), {
    timeout: 30000,
    interval: 500,
    timeoutMsg: "window.__cdLiveProbe never appeared — is this a dev build? (the probe is DEV-gated)",
  });
}

if (targets.length === 0) {
  describe("live connection matrix", () => {
    it("has no configured targets", function () {
      console.warn(
        "[live] no targets configured — copy src/__tests__/live/targets.example.env to targets.env, or set CONTAINER_DESKTOP_TEST_TARGETS",
      );
      this.skip();
    });
  });
} else {
  console.warn(
    `[live] running ${targets.length} target(s): ${targets.map((t) => `${t.id}[${t.hosts.length} hosts]`).join(", ")}`,
  );

  for (const target of targets) {
    describe(`live: ${target.id} (${target.os})`, () => {
      before(async () => {
        // The app boots and connects before it is interactive — settle, then confirm the seam.
        await browser.pause(4000);
        await waitForProbe();
      });

      for (const host of target.hosts) {
        const engine = engineOfHost(host);
        const shape = isRemoteHost(host) ? "remote" : isNativeHost(host) ? "native" : "scoped";

        it(`${host} is reachable`, async function () {
          const observation = await browser.execute(
            async (probeTarget, probeEngine, probeHost, probeShape) =>
              window.__cdLiveProbe.connectionMatrix(probeTarget, probeEngine, probeHost, probeShape),
            toProbeTarget(target, engine),
            engine,
            host,
            shape,
          );

          if (observation.skipped) {
            console.warn(`[live] ${target.id}/${host}: skipped — ${observation.skipped}`);
            this.skip();
            return;
          }
          expect(observation.ok, `${host}: ${observation.detail}`).toBe(true);
          if (shape === "native") {
            expect(observation.containersIsArray, `${host}: /containers/json was not an array`).toBe(true);
          }
        });
      }
    });
  }
}
