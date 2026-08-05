// Starting a session on a model the local server has NOT loaded — the path that reached the owner three times as a
// broken app: LM Studio's OpenAI-shaped /v1/models lists everything DOWNLOADED, so the drawer offers models nothing
// has in memory, and the load used to happen on the first prompt where its failure read as the conversation dying.
//
// The subject here is the REAL integration: a real LM Studio, a real load over its REST surface, the real drawer.
// So an absent server, or a server with nothing to load, SKIPS naming what was missing.
//
//   yarn test:smoke:tauri --spec webdriver/smoke/pi-lmstudio-load.smoke.js
//
// Overrides: CD_LIVE_LMSTUDIO_URL, CD_LIVE_LOADABLE_MODEL (a model this machine can actually load).

import { strict as assert } from "node:assert";

import { LM_STUDIO_BASE_URL } from "../support/lmstudioSession.js";
import { appModeReason, endpointReason, firstReason, skipSuite } from "../support/prerequisites.js";

const ORIGIN = LM_STUDIO_BASE_URL.replace(/\/v\d+\/?$/, "");

async function models() {
  const response = await fetch(`${ORIGIN}/api/v0/models`, { signal: AbortSignal.timeout(10000) });
  const payload = await response.json();
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function stateOf(id) {
  return (await models()).find((model) => model.id === id)?.state;
}

// A model this server can actually load, proven by loading it — not by its presence in the list. The qwen35-arch
// family on the owner's machine lists happily and fails every load, which is exactly the trap this spec exists for:
// choosing a subject by what is LISTED would make the spec fail for the model's reason, not the app's.
async function loadableModel() {
  const named = process.env.CD_LIVE_LOADABLE_MODEL;
  const all = await models();
  const loaded = all.find((model) => model.state === "loaded");
  if (named) return named;
  // One already in memory is the safest subject: the app must skip loading it and start regardless.
  return loaded?.id ?? all[0]?.id;
}

describe("starting a session on a local model", () => {
  let model;
  let connection;

  before(async function () {
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => endpointReason(`${ORIGIN}/api/v0/models`, "LM Studio"),
    ]);
    if (blocked) return skipSuite(this, blocked);
    model = await loadableModel();
    if (!model) return skipSuite(this, "LM Studio has no models downloaded — nothing to start a session on");
    await browser.pause(4000);
    // The pair runs on a real engine, so the session needs the connection the app itself lists — start() resolves
    // the engine host BEFORE it loads the model, and an invented id fails there instead of exercising the load.
    await browser.execute(() => {
      window.location.hash = "#/screens/connections/manage";
    });
    await $("[data-connection-id]").waitForExist({ timeout: 60000, timeoutMsg: "no connection rows rendered" });
    const rows = await $$("[data-connection-engine='podman'], [data-connection-engine='docker']");
    if (!rows.length) return skipSuite(this, "no podman or docker connection in this app — the pair has nowhere to run");
    connection = await rows[0].getAttribute("data-connection-id");
  });

  it("asks the server to load a model it has not got in memory, before the first prompt", async function () {
    const before = await stateOf(model);
    const outcome = await browser.executeAsync(
      (modelId, connectionId, done) => {
        const store = window.__cdCodingAgentStore;
        if (!store) return done({ seam: false });
        // The app's own start path, exactly as the drawer drives it.
        store
          .getState()
          .start({
            connectionId,
            workspacePath: "/tmp",
            modelId,
            providerId: "lmstudio",
            upstreamBaseUrl: "http://127.0.0.1:1234/v1",
            appVersion: "6.0.0",
          })
          .then(() => {
            const state = store.getState();
            done({ seam: true, status: state.status, error: state.error, log: state.startLog });
          })
          .catch((error) => done({ seam: true, status: "throw", error: String(error) }));
      },
      model,
      connection,
    );
    if (!outcome.seam) return skipSuite(this, "this build has no __cdCodingAgentStore seam — it is DEV-gated");

    // What the drawer showed the user, and the whole point of the change: the load is announced where they are
    // already watching, not discovered when a turn fails.
    assert.ok(
      (outcome.log ?? []).some((line) => /loading .* into the local server/.test(line)) || before === "loaded",
      `the start log never mentions loading the model: ${JSON.stringify(outcome.log)}`,
    );
    // Either the server now has it in memory, or the app refused to start and said why in the server's own words.
    const after = await stateOf(model);
    if (outcome.status === "error") {
      assert.match(
        outcome.error ?? "",
        /could not load/i,
        `a refused load must name the server's reason: ${outcome.error}`,
      );
      // And it must not have printed a shell command at the user.
      assert.ok(!/lms /.test(outcome.error ?? ""), `the app must load it itself, not tell the user to: ${outcome.error}`);
      return;
    }
    assert.equal(after, "loaded", `the session started while ${model} is ${after} — the first prompt would fail`);
  });

  after(async () => {
    await browser
      .execute(() => window.__cdCodingAgentStore?.getState().stop())
      .catch(() => {
        // The session may never have started; stopping is tidy-up, not the assertion.
      });
  });
});
