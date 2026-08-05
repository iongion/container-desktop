// Closes the gap Phase 7 left open: a REAL model, handed the container toolset, chooses a container tool; the app
// performs it against the REAL engine and the answer reaches the model. Everything the fixture spec
// (pi-container-tools.e2e.js) stubs is real here — the container, the bridge, the model, the engine.
//
// Needs a NON-mock app (CONTAINER_DESKTOP_MOCK=), OPENROUTER_API_KEY, and the agent image built for this version
// (`yarn cli agent-image --engine podman`).
//
// NOTHING OF THE USER'S IS TOUCHED. The destructive half acts on a throwaway container this spec creates and
// removes. Every other mutation the model might reach for is gated and never approved here.
//
// HARNESS RULES, each of which cost a run in Phase 7:
//   • An `async` page function handed to browser.execute does NOT work — WebKitWebDriver cannot serialize the
//     promise, so the step looks like it passed and its rejection is reported against whichever command runs NEXT.
//     Start the work from a synchronous page function and poll, or use executeAsync's `done`.
//   • Never return an object with a key named `error`: WebdriverIO reads it as a W3C error response and throws it,
//     so the value surfaces as a spec failure pointing at an innocent line.
//   • ONE saveScreenshot per session — a command after a second one hangs and takes the session with it.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { openRouterStartOptions, seedOpenRouterProvider } from "../support/openrouterSession.js";
import { agentImageReason, appModeReason, envReason, firstReason, skipSuite } from "../support/prerequisites.js";

const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? "/home/istoica/Workspace/is/container-desktop/temp/pi-live-workspace";
const MODEL = process.env.CD_LIVE_MODEL ?? "inclusionai/ling-3.0-flash:free";
// Which engine to prefer if several are connected. The toolset is engine-neutral, so the run follows whatever the
// app actually has running rather than insisting on one — an engine whose API socket is down is not a failure here.
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
// Unqualified on purpose: this is the tag `agentImageTag` builds, and each engine shows it its own way — podman
// prefixes local images with `localhost/`, docker leaves them bare. Both resolve the short name.
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
// The throwaway. Named, not random, so a failed run leaves one recognisable container behind instead of a litter.
const VICTIM = process.env.CD_LIVE_VICTIM ?? "cd-live-victim";
const VICTIM_IMAGE = process.env.CD_LIVE_VICTIM_IMAGE ?? "docker.io/library/alpine:3";
// The CLI for the connection the app turns out to be running, set once that is known. The spec's own fixtures go
// through it, so what the model removes is a container this file can independently see.
let program = "";

// Both prompts forbid a connectionId: this box has more than one engine connected, and the app filling in the
// session's own connection is the behaviour under test. A model that names one instead would silently move the
// assertions to another engine.
const READ_PROMPT =
  "List the containers on my container engine, then reply with the container NAMES you saw, one per line. " +
  "Use your listContainers tool with no arguments at all — do not pass connectionId, and do not guess.";
// Identified by NAME, which removeContainer's own prose offers ("by id or name"). Demanding the id made the run
// depend on a small model transcribing 64 hex characters: one dropped the final character, the engine answered 404,
// and the app was blamed for relaying it. The connectionId is still withheld — the app filling in the session's own
// is the behaviour under test.
const REMOVE_PROMPT =
  `Remove the container named ${VICTIM}. Call your removeContainer tool exactly once, passing that exact name as ` +
  "the id — no connectionId. Do not stop it first, do not use bash, and do not touch any other container.";

// The model decides when to call a tool, so every wait on its behalf is generous.
const TURN_TIMEOUT = 150000;

