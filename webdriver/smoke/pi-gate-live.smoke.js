// Proves the permission gate for real: a live model calls pi's bash tool, the app asks, the user rejects, and
// pi refuses to run the tool with the app's reason. Needs a NON-mock app (real podman) and OPENROUTER_API_KEY.
import { strict as assert } from "node:assert";
import { openRouterStartOptions, seedOpenRouterProvider } from "../support/openrouterSession.js";
import { appModeReason, envReason, firstReason, skipSuite } from "../support/prerequisites.js";
import { stopAgentSession } from "../support/agentSession.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? "/home/istoica/Workspace/is/container-desktop/temp/pi-live-workspace";
const MODEL = process.env.CD_LIVE_MODEL ?? "inclusionai/ling-3.0-flash:free";
const PROMPT = "Use your bash tool to run `ls -la /workspace` and tell me what you see. Use the tool, do not guess.";

// One screenshot per WebDriver session is the ceiling: saveScreenshot forces a paint WebKitGTK had parked, and the
// command after a second one hangs and takes the session with it — which reads as the app freezing rather than the
// spec doing it to itself. The assertions below are the verification; the frames are extra evidence, so they are
// budgeted (`PI_SHOTS=3` to capture every stage of a run being debugged) instead of dropped.
let shotsLeft = Number(process.env.PI_SHOTS ?? 1);
async function shot(path) {
  if (shotsLeft <= 0) return;
  shotsLeft -= 1;
  await browser.saveScreenshot(path);
}

describe("the permission gate against a real model", () => {
  // A mock app or a machine with no cloud account cannot answer this at all — skipped, with what is missing.
  before(async function () {
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => envReason("OPENROUTER_API_KEY", "the gate is proven against a real model's own tool call"),
    ]);
    if (blocked) return skipSuite(this, blocked);
  });

  // The spec stops the session on its way through, but a test that fails before that point would orphan the
  // container pair and its /24 — the harness kills the app, so nothing else would ever remove them.
  after(async () => {
    await stopAgentSession(browser);
  });

  it("blocks a rejected shell call inside pi and reports it in the transcript", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/connections/manage";
    });
    await $("[data-connection-id]").waitForExist({ timeout: 60000 });
    const rows = await $$("[data-connection-engine='podman']");
    const id = await rows[0].getAttribute("data-connection-id");

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({ timeout: 45000 });

    // The key goes into the OS keychain and the provider into settings; `start` is then handed a provider ID and

    // no credential, which is the only route a real key takes now.

    await seedOpenRouterProvider(browser, { model: MODEL });

    const started = await browser.executeAsync(
      (options, done) => {
        window.__cdCodingAgentStore
          .getState()
          .start(options)
          .then(() => done(window.__cdCodingAgentStore.getState().status))
          .catch((error) => done(String(error)));
      },
      openRouterStartOptions({ connectionId: id, workspacePath: WORKSPACE, model: MODEL }),
    );
    assert.equal(started, "ready", `the session did not become ready: ${started}`);

    await browser.execute((text) => {
      void window.__cdCodingAgentStore.getState().submit(text);
    }, PROMPT);

    // The model has to decide to call bash, so allow a generous window for the first tool call.
    await $(".AssistantApproval").waitForExist({
      timeout: 120000,
      timeoutMsg: "the model never reached a gated tool call",
    });
    const asked = await browser.execute(() => {
      const item = window.__cdCodingAgentStore
        .getState()
        .view.timeline.find((entry) => entry.kind === "approval" && entry.status === "pending");
      return item ? { tool: item.tool, reason: item.reason } : null;
    });
    assert.ok(asked, "no pending approval reached the store");
    assert.equal(asked.tool, "bash", `the gate should have asked about bash: ${JSON.stringify(asked)}`);
    await shot("/tmp/pi-gate-ask.png");

    const buttons = await $$(".AssistantApprovalActions button");
    await buttons[1].click();

    // One "no" must end it: the agent stops instead of retrying the same command, so the session settles and
    // the user is never asked a second time. Whether pi's own blocked-tool result reaches the app first is a
    // race with that abort, so the contract asserted here is the user-visible one.
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase)) === "idle",
      { timeout: 120000, timeoutMsg: "the agent never stopped after the rejection", interval: 1000 },
    );
    const timeline = await browser.execute(() =>
      window.__cdCodingAgentStore.getState().view.timeline.map((entry) => ({
        kind: entry.kind,
        tool: entry.tool,
        status: entry.status,
        message: entry.message,
      })),
    );
    console.log("GATE TIMELINE", JSON.stringify(timeline, null, 2));
    await shot("/tmp/pi-gate-blocked.png");

    const approvals = timeline.filter((entry) => entry.kind === "approval");
    assert.equal(approvals.length, 1, `the user must be asked once, not in a loop: ${JSON.stringify(approvals)}`);
    assert.equal(approvals[0].status, "rejected", "the card must record the rejection");
    assert.ok(
      !timeline.some((entry) => entry.kind === "tool" && entry.status === "complete"),
      `no shell command may have run: ${JSON.stringify(timeline)}`,
    );
    // The abort is the user's own decision, so it must not read as a model error.
    assert.ok(
      !timeline.some((entry) => entry.kind === "error"),
      `a rejection must not surface as an error: ${JSON.stringify(timeline)}`,
    );
  });

  it("runs the same call once it is allowed", async () => {
    // The rejected turn keeps going (the model gets the block as a tool result), so wait for the session to
    // settle before submitting again — a submit into a live turn is a steer, not a new question.
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase)) === "idle",
      { timeout: 120000, timeoutMsg: "the rejected turn never settled", interval: 1000 },
    );
    const before = await browser.execute(() => window.__cdCodingAgentStore.getState().view.timeline.length);

    await browser.execute((text) => {
      void window.__cdCodingAgentStore.getState().submit(text);
    }, PROMPT);

    await browser.waitUntil(
      async () =>
        await browser.execute(() =>
          window.__cdCodingAgentStore
            .getState()
            .view.timeline.some((entry) => entry.kind === "approval" && entry.status === "pending"),
        ),
      { timeout: 120000, timeoutMsg: "the second turn never reached a gated tool call", interval: 1000 },
    );
    const buttons = await $$(".AssistantApprovalActions button");
    await buttons[0].click();

    await browser.waitUntil(
      async () => {
        const ran = await browser.execute(
          (from) =>
            window.__cdCodingAgentStore
              .getState()
              .view.timeline.slice(from)
              .filter((entry) => entry.kind === "tool" && entry.status === "complete" && entry.ok)
              .map((entry) => ({ tool: entry.tool, message: (entry.message ?? "").slice(0, 200) })),
          before,
        );
        return ran.some((entry) => entry.tool === "bash" && /README/.test(entry.message));
      },
      { timeout: 120000, timeoutMsg: "the allowed shell call never ran", interval: 1000 },
    );
    await shot("/tmp/pi-gate-allowed.png");
  });

  it("stops the session", async () => {
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(() => done(window.__cdCodingAgentStore.getState().status))
        .catch((error) => done(String(error)));
    });
  });
});
