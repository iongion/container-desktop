// Closes the one gap the theme unit left: that a plugin's OWN component, rendered inside a real container, paints in
// the app's colours. The unit test proves pi's `getMarkdownTheme()` resolves the installed theme; this proves the
// container installs it and that the ANSI frame reaching the renderer carries the app's accent.
//
// Keyless: the session runs on the LM Studio server on this machine, so no account and no network are needed.
//
//   lms load qwen3-4b-instruct-2507 --context-length 16384 --yes
//   yarn cli agent-image --engine podman
//   yarn test:smoke:tauri --spec webdriver/smoke/pi-plugin-theme-live.smoke.js
//
// NOTHING OF THE USER'S IS TOUCHED: one seeded extension, removed again, and the session's own container pair.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { configureLmStudioProvider, lmStudioStartOptions } from "../support/lmstudioSession.js";
import { appModeReason, firstReason, loadedModelReason, skipSuite } from "../support/prerequisites.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.resolve(import.meta.dirname, "../../temp/pi-theme-ws");
const MODEL = process.env.CD_LIVE_LMSTUDIO_MODEL ?? "qwen3-4b-instruct-2507";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
const PLUGIN_VOLUME = "cd-agent-plugins";
const TURN_TIMEOUT = 180000;

// The realistic plugin pattern, and the one that reads the module-global theme: pi's own Markdown REQUIRES a
// MarkdownTheme, and `getMarkdownTheme()` is how a plugin gets one — its closures resolve pi's theme proxy per call.
// A component handed the factory's own `theme` argument would prove nothing; that always carried the app's colours.
// A FOOTER, not `ctx.ui.custom`: custom takes a factory alone and awaits its `done`, so a turn that opened one and
// never resolved it would park. A footer is single-occupancy chrome that draws immediately and blocks nothing.
const EXTENSION = `import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";

export default function (pi: any) {
  pi.on("turn_start", async (_event: unknown, ctx: any) => {
    ctx.ui.setFooter(() => new Markdown("# Themed heading", 0, 0, getMarkdownTheme()));
  });
}
`;

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
    `${source}:/seed/theme-probe.ts:ro`,
    IMAGE,
    "-c",
    "mkdir -p /mnt/extensions && cp /seed/theme-probe.ts /mnt/extensions/theme-probe.ts && chown -R 1001:1001 /mnt",
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
    "rm -f /mnt/extensions/theme-probe.ts",
  ]);
}

// The accent the app is painted in RIGHT NOW — engine and light/dark decide it, so it is read from the page rather
// than assumed. Truecolor SGR is what pi's theme emits, so the frame must carry these three numbers.
function sgrOf(hex) {
  const value = hex.trim().replace("#", "");
  const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value;
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16));
  return `38;2;${r};${g};${b}`;
}

let frames = [];
let accent = "";

describe("a plugin's own component in a real container", () => {
  before(async function () {
    const blocked = await firstReason([() => appModeReason("real"), () => loadedModelReason(MODEL, 12000, 16384)]);
    if (blocked) return skipSuite(this, blocked);
    mkdirSync(WORKSPACE, { recursive: true });
    writeFileSync(path.join(WORKSPACE, "README.md"), "live workspace for the plugin theme probe\n");
    const source = path.join(WORKSPACE, "theme-probe.ts");
    writeFileSync(source, EXTENSION);
    seedExtension(source);

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({ timeout: 45000, timeoutMsg: "the Assistant never mounted" });

    accent = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--app-accent").trim(),
    );
    assert.ok(accent.startsWith("#"), `the app's accent is not a hex the frame could carry: ${accent}`);

    // The app brings its engines up while it boots and they do not finish together, so this waits rather than
    // judging the first snapshot — a single immediate read fails at three seconds against a healthy podman.
    let target;
    await browser.waitUntil(
      async () => {
        target = await browser.executeAsync((done) => {
          window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
            (result) =>
              done((result.ok ? result.value : []).find((entry) => entry.running && entry.engine === "podman")),
            () => done(undefined),
          );
        });
        return Boolean(target);
      },
      { timeout: 45000, interval: 2000, timeoutMsg: "no running podman connection — is the app in mock mode?" },
    );

    configureLmStudioProvider(MODEL);
    const started = await browser.executeAsync((options, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return { status: state.status, reason: state.error ?? "", log: state.startLog.join(" | ") };
      };
      window.__cdCodingAgentStore
        .getState()
        .start(options)
        .then(
          () => done(read()),
          (failure) => done({ ...read(), reason: String(failure) }),
        );
    }, lmStudioStartOptions({ connectionId: target.id, workspacePath: WORKSPACE, model: MODEL, appVersion: APP_VERSION }));
    assert.equal(started.status, "ready", `the session did not become ready: ${started.reason} [${started.log}]`);

    // The extension renders on `turn_start`, so a submitted prompt is what makes it draw.
    await browser.execute(() => {
      void window.__cdCodingAgentStore.getState().submit("Reply with the single word: ok");
    });
    await browser.waitUntil(
      async () => {
        frames = await browser.execute(() =>
          Object.values(window.__cdCodingAgentStore.getState().surfaces ?? {})
            .map((surface) => (Array.isArray(surface.lines) ? surface.lines.join("\n") : ""))
            .filter(Boolean),
        );
        return frames.some((frame) => frame.includes("Themed heading"));
      },
      { timeout: TURN_TIMEOUT, interval: 1500, timeoutMsg: "the plugin's component never reached the renderer" },
    );
  });

  after(async () => {
    removeExtension();
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    });
  });

  it("paints an un-themed plugin component in the app's own accent", () => {
    const heading = frames.find((frame) => frame.includes("Themed heading"));
    assert.ok(
      heading.includes(sgrOf(accent)),
      `the frame does not carry the app's accent ${accent} (${sgrOf(accent)}): ${JSON.stringify(heading.slice(0, 300))}`,
    );
  });
});