function engine(args) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Existence via `ps -a`, NOT `container inspect` (and never podman's `container exists`, which docker does not
// have): inspect exits non-zero both when the container is absent AND when the engine call itself fails, so a
// hiccup reads as "the container is gone" — which here would be reported as the permission gate leaking a rejected
// removal. `ps -a` exits 0 either way, so an empty answer means absent and a throw means the engine failed.
function victimListing() {
  return engine(["ps", "-a", "--filter", `name=${VICTIM}`, "--format", "{{.Names}} {{.Status}}"]);
}

function victimExists() {
  return victimListing()
    .split("\n")
    .some((line) => line.trim().startsWith(VICTIM));
}

function removeVictim() {
  try {
    engine(["rm", "-f", VICTIM]);
  } catch {
    // Absent already, which is the state this wants.
  }
}

// Every identity the model could legitimately name the throwaway by — its name, its full id, its short id. The tool's
// own prose offers all three.
let victimIdentities = [];

// Compared as a WHOLE VALUE, never as a substring: a model that drops one character while copying a 64-character id
// still produces text CONTAINING the short id, so substring matching approved a removal aimed at nothing and the
// engine answered 404. Exact equality is the only check that tells the throwaway apart from a mis-copy of it.
function cardNamesVictim(card) {
  let named;
  try {
    named = JSON.parse(card.args || "{}").id;
  } catch {
    return false;
  }
  return typeof named === "string" && victimIdentities.includes(named);
}

// A container read answers with the engine's own JSON for every container on it, which runs to tens of kilobytes.
// So the MATCHING happens in the page, against the whole string, and only a short excerpt travels back: asserting
// on a truncated copy is how a spec reports "the container is missing" about a container that is plainly there.
function state() {
  return browser.execute((needles) => {
    const view = window.__cdCodingAgentStore.getState().view;
    return {
      phase: view.phase,
      // Which operations the app is still holding: a card the user answered must leave nothing behind, and a
      // removal that reached the engine while its card was pending would show up as an empty hold here.
      held: Object.keys(window.__cdCodingAgentStore.getState().pendingEngineOps),
      timeline: view.timeline.map((entry) => {
        const full = `${entry.message ?? entry.content ?? ""}`;
        return {
          kind: entry.kind,
          tool: entry.tool ?? "",
          status: entry.status ?? "",
          ok: entry.ok === true,
          approvalId: entry.approvalId ?? "",
          reason: entry.reason ?? "",
          args: entry.args ? JSON.stringify(entry.args) : "",
          hits: needles.filter((needle) => full.includes(needle)),
          // What the card renders from: the tool's structured result, not its text.
          resultCount: Array.isArray(entry.result) ? entry.result.length : -1,
          // NOT `error`: a returned key by that name is thrown as a WebDriver error.
          text: full.slice(0, 400),
        };
      }),
    };
  }, victimIdentities);
}

async function settle(reason) {
  await browser.waitUntil(
    async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase)) === "idle",
    { timeout: TURN_TIMEOUT, interval: 1000, timeoutMsg: reason },
  );
}

async function ask(text) {
  await browser.execute((prompt) => {
    void window.__cdCodingAgentStore.getState().submit(prompt);
  }, text);
}

// The one pending card, or null. An action identity (tool + args) travels with it so a second ask about the SAME
// action can be told apart from a legitimate second action.
async function pendingApproval() {
  const items = (await state()).timeline.filter((entry) => entry.kind === "approval" && entry.status === "pending");
  return items.length ? { ...items[items.length - 1], pending: items.length } : null;
}

async function waitForApproval(reason) {
  await browser.waitUntil(async () => (await pendingApproval()) !== null, {
    timeout: TURN_TIMEOUT,
    interval: 1000,
    timeoutMsg: reason,
  });
  return pendingApproval();
}

function toolCalls(snapshot, name, from = 0) {
  return snapshot.timeline.slice(from).filter((entry) => entry.kind === "tool" && entry.tool === name);
}

// Cards for one action WITHIN one turn. The window matters: asking the same removal twice is the defect, and both
// turns below ask about the same container, so counting over the whole transcript would report the rejected turn's
// card as a second ask about the approved one.
function approvalsFor(snapshot, action, from = 0) {
  return snapshot.timeline
    .slice(from)
    .filter((entry) => entry.kind === "approval" && `${entry.tool}${entry.args}` === action);
}

// What the run learned, printed on the way through: a live transcript is the only record of why a model did what
// it did, and reconstructing it from an assertion message costs another two minutes of model time.
function report(label, snapshot) {
  console.log(
    `${label} phase=${snapshot.phase} held=${JSON.stringify(snapshot.held ?? [])} ${JSON.stringify(
      snapshot.timeline.map((entry) => ({
        kind: entry.kind,
        tool: entry.tool || undefined,
        status: entry.status || undefined,
        args: entry.args || undefined,
        reason: entry.reason || undefined,
        text: entry.text ? entry.text.slice(0, 240) : undefined,
      })),
      null,
      2,
    )}`,
  );
}

let sessionConnectionId = "";
let defaultRouting = {};
let readSnapshot = { timeline: [] };
let cards = [];
let rejectedCard = null;
let approvedCard = null;

