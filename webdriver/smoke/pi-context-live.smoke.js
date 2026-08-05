// The three surfaces the fixture specs can only stub, driven against a REAL model in a REAL container pair: the
// project's memories reaching the model, what the session reports about its own cost and context, and pi's own
// /compact actually summarising a conversation.
//
// assistant-soundness.e2e.js proves the RENDERER composes and publishes all of this — its far end is scripted, so it
// cannot tell whether pi honoured any of it. Everything asserted here is the container's own answer:
//   • the app's prose survives pi's `before_agent_start` chaining and reaches the model, which quotes it back
//   • getSessionStats / getContextUsage / getActiveToolNames report real numbers for a real turn
//   • session.compact() returns a real summary of a real conversation
//
// Needs a NON-mock app (CONTAINER_DESKTOP_MOCK=), a connected engine, the agent image built for this version
// (`yarn cli agent-image`), and an OpenAI-compatible server on CD_LIVE_PROVIDER_URL bound to the network
// (`lms server start --cors --bind 0.0.0.0`) with CD_LIVE_MODEL already resident — 127.0.0.1 inside the agent
// container is the container, not this machine.
//
// HARNESS RULES, each of which cost a run before:
//   • An `async` page function handed to browser.execute does NOT work — WebKitWebDriver cannot serialize the
//     promise, so the step looks like it passed and its rejection is reported against whichever command runs NEXT.
//     Start the work from a synchronous page function and poll, or use executeAsync's `done`.
//   • Never return an object with a key named `error`: WebdriverIO reads it as a W3C error response and throws it.
//   • A zustand snapshot taken before an `await` is stale — re-read getState() after every one.
//   • ONE saveScreenshot per session. This spec takes none: everything it asserts is text.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { appModeReason, firstReason, loadedModelReason, skipSuite } from "../support/prerequisites.js";

const USER_DATA =
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
// The folder the harness pre-seeds and points ai.workspaceRoot at. The session MUST start on this same folder: a
// session on a path that does not exist makes every project read answer "unconfigured", and addProjectMemory throws.
const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.join(USER_DATA, "workspace-fixture");
// Must name a model the local server ALREADY has resident under this exact identifier. Asking for one it does not
// have makes it JIT-load a second copy alongside whatever is loaded, which on a 12GB card is a CUDA OOM that reads
// as "the model is slow" rather than as the out-of-memory it is.
const MODEL = process.env.CD_LIVE_MODEL ?? "qwen3-4b-instruct-2507";
const PROVIDER_URL = process.env.CD_LIVE_PROVIDER_URL ?? "http://127.0.0.1:1234/v1";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
// Unqualified on purpose: this is the tag `agentImageTag` builds, and each engine shows it its own way — podman
// prefixes local images with `localhost/`, docker leaves them bare. Both resolve the short name.
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";

// A word plus four digits: the model has to copy it back verbatim, and a base36 blob invites a transcription slip
// that would read as the injection having failed.
const SENTINEL = `ZEPHYR-${String(Date.now()).slice(-4)}`;
// Answerable ONLY from the memory below. A model that never received it cannot invent this.
const ASK = "What is the project's deploy codeword? Reply with only the codeword and nothing else.";

