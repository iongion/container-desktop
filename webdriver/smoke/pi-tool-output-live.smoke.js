// Reading a truncated command's FULL output back out of a real container.
//
// pi's bash executor truncates a long result and writes the whole thing to `<tmpdir>/pi-bash-<id>.log` INSIDE the
// agent container, putting only the path in the tool result. The card cannot open that path — the app is not in that
// filesystem — so the read crosses the bridge. Unit tests cover the path check; nothing until now proved the file
// exists where pi says, that the host can open it, or that the text arrives.
//
// Needs a NON-mock app (CONTAINER_DESKTOP_MOCK=), a connected engine, the agent image built for this version
// (`yarn cli agent-image`), and an OpenAI-compatible server on CD_LIVE_PROVIDER_URL bound to the network with
// CD_LIVE_MODEL resident.
//
// HARNESS RULES:
//   • An `async` page function handed to browser.execute does NOT work — use executeAsync's `done`.
//   • Never return an object with a key named `error`: WebdriverIO reads it as a W3C error response and throws it.
//   • A zustand snapshot taken before an `await` is stale — re-read getState() after every one.
//   • ONE saveScreenshot per session; this spec takes none.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { appModeReason, firstReason, loadedModelReason, skipSuite } from "../support/prerequisites.js";

const USER_DATA =
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.join(USER_DATA, "workspace-fixture");
const MODEL = process.env.CD_LIVE_MODEL ?? "qwen3-4b-instruct-2507";
const PROVIDER_URL = process.env.CD_LIVE_PROVIDER_URL ?? "http://127.0.0.1:1234/v1";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";

// Long enough that pi has to truncate it, and with a checkable last line: the read returns the TAIL, so the final
// number proves the app received the end of the output rather than the part already on the card.
const LAST_LINE = "200000";
const ASK =
  "Use your bash tool to run exactly `seq 1 200000`. Call the tool once, then reply with just the last number.";

const TURN_TIMEOUT = 240000;
const START_TIMEOUT = 120000;
const HOOK_TIMEOUT = START_TIMEOUT + TURN_TIMEOUT + 60000;

let program = "";