describe("the container toolset against a real model", () => {
  // The whole setup lives in `before` on purpose: a session that never starts must abort the suite, not leave every
  // turn to burn its own 150s waiting for a model that was never asked — which holds port 4444 for minutes and
  // makes the NEXT run fail with "Maximum number of active sessions".
  before(async function () {
    // A mock app and a machine with no cloud account are absences, not defects — the suite says which and skips.
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => envReason("OPENROUTER_API_KEY", "this drives a real model, and there is nothing to fall back to"),
    ]);
    if (blocked) return skipSuite(this, blocked);

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // The connection comes from the app's OWN engine port rather than the DOM: an operation needs a CONNECTED
    // engine, and `running` is the only thing that says so. The app brings engines up while it boots, and they do
    // not finish together — so the preferred one gets its own window before any running engine will do. Judging the
    // first snapshot would hand the run to whichever socket happened to answer first.
    let connections = [];
    async function runningConnections() {
      const answer = await browser.executeAsync((done) => {
        window.AI.runEngineOp({ op: "listConnections", args: {} }).then(
          (result) => done(result),
          (failure) => done({ ok: false, reason: String(failure) }),
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
      // Not a failure: the toolset is engine-neutral, so the run follows whatever this box has connected.
      await browser
        .waitUntil(async () => (await runningConnections()).length > 0, { timeout: 30000, interval: 2000 })
        .catch(() => undefined);
    }
    const running = connections.filter((entry) => entry.running);
    if (running.length === 0) {
      return skipSuite(this, "no engine connection ever came up — is any engine API listening?");
    }
    const target = running.find((entry) => entry.engine === PREFERRED_ENGINE) ?? running[0];
    program = target.engine === "podman" ? "podman" : "docker";
    console.log(`LIVE ENGINE ${target.engine} (${target.id}) via ${program}`);
    const missingImage = agentImageReason(program, AGENT_IMAGE);
    if (missingImage) return skipSuite(this, missingImage);

    // A running container, so the read shows real state and the removal is a real destructive act. Created on the
    // engine the session will use, not the one this box happens to prefer.
    removeVictim();
    const victimId = engine(["run", "-d", "--name", VICTIM, VICTIM_IMAGE, "sleep", "900"]);
    assert.ok(victimExists(), "the throwaway container was not created");
    victimIdentities = [VICTIM, victimId, victimId.slice(0, 12)];

    // The start log and the store's own error come back with the status: a session that fails says why in there
    // (a host-port collision, a missing image, an unreachable engine), and a bare "error" sends the next reader
    // digging through `docker inspect` for a reason the app already knew.
    // The key goes into the OS keychain and the provider into settings; `start` is then handed a provider ID and
    // no credential, which is the only route a real key takes now.
    await seedOpenRouterProvider(browser, { model: MODEL });
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
      openRouterStartOptions({ connectionId: target.id, workspacePath: WORKSPACE, model: MODEL, appVersion: APP_VERSION }),
    );
    assert.equal(
      started.status,
      "ready",
      `the session did not become ready: ${started.reason} [${started.log}]`,
    );
    sessionConnectionId = target.id;

    // Where a container operation lands when the agent names no connection — asserted without a model, because
    // this box has two engines connected and only the app decides which one an unqualified read reaches.
    defaultRouting = await browser.executeAsync(
      (connectionId, needle, done) => {
        window.AI.runEngineOp({ op: "listContainers", args: {}, defaultConnectionId: connectionId }).then(
          (result) =>
            done({
              ok: result.ok === true,
              // Matched HERE, against the whole answer, for the reason `state()` gives below: an engine holding a
              // few dozen containers answers with tens of kilobytes, and asserting on a truncated copy is how a
              // spec reports "the container is missing" about a container that is plainly there. Only the verdict,
              // the count and a short excerpt travel back.
              found: JSON.stringify(result.value ?? "").includes(needle),
              count: Array.isArray(result.value) ? result.value.length : -1,
              text: JSON.stringify(result.value ?? result.error ?? "").slice(0, 400),
            }),
          (failure) => done({ ok: false, found: false, count: -1, text: String(failure) }),
        );
      },
      sessionConnectionId,
      VICTIM,
    );
  });

  after(() => {
    if (program) removeVictim();
  });

  it("sends an unqualified container read to the session's own connection", () => {
    assert.equal(defaultRouting.ok, true, `the read failed: ${defaultRouting.text}`);
    assert.equal(
      defaultRouting.found,
      true,
      `an unqualified read did not reach ${sessionConnectionId}: ${defaultRouting.count} containers, e.g. ${defaultRouting.text}`,
    );
  });

  it("lets the model read the real container list, unattended", async () => {
    await ask(READ_PROMPT);
    await browser.waitUntil(
      async () => toolCalls(await state(), "listContainers").some((entry) => entry.status !== "running"),
      {
        timeout: TURN_TIMEOUT,
        interval: 1000,
        timeoutMsg: "the model never called listContainers",
      },
    );
    await settle("the reading turn never finished");
    readSnapshot = await state();
    report("READ TIMELINE", readSnapshot);

    const [call] = toolCalls(readSnapshot, "listContainers");
    assert.ok(call, "no listContainers call reached the transcript");
    assert.ok(
      !call.args.includes("connectionId"),
      `the model named a connection, so this run no longer tests the app's default: ${call.args}`,
    );
    assert.equal(call.status, "complete", `the call did not complete: ${JSON.stringify(call)}`);
    assert.equal(call.ok, true, `the call failed: ${call.text}`);
    // A read is ungated at BOTH boundaries — pi's tool_call gate and the engine operation itself.
    assert.deepEqual(
      readSnapshot.timeline.filter((entry) => entry.kind === "approval"),
      [],
      "a container READ must never ask the user",
    );
  });

  it("answers it with what the engine actually holds", () => {
    const [call] = toolCalls(readSnapshot, "listContainers");
    assert.ok(
      call.hits.includes(VICTIM),
      `the engine's own container is missing from the result: ${call.text}`,
    );
    // The model repeating it is what proves the answer travelled back INTO the turn, not just into the transcript.
    const answered = readSnapshot.timeline.filter((entry) => entry.kind === "message" && entry.hits.includes(VICTIM));
    assert.ok(
      answered.length > 0,
      `the model never reported the container the engine told it about: ${JSON.stringify(
        readSnapshot.timeline.filter((entry) => entry.kind === "message").map((entry) => entry.text),
      )}`,
    );
  });

  it("renders that result as the real container card", async () => {
    await $(".AICard").waitForExist({ timeout: 20000, timeoutMsg: "no tool card rendered" });
    // Cards open collapsed and Blueprint's Collapse UNMOUNTS a closed body, so only the closed ones may be
    // clicked: clicking every head toggles an already-open card shut and the assertion then reads a card with no
    // body at all — which looks exactly like a card that failed to render its data.
    await browser.execute(() => {
      for (const head of document.querySelectorAll(".AICardHead")) {
        if (head.getAttribute("aria-expanded") !== "true") head.click();
      }
    });
    await browser.pause(600);
    cards = await browser.execute(
      (needle) =>
        Array.from(document.querySelectorAll(".AICard")).map((element) => ({
          title: element.querySelector(".AICardTitle")?.textContent ?? "",
          open: element.querySelector(".AICardHead")?.getAttribute("aria-expanded") === "true",
          rows: element.querySelectorAll(".AICardTable tbody tr").length,
          empty: element.querySelector(".AICardEmpty") !== null,
          json: element.querySelector(".AICardJson") !== null,
          // Matched in the page for the same reason the read is: the table renders every container on the engine,
          // so the throwaway's row sits well past any excerpt short enough to travel back.
          names: (element.textContent ?? "").includes(needle),
          text: (element.textContent ?? "").slice(0, 600),
        })),
      VICTIM,
    );
    console.log(`CARDS ${JSON.stringify(cards, null, 2)}`);
    // The listContainers result reached the transcript as data, not just as text the model can read.
    const [call] = toolCalls(readSnapshot, "listContainers");
    assert.ok(call.resultCount > 0, `the card had no rows to render: result was ${call.resultCount} entries`);

    const card = cards.find((entry) => entry.rows > 0);
    assert.ok(card, `no card rendered the container table, got ${JSON.stringify(cards.map((e) => e.title))}`);
    assert.equal(card.json, false, "a real container result fell back to the generic JSON card");
    assert.ok(card.names, `the table did not name the container: ${card.text}`);
  });

  it("asks before a model-chosen removal, and refuses it without touching the engine", async () => {
    await settle("the session never settled before the removal turn");
    const turn = (await state()).timeline.length;
    await ask(REMOVE_PROMPT);
    rejectedCard = await waitForApproval("the model never reached a gated container mutation");

    assert.equal(rejectedCard.tool, "removeContainer", `the model chose ${rejectedCard.tool} instead`);
    assert.ok(
      cardNamesVictim(rejectedCard),
      `the card did not name the throwaway container: ${rejectedCard.reason} ${rejectedCard.args}`,
    );
    // The model named no connection, so the card has to say where the app would perform it: this box has two
    // engines connected, and an id alone does not tell the user which one is about to lose a container.
    assert.ok(
      rejectedCard.reason.includes(sessionConnectionId),
      `the card did not name the engine it would act on: ${rejectedCard.reason}`,
    );
    assert.equal(rejectedCard.pending, 1, "one action must raise one card");

    const buttons = await $$(".AssistantApprovalActions button");
    await buttons[1].click();

    await settle("the agent never stopped after the rejection");
    const snapshot = await state();
    report("REJECTION TIMELINE", snapshot);
    assert.ok(
      victimExists(),
      `a REJECTED removal reached the engine — the gate does not hold. The engine now lists: "${victimListing()}"`,
    );
    const card = snapshot.timeline.find((entry) => entry.approvalId === rejectedCard.approvalId);
    assert.equal(card.status, "rejected", "the card did not record the rejection");
    assert.equal(
      approvalsFor(snapshot, `${rejectedCard.tool}${rejectedCard.args}`, turn).length,
      1,
      "the user was asked more than once about a single action",
    );
  });

  it("performs the removal on the real engine once the user approves", async () => {
    await settle("the rejected turn never settled");
    const turn = (await state()).timeline.length;
    await ask(REMOVE_PROMPT);
    approvedCard = await waitForApproval("the second removal turn never reached the gate");
    assert.equal(approvedCard.tool, "removeContainer", `the model chose ${approvedCard.tool} instead`);
    // Checked BEFORE the click, never after: this engine holds the user's own containers, and the one thing this
    // spec may approve is the container it created itself.
    assert.ok(
      cardNamesVictim(approvedCard),
      `refusing to approve a removal aimed elsewhere: ${approvedCard.reason} ${approvedCard.args}`,
    );
    assert.equal(approvedCard.pending, 1, "one action must raise one card");
    const action = `${approvedCard.tool}${approvedCard.args}`;

    const buttons = await $$(".AssistantApprovalActions button");
    await buttons[0].click();

    // Either the container is gone, or the app asked more than once for a single call — the defect this turn exists
    // to catch: pi's pre-call gate and the engine operation must not both ask. The invariant is ONE CARD PER CALL,
    // not one card per turn: a model is free to call removeContainer twice, and that legitimately raises two cards.
    let snapshot = await state();
    try {
      await browser.waitUntil(
        async () => {
          snapshot = await state();
          const cards = approvalsFor(snapshot, action, turn).length;
          const calls = toolCalls(snapshot, "removeContainer", turn).length;
          assert.ok(
            cards <= calls,
            `the app asked ${cards} times for ${calls} removeContainer call(s): both boundaries gated one call`,
          );
          return !victimExists();
        },
        {
          timeout: TURN_TIMEOUT,
          interval: 1000,
          timeoutMsg: "the approved removal never reached the engine",
        },
      );
    } finally {
      // Printed even when the wait fails: without it a failure here leaves no record of what the model did.
      report("REMOVAL TIMELINE", snapshot);
    }
    if (process.env.PI_CONTAINER_LIVE_SHOT) await browser.saveScreenshot(process.env.PI_CONTAINER_LIVE_SHOT);
    assert.equal(victimExists(), false, "the container survived an approved removal");
    assert.ok(
      approvalsFor(snapshot, action, turn).length <= toolCalls(snapshot, "removeContainer", turn).length,
      "the approved removal left more cards than calls",
    );
    const card = snapshot.timeline.find((entry) => entry.approvalId === approvedCard.approvalId);
    assert.equal(card.status, "allowed", "the approved card did not record the decision");
    const calls = toolCalls(snapshot, "removeContainer", turn);
    const call = calls.find((entry) => entry.status === "complete");
    assert.ok(call, `the tool result never came back: ${JSON.stringify(calls)}`);
    assert.equal(call.ok, true, `the removal reported a failure to the model: ${call.text}`);
  });

  it("stops the session", async () => {
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .stop()
        .then(() => done(window.__cdCodingAgentStore.getState().status))
        .catch((failure) => done(String(failure)));
    });
  });
});
