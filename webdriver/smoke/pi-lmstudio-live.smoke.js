// A REAL container pair on the TAURI shell, against a REAL model, with NO key and NO network: the local LM Studio
// server. Every other live spec needs OPENROUTER_API_KEY, so the one path nobody could run without a cloud account
// was the whole keyless half — the vault substituting an empty key, the gateway forwarding to a host-local server
// through the container's host alias, and the app's own window probe reading what that server actually loaded.
//
// Needs a NON-mock app (CONTAINER_DESKTOP_MOCK=), the agent image built for this version
// (`yarn cli agent-image --engine podman`), and a TOOL-CAPABLE model loaded with room for a session:
//
//   lms load qwen3-4b-instruct-2507 --context-length 16384 --yes
//   yarn test:smoke:tauri --spec webdriver/smoke/pi-lmstudio-live.smoke.js
//
// A model loaded at less than the session's own prompt cost cannot answer at all — pi's system prompt plus the tool
// definitions run to about 9k tokens — so this asserts the loaded length up front rather than blaming the app for a
// turn the server was never given room for.
//
// NOTHING OF THE USER'S IS TOUCHED: the only containers created are this session's own pair, and stopping the
// session removes them.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { configureLmStudioProvider, lmStudioStartOptions, loadedContextLength } from "../support/lmstudioSession.js";
import {
  agentImageReason,
  appModeReason,
  firstReason,
  loadedModelReason,
  skipSuite,
} from "../support/prerequisites.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? "/home/istoica/Workspace/is/container-desktop/temp/pi-lmstudio-ws";
const MODEL = process.env.CD_LIVE_LMSTUDIO_MODEL ?? "qwen3-4b-instruct-2507";
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
// The prompt this asks is deliberately trivial and tool-free: what is under test is the PAIR and the route to a
// local server, not a 4B model's judgement.
const TURN_TIMEOUT = 180000;
// Enough for the session's own prompt plus the room a model reserves for an answer.
const MIN_CONTEXT = 12000;

let program = "";
let started = {};
let sessionSpec = {};
let answer = {};

function engine(args) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Guarded against an empty name on purpose: `--filter name=` matches everything and `name=undefined` matches
// nothing, so an unnamed container would otherwise read as a confident answer either way.
function running(name) {
  assert.ok(name, "asked whether an unnamed container is running");
  try {
    return engine(["ps", "--filter", `name=${name}`, "--format", "{{.Names}}"]).length > 0;
  } catch {
    return false;
  }
}