// pi keeps the most recent `keepRecentTokens` of a conversation and summarises only what falls BEFORE that cut, so
// under this threshold there is nothing to summarise and `compact()` refuses with "Nothing to compact (session too
// small)" — no number of small turns changes that, it is a token count. pi's default is 20000
// (settings-manager.js: `keepRecentTokens ?? 20000`), so the conversation is deliberately grown past it.
const COMPACTION_KEEP_RECENT_TOKENS = 20000;
// Just clear of the threshold, not far past it: the number the session REPORTS counts the system prompt and the tool
// definitions (~1400 here), while pi's cut point walks MESSAGE entries only. A conversation reporting 21148 tokens had
// nothing to summarise because the messages alone were still under the cut.
// +4000 measured, not guessed: pi reports the context total through `getContextUsage` (the provider's own token
// counts) while its cut point walks entries with a char/4 ESTIMATE, so the two disagree by a few thousand. A
// conversation reporting 22077 still had nothing to summarise; the margin has to cover that gap and stay under
// the auto-compaction ceiling, which on a 40960 window is 24576.
const FILL_TARGET_TOKENS = COMPACTION_KEEP_RECENT_TOKENS + 4000;
// pi's own reserve, mirrored from settings-manager.js (`reserveTokens ?? 16384`). AUTO-compaction fires above
// `contextWindow - reserveTokens`, so the band this spec has to land in is bounded at both ends: above
// keepRecentTokens, where a manual /compact has something to summarise, and below the auto threshold, where pi has
// not already done it. Overshooting collapses the conversation to a summary and the manual compaction then has
// nothing left — which is exactly what a fill calibrated for a bigger window did.
const PI_COMPACTION_RESERVE_TOKENS = 16384;
// What the server has to have loaded, DERIVED from the two numbers above rather than guessed: pi auto-compacts
// above `window - reserve`, so a window that does not clear the fill target by the whole reserve can never let a
// conversation reach the band a manual /compact needs. 40960 is the next size a load offers that does.
const MIN_SERVER_CONTEXT = FILL_TARGET_TOKENS + PI_COMPACTION_RESERVE_TOKENS;
const RECOMMENDED_SERVER_CONTEXT = 40960;
// Small rounds so the band can actually be hit. The band is only a few thousand tokens wide on a 40960 window, and a
// round of 400 notes (~10k tokens) jumps straight over it.
const FILL_NOTES_PER_ROUND = 100;
// A backstop, not a budget: the loop stops on pi's OWN reported total, and this only keeps a model that answers
// nothing from filling forever.
const MAX_FILL_TURNS = 14;

// The local server must have room for the whole grown conversation — pi reports the model's CATALOGUE window (128k
// for this one), not the context LM Studio actually loaded, so it will happily let a session outgrow the server.
// Load accordingly: `lms load <model> --context-length 40960`.
//
// A local model is pulled into VRAM on the first request, so every wait on a model's behalf is generous.
const TURN_TIMEOUT = 240000;
const START_TIMEOUT = 120000;
const HOOK_TIMEOUT = START_TIMEOUT + TURN_TIMEOUT * 3 + 60000;

let program = "";

