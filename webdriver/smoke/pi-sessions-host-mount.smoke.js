// The ONE claim of mounting the conversations from this machine: after a real pair has answered a real turn, the
// conversation is a file on the HOST — and it is still there, and still readable, once the pair is gone. Before this,
// pi defaulted its session directory under the agent dir, which IS the `cd-agent-plugins` volume, so a user's history
// lived and died with a container they did not think they were storing it in.
//
// Real app, real engine, real model, no key, no network: the LM Studio server on this machine.
//
//   yarn test:smoke:tauri --spec webdriver/smoke/pi-sessions-host-mount.smoke.js
//
// NOTHING OF THE USER'S IS TOUCHED: the only containers created are this session's own pair, and the last test stops
// them. The conversations directory it inspects is the harness's own user-data dir, not the installed app's.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { configureLmStudioProvider, lmStudioStartOptions, loadedModel } from "../support/lmstudioSession.js";
import { agentImageReason, appModeReason, firstReason, skipSuite } from "../support/prerequisites.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.join(process.cwd(), "temp", "pi-sessions-ws");
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
// The same directory the host resolves and creates — a SIBLING of the protected `agent/` one, which every
// web-view-reachable read of that one is refused, because the app's own secrets live in it.
const USER_DATA = process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
const SESSIONS_DIR = path.join(USER_DATA, "assistant-sessions");
// pi's own prompt plus the tool definitions run to about 9k tokens, so a model loaded under this cannot answer at all.
const MIN_CONTEXT = 12000;
const TURN_TIMEOUT = 240000;

let program = "";
let sessionSpec = {};
let started = {};
let conversations = [];

function engine(args) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function running(name) {
  assert.ok(name, "asked whether an unnamed container is running");
  try {
    return engine(["ps", "--filter", `name=${name}`, "--format", "{{.Names}}"]).length > 0;
  } catch {
    return false;
  }
}

// Every conversation file in the host directory, newest first. pi names them `<timestamp>_<id>.jsonl` and writes the
// first line as the session header, which is where the `cwd` that separates workspaces is recorded.
function hostConversations() {
  if (!existsSync(SESSIONS_DIR)) return [];
  return readdirSync(SESSIONS_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.join(SESSIONS_DIR, name))
    .map((file) => ({ file, modified: statSync(file).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
}

function headerOf(file) {
  const [first] = readFileSync(file, "utf8").split("\n");
  return JSON.parse(first);
}

describe("a real session keeps its conversation on this machine", () => {
  before(async function () {
    // A mock app, no server, nothing loaded: this machine's state, not a defect. Skipped with the fix in the message.
    const blocked = await firstReason([() => appModeReason("real")]);
    if (blocked) return skipSuite(this, blocked);
    const model = await loadedModel();
    if (!model) {
      return skipSuite(this, "LM Studio has nothing loaded — `lms server start` then `lms load <model> --yes`");
    }
    if (model.contextLength < MIN_CONTEXT) {
      return skipSuite(
        this,
        `${model.id} is loaded at ${model.contextLength}, under the ${MIN_CONTEXT} a session's own prompt needs`,
      );
    }
    mkdirSync(WORKSPACE, { recursive: true });
    writeFileSync(path.join(WORKSPACE, "README.md"), "A folder for a live assistant session.\n");

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // A CONNECTED engine, from the app's own port rather than the DOM, and the image exists only for the engine it
    // was built for.
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
    const connected = await browser
      .waitUntil(async () => (await runningConnections()).some((e) => e.engine === PREFERRED_ENGINE), {
        timeout: 45000,
        interval: 2000,
      })
      .then(
        () => true,
        () => false,
      );
    if (!connected) return skipSuite(this, `no connected ${PREFERRED_ENGINE} — is its socket down?`);
    const target = connections.filter((entry) => entry.running).find((entry) => entry.engine === PREFERRED_ENGINE);
    program = target.engine === "podman" ? "podman" : "docker";
    const missingImage = agentImageReason(program, AGENT_IMAGE);
    if (missingImage) return skipSuite(this, missingImage);

    configureLmStudioProvider(model.id);
    started = await browser.executeAsync((options, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return {
          status: state.status,
          reason: state.error ?? "",
          log: state.startLog.join(" | "),
          spec: state.spec ?? {},
        };
      };
      window.__cdCodingAgentStore
        .getState()
        .start(options)
        .then(
          () => done(read()),
          (failure) => done({ ...read(), reason: String(failure) }),
        );
    }, lmStudioStartOptions({ connectionId: target.id, workspacePath: WORKSPACE, model: model.id, appVersion: APP_VERSION }));
    assert.equal(started.status, "ready", `the session did not become ready: ${started.reason} [${started.log}]`);
    sessionSpec = started.spec;

    // One turn, because pi writes the conversation out when the first ASSISTANT message lands — before that there is
    // nothing on disk to find, in the volume or anywhere else.
    await browser.execute(() => {
      void window.__cdCodingAgentStore.getState().submit("Reply with the single word: ok");
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase)) === "idle",
      { timeout: TURN_TIMEOUT, interval: 1000, timeoutMsg: "the local model never finished a turn" },
    );
    conversations = hostConversations();
  });

  // A safety net only: the last test stops the session itself, because what it asserts happens after the stop. A pair
  // left behind costs the next run an IPAM error.
  after(async () => {
    if (!sessionSpec.agentContainerName || !running(sessionSpec.agentContainerName)) return;
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

  it("mounts a directory the HOST created, not one the engine had to make", () => {
    assert.equal(sessionSpec.sessionsPath, SESSIONS_DIR, `the session mounted ${sessionSpec.sessionsPath}`);
    assert.ok(existsSync(SESSIONS_DIR), `${SESSIONS_DIR} does not exist`);
    // Owned by the user, which is what a directory the ENGINE created on a missing bind-mount source would not be —
    // that one belongs to root, and pi meets it as EACCES on the first turn.
    assert.equal(statSync(SESSIONS_DIR).uid, process.getuid(), `${SESSIONS_DIR} is not owned by this user`);
  });

  it("writes the conversation onto this machine, under the workspace it was started for", () => {
    assert.ok(conversations.length > 0, `no conversation file appeared in ${SESSIONS_DIR}`);
    const header = headerOf(conversations[0].file);
    assert.equal(header.type, "session");
    // The header's cwd is how pi keeps workspaces apart in one directory — the path is not what separates them.
    assert.equal(header.cwd, "/workspace");
  });

  it("keeps the conversation readable once the pair is gone — which is the whole point", async () => {
    const before = conversations[0].file;
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    });
    assert.equal(running(sessionSpec.agentContainerName), false, "the agent container is still running");

    // The file the session wrote, read with nothing running: no container, no engine call, no bridge.
    assert.ok(existsSync(before), `${before} went with the containers`);
    const entries = readFileSync(before, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(
      entries.some((entry) => entry.type === "message" && entry.message?.role === "assistant"),
      "the conversation has no assistant message in it",
    );
  });
});