describe("a real container pair on a local model", () => {
  before(async function () {
    // Nothing here is a defect when it is missing — a mock app, a server with no model, a model with no room. The
    // run is skipped with the fix in the message rather than failing for what this machine has not got.
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => loadedModelReason(MODEL, MIN_CONTEXT, 16384),
    ]);
    if (blocked) return skipSuite(this, blocked);
    mkdirSync(WORKSPACE, { recursive: true });
    writeFileSync(`${WORKSPACE}/README.md`, "A folder for a live assistant session.\n");

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // A CONNECTED engine, taken from the app's own port rather than the DOM — and the image only exists for the
    // engine it was built for, so the run follows the one that has it.
    let connections = [];
    async function runningConnections() {
      const found = await browser.executeAsync((done) => {
        window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
          (result) => done(result),
          (failure) => done({ ok: false, reason: String(failure) }),
        );
      });
      connections = found.ok ? found.value : [];
      return connections.filter((entry) => entry.running);
    }
    // An engine that never connects is this machine's state, not the app's fault, so it skips rather than fails.
    const connected = await browser
      .waitUntil(async () => (await runningConnections()).some((e) => e.engine === PREFERRED_ENGINE), {
        timeout: 45000,
        interval: 2000,
      })
      .then(
        () => true,
        () => false,
      );
    if (!connected) {
      return skipSuite(this, `no connected ${PREFERRED_ENGINE} — is its socket down?`);
    }
    const target = connections.filter((entry) => entry.running).find((entry) => entry.engine === PREFERRED_ENGINE);
    program = target.engine === "podman" ? "podman" : "docker";
    const missingImage = agentImageReason(program, AGENT_IMAGE);
    if (missingImage) return skipSuite(this, missingImage);

    configureLmStudioProvider(MODEL);
    started = await browser.executeAsync((options, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return {
          status: state.status,
          reason: state.error ?? "",
          log: state.startLog.join(" | "),
          // `spec`, NOT `lastStart`: the latter is the OPTIONS the caller passed, and the container names are
          // composed inside start(). Reading the wrong one leaves every name undefined, and a `running(undefined)`
          // check then passes by finding nothing.
          spec: state.spec ?? {},
          model: state.sessionModel ?? "",
        };
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
    sessionSpec = started.spec;

    // One turn, so the session reports its own context — which is the only way the window the app probed becomes
    // observable, and the only proof the gateway reached a server on this machine.
    await browser.execute(() => {
      void window.__cdCodingAgentStore.getState().submit("Reply with the single word: ok");
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase)) === "idle",
      { timeout: TURN_TIMEOUT, interval: 1000, timeoutMsg: "the local model never finished a turn" },
    );
    answer = await browser.execute(() => {
      const state = window.__cdCodingAgentStore.getState();
      return {
        said: state.view.timeline
          .filter((entry) => entry.kind === "message" && entry.role === "assistant")
          .map((entry) => `${entry.message ?? entry.content ?? ""}`.slice(0, 200)),
        notices: state.view.timeline.filter((entry) => entry.kind === "notice").map((entry) => entry.notice),
        window: state.view.context?.window ?? null,
        model: state.view.context?.model ?? "",
      };
    });
  });

  // A safety net only: the last test stops the session itself, because asserting the pair is gone has to happen
  // after that and a hook cannot be asserted on. Leaving a pair behind costs the next run an IPAM error.
  after(async () => {
    if (!sessionSpec.agentContainerName) return;
    if (!running(sessionSpec.agentContainerName)) return;
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

  it("starts both containers of the pair on the real engine", () => {
    assert.ok(sessionSpec.agentContainerName, `no agent container was named: ${JSON.stringify(sessionSpec)}`);
    assert.ok(running(sessionSpec.agentContainerName), `${sessionSpec.agentContainerName} is not running`);
    assert.ok(running(sessionSpec.gatewayContainerName), `${sessionSpec.gatewayContainerName} is not running`);
  });

  it("answers a turn through the gateway from a server on this machine", () => {
    assert.ok(answer.said.length > 0, `no assistant message arrived; notices: ${answer.notices.join(",")}`);
    assert.ok(
      answer.said.join(" ").trim().length > 0,
      `the turn produced an empty answer; notices: ${answer.notices.join(",")}`,
    );
  });

  // The panel's window is the session's OWN report, split into the room for input and the room reserved for an
  // answer — so the two added back together are the number the server said it loaded, and never pi's 128000.
  it("reports the window the local server loaded, not a fallback", async () => {
    const loaded = await loadedContextLength(MODEL);
    assert.equal(answer.window?.status, "known", `the session reported no window: ${JSON.stringify(answer.window)}`);
    assert.equal(answer.window.maxInputTokens + answer.window.reservedOutputTokens, loaded);
    assert.equal(answer.model, MODEL);
  });

  it("removes the pair when the session stops", async () => {
    const stopped = await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(
          () => done(""),
          (failure) => done(String(failure)),
        );
    });
    assert.equal(stopped, "", `stopping the session failed: ${stopped}`);
    await browser.waitUntil(async () => !running(sessionSpec.agentContainerName), {
      timeout: 60000,
      interval: 2000,
      timeoutMsg: `${sessionSpec.agentContainerName} outlived the session`,
    });
    assert.ok(!running(sessionSpec.gatewayContainerName), `${sessionSpec.gatewayContainerName} outlived the session`);
  });
});
