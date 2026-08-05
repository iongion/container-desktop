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
//   yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js
import { strict as assert } from "node:assert";
import { engineOfHost, isNativeHost, isRemoteHost, selectLiveTargets, toProbeTarget } from "../support/liveTargets.js";
import { appModeReason, remoteEngineReason, skippedSuite, skipSuite, targetReason } from "../support/prerequisites.js";

const targets = selectLiveTargets(process.env.CONTAINER_DESKTOP_TEST_TARGETS);
const wrongApp = appModeReason("real");

async function waitForProbe() {
  await browser.waitUntil(async () => browser.execute(() => typeof window.__cdLiveProbe?.connectionMatrix === "function"), {
    timeout: 30000,
    interval: 500,
    timeoutMsg: "window.__cdLiveProbe never appeared — is this a dev build? (the probe is DEV-gated)",
  });
}

if (wrongApp) {
  skippedSuite("live connection matrix", wrongApp);
} else if (targets.length === 0) {
  skippedSuite(
    "live connection matrix",
    "no targets configured — copy src/__tests__/live/targets.example.env to targets.env, or set CONTAINER_DESKTOP_TEST_TARGETS",
  );
} else {
  console.warn(
    `[live] running ${targets.length} target(s): ${targets.map((t) => `${t.id}[${t.hosts.length} hosts]`).join(", ")}`,
  );

  for (const target of targets) {
    describe(`live: ${target.id} (${target.os})`, () => {
      before(async function () {
        // A machine that is powered off or a laptop that is closed is not a defect in the app — this target's whole
        // suite is skipped, saying which machine and where it was dialled, instead of reporting failures per host.
        const unreachable = await targetReason(target);
        if (unreachable) return skipSuite(this, unreachable);
        // The app boots and connects before it is interactive — settle, then confirm the seam.
        await browser.pause(4000);
        await waitForProbe();
      });

      for (const host of target.hosts) {
        const engine = engineOfHost(host);
        const shape = isRemoteHost(host) ? "remote" : isNativeHost(host) ? "native" : "scoped";

        it(`${host} is reachable`, async function () {
          // A native host IS this machine, so what stands in for "is it up" is the engine socket being there. A
          // remote one is a machine that answered on 22 — which says nothing about whether the engine it declares is
          // running there, so that is asked separately, over plain ssh.
          const absent = isNativeHost(host)
            ? await targetReason(target, engine)
            : isRemoteHost(host)
              ? remoteEngineReason(target, engine)
              : undefined;
          if (absent) {
            console.warn(`[live] SKIP ${target.id}/${host} — ${absent}`);
            this.skip();
            return;
          }
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
          // node's assert, not expect: expect-webdriverio takes ONE argument, so the two-argument Jest form threw
          // "Expect takes at most one argument" the moment a target was actually reachable — which is why every run
          // of this spec until a live sandbox existed looked fine. The message is the whole value here: it names
          // which host failed and what the probe saw.
          assert.ok(observation.ok, `${host}: ${observation.detail}`);
          if (shape === "native") {
            assert.ok(observation.containersIsArray, `${host}: /containers/json was not an array`);
          }
        });
      }
    });
  }
}