function hasImage(reference) {
  try {
    execFileSync(program, ["image", "inspect", reference], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function transcript() {
  return browser.execute(() => {
    const view = window.__cdCodingAgentStore.getState().view;
    return {
      phase: view.phase,
      items: view.timeline.map((entry) => ({
        kind: entry.kind,
        // A transcript message carries its author in `role`, NOT in `kind` — both the prompt and the answer are
        // `kind: "message"`. Filtering on the kind alone finds the user's own prompt and nothing else.
        role: entry.role ?? "",
        text: `${entry.message ?? entry.content ?? ""}`.slice(0, 600),
      })),
    };
  });
}

function assistantText(snapshot) {
  return snapshot.items
    .filter((item) => item.kind === "message" && item.role === "assistant")
    .map((item) => item.text)
    .join(" ");
}

// Ask, then wait for the turn to really finish. The phase is STILL `idle` the instant a prompt is submitted — a turn
// only starts once the container answers — so waiting for `idle` alone returns before anything has happened, and the
// teardown that follows CANCELS the model mid-load. A NEW answer is the only reliable signal once the transcript
// already holds one: "there is assistant text" is true from the second turn onwards before the model has said a word.
async function askAndSettle(prompt, reason) {
  const before = (await transcript()).items.filter((item) => item.kind === "message" && item.role === "assistant")
    .length;
  await browser.execute((text) => {
    void window.__cdCodingAgentStore.getState().submit(text);
  }, prompt);
  await browser.waitUntil(
    async () => {
      const snapshot = await transcript();
      if (snapshot.items.some((item) => item.kind === "error")) return true;
      const answers = snapshot.items.filter((item) => item.kind === "message" && item.role === "assistant");
      return snapshot.phase === "idle" && answers.length > before && `${answers.at(-1).text}`.trim().length > 0;
    },
    { timeout: TURN_TIMEOUT, interval: 2000, timeoutMsg: reason },
  );
  return transcript();
}

// What the session says its own context now holds — pi's own number, which is also the one compaction measures
// against. Read after a turn, which is when the session publishes it.
function reportedContextTokens() {
  return browser.execute(() => window.__cdCodingAgentStore.getState().view.context?.totals?.estimatedTokens ?? 0);
}

// The window the PROVIDER published, as the session reports it back. Zero when unknown, in which case the band cannot
// be computed and the fill is bounded only by the loop.
function reportedContextWindow() {
  return browser.execute(() => {
    const view = window.__cdCodingAgentStore.getState().view.context?.window;
    return view?.status === "known" ? view.maxInputTokens + view.reservedOutputTokens : 0;
  });
}

// Distinct lines rather than one repeated sentence: identical text invites a model to loop, and gives the server's
// prefix cache a reason to answer without reading any of it.
function filler(round) {
  const lines = [];
  for (let index = 0; index < FILL_NOTES_PER_ROUND; index += 1) {
    lines.push(`Note ${round}.${index}: the operator inspected container ${index} and recorded its state as steady.`);
  }
  return `Acknowledge these notes with the single word ACK, nothing else.\n\n${lines.join("\n")}`;
}

// What the run learned, printed on the way through: a live transcript is the only record of why a model did what it
// did, and reconstructing it from an assertion message costs another turn.
function report(label, value) {
  console.log(`${label} ${JSON.stringify(value, null, 2)}`);
}

let answered = { items: [] };
let published = {};
let usage = {};
let context = {};
let compacted = {};

describe("what a real session reports about itself", () => {
  before(async function startLiveSession() {
    this.timeout(HOOK_TIMEOUT);
    // The window this needs is bigger than the default load: pi's own reserve plus the conversation it has to grow
    // past the compaction cut do not fit under it. That is a reload on this machine, not a fault in the app.
    const blocked = await firstReason([
      () => appModeReason("real"),
      () => loadedModelReason(MODEL, MIN_SERVER_CONTEXT, RECOMMENDED_SERVER_CONTEXT),
    ]);
    if (blocked) return skipSuite(this, blocked);
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // The connection comes from the app's OWN engine port rather than the DOM: a container pair needs a CONNECTED
    // engine, and `running` is the only thing that says so. Engines come up while the app boots and do not finish
    // together, so the preferred one gets its own window before any running engine will do.
    let connections = [];
    async function runningConnections() {
      // Re-shaped in the page rather than handed back whole: a failed engine op answers `{ ok: false, error }`, and a
      // returned key by that name is read as a W3C error response and thrown against an innocent line.
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
        timeoutMsg: "no engine connection ever came up — is the app in mock mode, or is no engine API listening?",
      });
    }
    const running = connections.filter((entry) => entry.running);
    const target = running.find((entry) => entry.engine === PREFERRED_ENGINE) ?? running[0];
    program = target.engine === "podman" ? "podman" : "docker";
    console.log(`LIVE ENGINE ${target.engine} (${target.id}) via ${program}`);
    assert.ok(
      hasImage(AGENT_IMAGE),
      `${AGENT_IMAGE} is missing from ${program} — build it first: yarn cli agent-image --engine ${program}`,
    );

    // Keyless and provider-less on purpose: with no providerId the host does not compose the gateway's env file from
    // the keychain, so nothing is read from the OS keyring and the run costs nothing. `scheme: "none"` is what makes
    // the gateway sign neither x-api-key nor a bearer, which is what a local server wants.
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

    // Added while the session RUNS, which is the case the per-turn publish exists for: a session that kept the set it
    // was born with would be exactly as silent as no injection at all.
    published = await browser.executeAsync(
      (memory, done) => {
        window.AI.clearProjectMemory()
          .catch(() => undefined)
          .then(() => window.AI.addProjectMemory(`The project's deploy codeword is ${memory}.`))
          .then(
            () => done({ ok: true, reason: "" }),
            (failure) => done({ ok: false, reason: String(failure) }),
          );
      },
      SENTINEL,
    );
    assert.equal(published.ok, true, `the project memory could not be written: ${published.reason}`);

    answered = await askAndSettle(ASK, "the turn carrying the project memory never finished");
    report("PROJECT-CONTEXT TURN", answered.items);

    // Re-read AFTER the turn: the store hands out immutable snapshots, so one captured earlier still carries the
    // context this turn had not been given yet.
    const view = await browser.execute(() => {
      const state = window.__cdCodingAgentStore.getState();
      return {
        systemContext: state.systemContext ?? { text: "", tainted: false, sources: [] },
        usage: state.view.usage,
        context: state.view.context,
      };
    });
    published = { ...published, ...view.systemContext };
    usage = view.usage ?? {};
    context = view.context ?? {};
    report("USAGE", usage);
    report("CONTEXT", { ...context, tools: context.tools?.map((tool) => tool.name) });

    // Grown into the band where a manual /compact means something, on pi's OWN accounting rather than a guess at how
    // many characters make a token. Last, because compaction rewrites the very conversation the reports above describe.
    const providerWindow = await reportedContextWindow();
    const autoCompactAbove = providerWindow > 0 ? providerWindow - PI_COMPACTION_RESERVE_TOKENS : Number.MAX_SAFE_INTEGER;
    // The second measurement of the same thing, and the authoritative one: the window the SESSION reports, not what
    // the server said it loaded. Still an absence rather than a defect, so it skips with the reload that fixes it.
    if (autoCompactAbove <= FILL_TARGET_TOKENS) {
      return skipSuite(
        this,
        `this server's context (${providerWindow}) leaves no room to fill: pi would auto-compact above ` +
          `${autoCompactAbove}, before a conversation could reach ${FILL_TARGET_TOKENS} — unload the model, then ` +
          `\`lms load ${MODEL} --context-length ${RECOMMENDED_SERVER_CONTEXT} --yes\``,
      );
    }

    let filled = await reportedContextTokens();
    for (let round = 1; round <= MAX_FILL_TURNS && filled <= FILL_TARGET_TOKENS; round += 1) {
      await askAndSettle(filler(round), `the fill turn ${round} never finished`);
      const previous = filled;
      filled = await reportedContextTokens();
      console.log(`FILL round ${round}: the session reports ${filled} context tokens`);
      // A total that FELL is pi having compacted on its own, which leaves the manual compaction below nothing to do.
      // Reported as what it is rather than pursued: another round would only trigger it again.
      assert.ok(
        filled >= previous,
        `pi auto-compacted mid-fill (${previous} → ${filled} tokens): this server's ${providerWindow}-token window ` +
          `puts its threshold at ${autoCompactAbove}, too close to pi's ${COMPACTION_KEEP_RECENT_TOKENS}-token cut ` +
          "for a manual compaction to be reachable. Load the model with more room and run again.",
      );
    }
    assert.ok(
      filled > COMPACTION_KEEP_RECENT_TOKENS,
      `the conversation never grew past pi's cut (${filled} tokens) — nothing would be left to summarise`,
    );

    compacted = await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .runPiCommand("compact", "keep the codeword")
        .then(
          // A refused command answers `{ ok: false, error }`; that key must not travel back under its own name.
          (result) => done({ ok: result.ok === true, reason: String(result.error ?? ""), data: result.data ?? null }),
          (failure) => done({ ok: false, reason: String(failure), data: null }),
        );
    });
    report("COMPACT", compacted);
  });

  after(async () => {
    // A session left running holds its published port and its container pair. Torn down even when a scenario failed,
    // so the next run does not fail on a name collision it cannot explain.
    await browser
      .executeAsync((done) => {
        window.__cdCodingAgentStore
          .getState()
          .stop()
          .then(() => done(true), () => done(false));
      })
      .catch(() => undefined);
  });

  it("appends the app's prose to the system prompt pi assembled, per turn", () => {
    assert.ok(String(published.text).includes(SENTINEL), `the published context never carried ${SENTINEL}`);
    // Project prose is content the app did not author, so the turn carrying it cannot ride a remembered allow.
    assert.equal(published.tainted, true, "project prose must taint the turn that carries it");
  });

  // The whole point: pi CHAINS `before_agent_start` handlers, so appending to `event.systemPrompt` has to keep
  // everything pi built AND carry the app's prose. Only the model can say whether it did.
  it("gets that prose all the way to the model, which answers from it", () => {
    assert.ok(
      assistantText(answered).includes(SENTINEL),
      `the model never quoted the codeword it was given: ${JSON.stringify(answered.items)}`,
    );
  });

  it("reports the real cost of a real turn", () => {
    assert.ok(usage.requests > 0, `no provider request was counted: ${JSON.stringify(usage)}`);
    assert.ok(usage.inputTokens > 0, `no input tokens were reported: ${JSON.stringify(usage)}`);
    assert.ok(usage.outputTokens > 0, `no output tokens were reported: ${JSON.stringify(usage)}`);
    // A keyless local server has no published price, so the panel is meant to show nothing rather than a confident
    // $0.00. Proving a NON-empty cost needs a priced provider and real money, which no test may spend by itself.
    assert.deepEqual(usage.costs, [], "a free local provider must not claim a price");
  });

  it("reports the real context of a real turn", () => {
    assert.equal(context.model, MODEL, `the session named a different model: ${context.model}`);
    // The drawer used to say "No tools offered to the model" for a session that had just used one.
    assert.ok(context.tools.length > 0, "no tools were reported as offered to the model");
    assert.ok(context.totals.estimatedTokens > 0, `nothing was accounted for: ${JSON.stringify(context.totals)}`);
    // The app's own policy, applied to what pi reported: a mutation is gated, a read is not.
    const gated = context.tools.filter((tool) => tool.gated).map((tool) => tool.name);
    assert.ok(gated.includes("removeContainer"), `a destructive tool was not gated: ${gated}`);
    assert.ok(!gated.includes("listContainers"), `a read was gated: ${gated}`);
    // The memory the app injected, itemised — the session only ever saw the composed prose.
    assert.equal(
      context.sources.some((source) => source.kind === "memory"),
      true,
      `the injected memory is missing from the sources: ${JSON.stringify(context.sources)}`,
    );
    // A system prompt is one section and always present; pi assembles it even with nothing from the app.
    const system = context.sections.find((section) => section.kind === "system");
    assert.ok(system.characters > 0, "the session reported an empty system prompt");
  });

  it("compacts the real conversation and answers with pi's own summary", () => {
    assert.equal(compacted.ok, true, `compaction failed: ${compacted.reason}`);
    assert.ok(
      typeof compacted.data.summary === "string" && compacted.data.summary.trim().length > 0,
      `compaction returned no summary: ${JSON.stringify(compacted.data)}`,
    );
    // What the conversation measured before the cut. Anything at or below pi's keep-recent threshold would mean it
    // summarised a conversation it should have refused, so this is the number that proves a REAL compaction ran.
    assert.ok(
      compacted.data.tokensBefore > COMPACTION_KEEP_RECENT_TOKENS,
      `compaction ran on a session too small to compact: ${JSON.stringify(compacted.data)}`,
    );
  });
});
