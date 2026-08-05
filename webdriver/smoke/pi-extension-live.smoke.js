// Real container, real pi, real extension: proves the host→app channel end to end. The plugin volume is
// seeded with an extension that drives ctx.ui from `turn_start`, so a submitted prompt makes the container
// ask the app questions — no model reply is needed for the dialogs to appear.
//
// Needs a NON-mock app (real podman) and OPENROUTER_API_KEY in the environment.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openRouterStartOptions, seedOpenRouterProvider } from "../support/openrouterSession.js";
import { agentImageReason, appModeReason, envReason, firstReason, skipSuite } from "../support/prerequisites.js";
import { stopAgentSession } from "../support/agentSession.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.resolve(import.meta.dirname, "../../temp/pi-live-workspace");
const MODEL = process.env.CD_LIVE_MODEL ?? "inclusionai/ling-3.0-flash:free";
const IMAGE = process.env.CD_LIVE_IMAGE ?? "container-desktop/pi-agent:6.0.0";
const PLUGIN_VOLUME = "cd-agent-plugins";

// The extension under test. It drives ctx.ui from `turn_start`, which is an event the bridge already triggers —
// pi commands are not dispatched over the bridge yet, so a `/probe` command would never run.
const EXTENSION = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    ctx.ui.setStatus("probe", "running");
    ctx.ui.setWidget("probe", ["widget line one", "widget line two"]);
    ctx.ui.notify("probe started", "info");
    const picked = await ctx.ui.select("Pick one", ["alpha", "beta"]);
    const ok = await ctx.ui.confirm("Confirm?", \`you picked \${picked}\`);
    ctx.ui.setStatus("probe", \`answered \${picked}/\${ok}\`);
  });
}
`;

// The plugin volume is a container volume, so seeding it means writing from inside a container. Root plus a
// chown, because the session mounts it as the image's `agent` user (1001).
function seedExtension(source) {
  try {
    execFileSync("podman", ["volume", "create", PLUGIN_VOLUME], { stdio: "ignore" });
  } catch {
    // Already there from an earlier session — the app reuses one plugin volume by name.
  }
  execFileSync("podman", [
    "run",
    "--rm",
    "--user",
    "root",
    "--entrypoint",
    "sh",
    "--volume",
    `${PLUGIN_VOLUME}:/mnt`,
    "--volume",
    `${source}:/seed/ui-probe.ts:ro`,
    IMAGE,
    "-c",
    "mkdir -p /mnt/extensions && cp /seed/ui-probe.ts /mnt/extensions/ui-probe.ts && chown -R 1001:1001 /mnt",
  ]);
}

function removeExtension() {
  execFileSync("podman", [
    "run",
    "--rm",
    "--user",
    "root",
    "--entrypoint",
    "sh",
    "--volume",
    `${PLUGIN_VOLUME}:/mnt`,
    IMAGE,
    "-c",
    "rm -f /mnt/extensions/ui-probe.ts",
  ]);
}

async function connectionId() {
  await browser.execute(() => {
    window.location.hash = "#/screens/connections/manage";
  });
  await $("[data-connection-id]").waitForExist({ timeout: 60000, timeoutMsg: "no connection rows rendered" });
  const rows = await $$("[data-connection-engine='podman']");
  assert.ok(rows.length > 0, "this spec needs a podman connection");
  return await rows[0].getAttribute("data-connection-id");
}

// One screenshot per WebDriver session is the ceiling: saveScreenshot forces a paint WebKitGTK had parked, and the
// command after a second one hangs and takes the session with it — which reads as the app freezing rather than the
// spec doing it to itself. The assertions below are the verification; the frames are extra evidence, so they are
// budgeted (`PI_SHOTS=2` to capture both dialogs of a run being debugged) instead of dropped.
let shotsLeft = Number(process.env.PI_SHOTS ?? 1);
async function shot(path) {
  if (shotsLeft <= 0) return;
  shotsLeft -= 1;
  await browser.saveScreenshot(path);
}

describe("pi extension UI against a real container", () => {
  before(async function () {
    // Seeding an extension into a workspace is pointless without the app, the account and the image that run it.
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => envReason("OPENROUTER_API_KEY", "the extension's dialogs are driven by a real model's tool call"),
      () => agentImageReason("podman", IMAGE),
    ]);
    if (blocked) return skipSuite(this, blocked);
    mkdirSync(WORKSPACE, { recursive: true });
    writeFileSync(path.join(WORKSPACE, "README.md"), "live workspace for the pi extension probe\n");
    const source = path.join(WORKSPACE, "ui-probe.ts");
    writeFileSync(source, EXTENSION);
    seedExtension(source);
  });

  after(async () => {
    // Leaving it behind would block every later session on a dialog nobody expects.
    removeExtension();
    // And leaving the session behind orphans a container pair and its /24 when the harness kills the app.
    await stopAgentSession(browser);
  });

  it("starts a session, and the extension's dialogs reach the app", async () => {
    const id = await connectionId();
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
          .then(() => {
            const state = window.__cdCodingAgentStore.getState();
            done({ status: state.status, error: state.error, log: state.startLog });
          })
          .catch((error) => done({ status: "throw", error: String(error) }));
      },
      openRouterStartOptions({ connectionId: id, workspacePath: WORKSPACE, model: MODEL }),
    );
    assert.equal(started.status, "ready", `the session did not become ready: ${JSON.stringify(started)}`);

    // A prompt fires turn_start inside the container, which is where the probe extension calls ctx.ui.
    await browser.execute(() => {
      void window.__cdCodingAgentStore.getState().submit("Say hello.");
    });

    await $(".ExtensionDialog").waitForExist({
      timeout: 60000,
      timeoutMsg: "the extension's select dialog never reached the app",
    });
    await shot("/tmp/pi-live-select.png");
    const dialog = await browser.execute(() => ({
      title: document.querySelector(".ExtensionDialogTitle")?.textContent,
      options: [...document.querySelectorAll(".ExtensionDialogOption")].map((node) => node.textContent),
      statuses: window.__cdCodingAgentStore.getState().chrome.statuses,
      widgets: window.__cdCodingAgentStore.getState().chrome.widgets,
    }));
    assert.equal(dialog.title, "Pick one", `the dialog title did not survive the bridge: ${dialog.title}`);
    assert.deepEqual(dialog.options, ["alpha", "beta"], "the choices did not survive the bridge");
    assert.equal(dialog.statuses.probe, "running", `setStatus did not reach the app: ${JSON.stringify(dialog)}`);
    assert.deepEqual(dialog.widgets.probe?.lines, ["widget line one", "widget line two"], "setWidget did not arrive");

    // Answering must travel back: the container resolves ctx.ui.select and asks the next question.
    const options = await $$(".ExtensionDialogOption");
    await options[0].click();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelector(".ExtensionDialogTitle")?.textContent)) === "Confirm?",
      { timeout: 60000, timeoutMsg: "the confirm dialog never followed the select answer", interval: 500 },
    );
    const message = await browser.execute(() => document.querySelector(".ExtensionDialogMessage")?.textContent);
    assert.equal(message, "you picked alpha", `the answer did not reach the extension: ${message}`);
    await shot("/tmp/pi-live-confirm.png");

    const buttons = await $$(".ExtensionDialogActions button");
    await buttons[0].click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => window.__cdCodingAgentStore.getState().chrome.statuses.probe)) ===
        "answered alpha/true",
      { timeout: 60000, timeoutMsg: "the extension never saw both answers", interval: 500 },
    );
  });

  it("stops the session and tears the containers down", async () => {
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(() => done(window.__cdCodingAgentStore.getState().status))
        .catch((error) => done(String(error)));
    });
  });
});
