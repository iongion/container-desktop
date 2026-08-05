// Real container, real pi, real extension: proves plugin-published DATA reaches the transcript as cards.
// The seeded extension calls pi.appendEntry and pi.sendMessage from `turn_start`, so a submitted prompt is
// enough — no tool call and no particular model reply are needed.
//
// Needs a NON-mock app (real podman) and OPENROUTER_API_KEY in the environment. Rebuild the agent image
// first (`yarn cli agent-image --engine podman`): the mapping under test runs INSIDE the container.
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
const EXTENSION_FILE = "data-probe.ts";

// appendEntry emits pi's `entry_appended` session event; sendMessage as a followUp enters the agent loop and
// comes back as a message_end with role "custom". Those are the two paths the host maps to card data.
//
// It fires ONCE. A followUp message starts another turn, so emitting on every `turn_start` is a
// self-perpetuating loop: measured, it produced entries and messages without end until the model errored,
// and the event flood alone is enough to stop the renderer answering WebDriver.
const EXTENSION = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let emitted = false;
  pi.on("turn_start", () => {
    if (emitted) return;
    emitted = true;
    pi.appendEntry("probe:card", { status: "done", counts: [1, 2, 3] });
    pi.sendMessage(
      { customType: "probe:msg", content: "from a plugin", display: true, details: { ok: true } },
      { deliverAs: "followUp" },
    );
  });
}
`;

// The plugin volume is a container volume, so seeding it means writing from inside a container. Root plus a
// chown, because the session mounts it as the image's `agent` user (1001).
function inPluginVolume(script, extraMounts = []) {
  execFileSync("podman", [
    "run",
    "--rm",
    "--user",
    "root",
    "--entrypoint",
    "sh",
    "--volume",
    `${PLUGIN_VOLUME}:/mnt`,
    ...extraMounts,
    IMAGE,
    "-c",
    script,
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

describe("plugin data against a real container", () => {
  before(async function () {
    // The seeding below creates a podman VOLUME, so it must not run on a machine that was never going to use it.
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => envReason("OPENROUTER_API_KEY", "a real model's turn is what makes the plugin emit its data"),
      () => agentImageReason("podman", IMAGE),
    ]);
    if (blocked) return skipSuite(this, blocked);
    mkdirSync(WORKSPACE, { recursive: true });
    const source = path.join(WORKSPACE, EXTENSION_FILE);
    writeFileSync(source, EXTENSION);
    try {
      execFileSync("podman", ["volume", "create", PLUGIN_VOLUME], { stdio: "ignore" });
    } catch {
      // Already there from an earlier session — the app reuses one plugin volume by name.
    }
    inPluginVolume(
      `mkdir -p /mnt/extensions && cp /seed/${EXTENSION_FILE} /mnt/extensions/${EXTENSION_FILE} && chown -R 1001:1001 /mnt`,
      ["--volume", `${source}:/seed/${EXTENSION_FILE}:ro`],
    );
  });

  after(async () => {
    // Leaving it behind would make every later session emit these cards.
    inPluginVolume(`rm -f /mnt/extensions/${EXTENSION_FILE}`);
    // And leaving the session behind orphans a container pair and its /24 when the harness kills the app.
    await stopAgentSession(browser);
  });

  it("renders a plugin's appended entry and custom message as data cards", async function () {
    // A cold session pulls nothing but does start two containers and wait on a free model, so the default
    // per-test budget is too tight to distinguish "slow" from "stuck".
    this.timeout(420000);
    const id = await connectionId();
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({ timeout: 45000 });

    // The key goes into the OS keychain and the provider into settings; `start` is then handed a provider ID and
    // no credential, which is the only route a real key takes now.
    await seedOpenRouterProvider(browser, { model: MODEL });
    // start() is fired and then WATCHED rather than awaited in one round-trip: if it stalls, the failure has
    // to say where — the status and the store's own start log — instead of just "Timeout".
    await browser.execute(
      (options) => {
        window.__cdStart = { state: "pending" };
        window.__cdCodingAgentStore
          .getState()
          .start(options)
          .then(() => {
            window.__cdStart = { state: "resolved" };
          })
          .catch((error) => {
            window.__cdStart = { state: "rejected", error: String(error) };
          });
      },
      openRouterStartOptions({ connectionId: id, workspacePath: WORKSPACE, model: MODEL }),
    );

    const progress = () =>
      browser.execute(() => {
        const state = window.__cdCodingAgentStore.getState();
        return { start: window.__cdStart, status: state.status, error: state.error, log: state.startLog };
      });
    await browser.waitUntil(async () => (await progress()).status === "ready", {
      timeout: 180000,
      interval: 1000,
      timeoutMsg: `the session never became ready: ${JSON.stringify(await progress())}`,
    });

    await browser.execute(() => {
      void window.__cdCodingAgentStore.getState().submit("Say hello and nothing else.");
    });

    // Both payloads travel as their own bridge events, so wait on the transcript rather than on the reply.
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const timeline = window.__cdCodingAgentStore.getState().view.timeline;
          const types = timeline.filter((item) => item.kind === "data").map((item) => item.customType);
          return types.includes("probe:card") && types.includes("probe:msg");
        }),
      {
        timeout: 120000,
        interval: 1000,
        timeoutMsg: `the plugin's data never reached the transcript: ${JSON.stringify(
          await browser.execute(() => ({
            phase: window.__cdCodingAgentStore.getState().view.phase,
            kinds: window.__cdCodingAgentStore.getState().view.timeline.map((item) => item.kind),
          })),
        )}`,
      },
    );

    const data = await browser.execute(() =>
      window.__cdCodingAgentStore
        .getState()
        .view.timeline.filter((item) => item.kind === "data")
        .map((item) => ({ customType: item.customType, data: item.data, text: item.text })),
    );
    const entry = data.find((item) => item.customType === "probe:card");
    const message = data.find((item) => item.customType === "probe:msg");
    assert.deepEqual(entry.data, { status: "done", counts: [1, 2, 3] }, "appendEntry's payload must survive intact");
    assert.equal(message.text, "from a plugin", "the custom message text must survive the bridge");
    assert.deepEqual(message.details ?? message.data, { ok: true }, "its details must survive too");

    // And they must be on screen, not merely in the store.
    const titles = await browser.execute(() =>
      [...document.querySelectorAll(".AICardTitle")].map((node) => node.textContent),
    );
    assert.ok(titles.includes("probe:card"), `no card for the appended entry: ${JSON.stringify(titles)}`);
    assert.ok(titles.includes("probe:msg"), `no card for the custom message: ${JSON.stringify(titles)}`);
    await browser.saveScreenshot("/tmp/pi-live-plugin-data.png");
  });
});