function hasImage(reference) {
  try {
    execFileSync(program, ["image", "inspect", reference], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// The bash tool call as the transcript holds it, with the path pi put in its result. Nothing large travels back: the
// output itself is read separately and measured in the page.
function bashCall() {
  return browser.execute(() => {
    const timeline = window.__cdCodingAgentStore.getState().view.timeline;
    const call = timeline
      .filter((entry) => entry.kind === "tool" && entry.tool === "bash")
      .at(-1);
    const pending = timeline.find((entry) => entry.kind === "approval" && entry.status === "pending");
    return {
      found: !!call,
      status: call?.status ?? "",
      // What the card reads from — pi's own `details.fullOutputPath`, carried through the projection.
      fullOutputPath: call?.result?.fullOutputPath ?? "",
      pendingApprovalId: pending?.approvalId ?? "",
    };
  });
}

let call = {};
let read = {};
let refusal = {};

describe("a truncated tool output, read back from a real container", () => {
  before(async function startAndRun() {
    this.timeout(HOOK_TIMEOUT);
    const blocked = await firstReason([() => appModeReason("real"), () => loadedModelReason(MODEL, 12000, 16384)]);
    if (blocked) return skipSuite(this, blocked);
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    let connections = [];
    async function runningConnections() {
      const answer = await browser.executeAsync((done) => {
        window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
          (result) => done({ ok: result.ok === true, value: result.value ?? [], reason: String(result.error ?? "") }),
          (failure) => done({ ok: false, value: [], reason: String(failure) }),
        );
      });
      connections = answer.ok ? answer.value : [];
      return connections.filter((entry) => entry.running);
    }
    try {
      await browser.waitUntil(async () => (await runningConnections()).some((e) => e.engine === PREFERRED_ENGINE), {
        timeout: 45000,
        interval: 2000,
        timeoutMsg: `${PREFERRED_ENGINE} never came up`,
      });
    } catch {
      await browser.waitUntil(async () => (await runningConnections()).length > 0, {
        timeout: 30000,
        interval: 2000,
        timeoutMsg: "no engine connection ever came up — is the app in mock mode?",
      });
    }
    const running = connections.filter((entry) => entry.running);
    const target = running.find((entry) => entry.engine === PREFERRED_ENGINE) ?? running[0];
    program = target.engine === "podman" ? "podman" : "docker";
    console.log(`LIVE ENGINE ${target.engine} (${target.id}) via ${program}`);
    assert.ok(hasImage(AGENT_IMAGE), `${AGENT_IMAGE} is missing — build it: yarn cli agent-image --engine ${program}`);

    const started = await browser.executeAsync(
      (options, done) => {
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
      },
      {
        connectionId: target.id,
        workspacePath: WORKSPACE,
        modelId: MODEL,
        upstreamBaseUrl: PROVIDER_URL,
        upstreamAuth: { scheme: "none" },
        appVersion: APP_VERSION,
      },
    );
    assert.equal(started.status, "ready", `the session did not become ready: ${started.reason} [${started.log}]`);

    await browser.execute((text) => {
      void window.__cdCodingAgentStore.getState().submit(text);
    }, ASK);

    // bash is a gated tool, so the call waits on the user. Approved here because the command is this spec's own and
    // touches nothing: it writes to the container's temp dir and reads no workspace file.
    await browser.waitUntil(async () => (await bashCall()).pendingApprovalId !== "", {
      timeout: TURN_TIMEOUT,
      interval: 1000,
      timeoutMsg: "the model never reached the gated bash call",
    });
    const approvalId = (await bashCall()).pendingApprovalId;
    await browser.executeAsync(
      (id, done) => {
        window.__cdCodingAgentStore
          .getState()
          .resolveApproval(id, "allow")
          .then(() => done(true), () => done(false));
      },
      approvalId,
    );

    await browser.waitUntil(async () => (await bashCall()).status === "complete", {
      timeout: TURN_TIMEOUT,
      interval: 1000,
      timeoutMsg: "the bash call never completed",
    });
    call = await bashCall();
    console.log(`BASH CALL ${JSON.stringify(call)}`);

    // The read the card's "show full output" performs. Measured in the page: two megabytes of `seq` must not travel
    // back through WebDriver just to be asserted on.
    read = await browser.executeAsync(
      (path, needle, done) => {
        window.__cdCodingAgentStore
          .getState()
          .readToolOutput(path)
          .then(
            (answer) =>
              done({
                ok: true,
                chars: answer.text.length,
                truncated: answer.truncated === true,
                endsWithLast: answer.text.trimEnd().endsWith(needle),
                reason: "",
              }),
            (failure) => done({ ok: false, chars: 0, truncated: false, endsWithLast: false, reason: String(failure) }),
          );
      },
      call.fullOutputPath,
      LAST_LINE,
    );
    console.log(`READ ${JSON.stringify(read)}`);

    // The same read, aimed somewhere else. The path arrives inside a tool result, which a plugin can author, so the
    // container checks it rather than trusting it.
    refusal = await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .readToolOutput("/etc/passwd")
        .then(
          () => done({ refused: false, reason: "" }),
          (failure) => done({ refused: true, reason: String(failure) }),
        );
    });
  });

  after(async () => {
    await browser
      .executeAsync((done) => {
        window.__cdCodingAgentStore
          .getState()
          .stop()
          .then(() => done(true), () => done(false));
      })
      .catch(() => undefined);
  });

  it("puts the truncated output's path in the tool result", () => {
    assert.ok(call.found, "no bash call reached the transcript");
    assert.equal(call.status, "complete", `the bash call did not complete: ${JSON.stringify(call)}`);
    assert.match(
      call.fullOutputPath,
      /pi-bash-[A-Za-z0-9._-]+\.log$/,
      `pi did not report a truncated-output file, so the command's output fit: ${call.fullOutputPath}`,
    );
  });

  it("reads that file out of the container, over the bridge", () => {
    assert.equal(read.ok, true, `the read failed: ${read.reason}`);
    assert.ok(read.chars > 0, "the file came back empty");
  });

  it("answers with the END of the output, which is the part the card was missing", () => {
    assert.equal(read.endsWithLast, true, `the tail did not reach the app: ${read.chars} characters`);
  });

  it("refuses a path that is not one of pi's own output files", () => {
    assert.equal(refusal.refused, true, "a read outside pi's own output files must be refused");
    assert.match(refusal.reason, /not a pi tool-output file/);
  });
});
