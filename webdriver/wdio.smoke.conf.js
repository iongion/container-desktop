// The SMOKE suite: real integration. Real engines, real machines, a real account, a real model — the opposite
// contract to webdriver/specs/*.e2e.js, which runs on the mock app and nothing else.
//
// A separate CONFIG rather than a `--suite` baked into the package.json script: with `--suite` in the script,
// `--spec <file>` no longer narrows the run — it executes the whole suite, which for this suite means starting
// real containers and spending a real account. A config whose `specs` IS the smoke glob keeps `--spec` meaning
// what it says.
//
// Everything else — the driver pipeline, the isolated user-data dir, the timeouts — is the base config's.
//
//   yarn test:smoke:tauri
//   yarn test:smoke:tauri --spec webdriver/smoke/connection-matrix.smoke.js
//
// A spec here SKIPS when its subject is absent (webdriver/support/prerequisites.js): a powered-off machine, an
// engine with no service, an unbuilt image, a missing account or a model nobody loaded is the operator's
// environment, not a defect in the app.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as base } from "./wdio.conf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read by the base config's beforeSession, which defaults it to "1" only when it is undefined — an explicitly
// empty value is what makes the launched app a REAL one. Set here so the smoke script needs no cross-env.
process.env.CONTAINER_DESKTOP_MOCK = "";

// The harness cap must EXCEED the longest wait a spec does, or the two expire together and the spec never gets to
// say why. The base config's mocha timeout, its connectionRetryTimeout and `pi-plugin-data-live`'s wait for a real
// container pair were all 180000: the spec died mid-WebDriver-command instead of failing with its own message, which
// is the "wedges at the 180s cap" that spec has been carrying as a known failure. Real integration is legitimately
// slower than the mock app — pulling an image and starting a pair is minutes — so the headroom lives here, in the
// suite that needs it, and the mock suite keeps the tighter cap that catches a hang for what it is.
const SPEC_WAIT_HEADROOM_MS = 60000;

// W3C's default script timeout is 30 SECONDS, and every spec here starts a real session from inside
// `browser.executeAsync`: freeing the container name, creating the network, writing the environment, running the image,
// dialling the bridge. When that runs long WebdriverIO does not fail — it RETRIES the script, and the retry starts
// ANOTHER session. Measured on this suite: two agent containers four minutes apart out of one run, the second one's
// client failing on the port and name the first already held, and the whole thing reported as a `before all` timeout
// nowhere near the cause. It is the suite's business rather than each spec's, because what makes a script slow here is
// real containers; a spec that is slower still (the remote one, a dozen SSH round trips) can raise its own on top.
const SCRIPT_TIMEOUT_MS = 600000;

export const config = {
  ...base,
  specs: [path.join(__dirname, "smoke", "**", "*.smoke.js")],
  connectionRetryTimeout: base.connectionRetryTimeout + SPEC_WAIT_HEADROOM_MS,
  mochaOpts: { ...base.mochaOpts, timeout: base.mochaOpts.timeout + SPEC_WAIT_HEADROOM_MS },
  before: async () => {
    await browser.setTimeout({ script: SCRIPT_TIMEOUT_MS });
  },
};
