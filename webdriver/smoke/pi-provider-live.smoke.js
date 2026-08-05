// Proves the provider-shape contract with REAL containers: the app resolves a provider, the host writes the
// gateway's env file from the OS keychain, the gateway signs the upstream its own way, and pi speaks the wire
// shape that upstream expects. The fixture specs stub every one of those; nothing is stubbed here.
//
// Two shapes, both against a REAL container pair on a REAL engine:
//   • openai-completions — the shape every provider but Anthropic speaks. Started through the REAL DRAWER.
//   • anthropic-messages — the Anthropic SDK's shape, which posts /v1/messages onto the ORIGIN. This is the
//     one the old single-URL contract broke: it arrived as /v1/v1/messages and 404ed.
//
// Needs a NON-mock app (CONTAINER_DESKTOP_MOCK=), a connected engine, the agent image built for this version
// (`yarn cli agent-image`), and an OpenAI-compatible server on CD_LIVE_PROVIDER_URL that ALSO serves
// /v1/messages. LM Studio does both — but it must be bound to the network (`lms server start --bind 0.0.0.0`),
// because 127.0.0.1 inside the agent container is the container, not this machine.
//
// HARNESS RULES, each of which cost a run before:
//   • An `async` page function handed to browser.execute does NOT work — WebKitWebDriver cannot serialize the
//     promise, so the step looks like it passed and its rejection is reported against whichever command runs NEXT.
//     Start the work from a synchronous page function and poll, or use executeAsync's `done`.
//   • Never return an object with a key named `error`: WebdriverIO reads it as a W3C error response and throws it.
//   • ONE saveScreenshot per session — a command after a second one hangs and takes the session with it. This
//     spec takes none: everything it asserts is text.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appModeReason, firstReason, loadedModelReason, skipSuite } from "../support/prerequisites.js";

const USER_DATA =
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data");
const WORKSPACE = process.env.CD_LIVE_WORKSPACE ?? path.join(USER_DATA, "workspace-fixture");
// Must name a model the local server ALREADY has resident under this exact identifier. Asking for one it does
// not have makes it JIT-load a second copy alongside whatever is loaded, which on a 12GB card is a CUDA OOM
// (`cudaMalloc failed`) that reads as "the model is slow" rather than as the out-of-memory it is.
const MODEL = process.env.CD_LIVE_MODEL ?? "qwen3-4b-instruct-2507";
const APP_VERSION = process.env.CD_LIVE_APP_VERSION ?? "6.0.0";
// Unqualified on purpose: this is the tag `agentImageTag` builds, and each engine shows it its own way — podman
// prefixes local images with `localhost/`, docker leaves them bare. Both resolve the short name.
const AGENT_IMAGE = `container-desktop/pi-agent:${APP_VERSION}`;
const PREFERRED_ENGINE = process.env.CD_LIVE_ENGINE ?? "podman";
// The provider host as THIS machine sees it. The app rewrites it to the engine's host alias on the way into the
// container; that rewrite is one of the things under test.
const PROVIDER_URL = process.env.CD_LIVE_PROVIDER_URL ?? "http://127.0.0.1:1234/v1";

// A question with one short, checkable answer, and no tool worth calling — the wire shape is what is being
// proven here, not the model's judgement.
const PROMPT = "What is 17 plus 25? Reply with just the number, nothing else.";
const ANSWER = "42";
// A local model is pulled into VRAM on the first request, so every wait on a model's behalf is generous. The
// hooks that spend these budgets raise their own mocha timeout (`this.timeout`) rather than the shared config,
// which every other spec would inherit.
const TURN_TIMEOUT = 240000;
const START_TIMEOUT = 120000;
const HOOK_TIMEOUT = START_TIMEOUT + TURN_TIMEOUT + 60000;

let program = "";

function engine(args) {
  return execFileSync(program, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function hasImage(reference) {
  try {
    engine(["image", "inspect", reference]);
    return true;
  } catch {
    return false;
  }
}

// What a container was actually given, read from the engine rather than from the file the app wrote — this is
// the only place that proves the env SURVIVED the run argv. Never printed wholesale: the gateway's copy carries
// the provider key.
function containerEnv(name) {
  const raw = engine(["inspect", name, "--format", "{{json .Config.Env}}"]);
  const pairs = JSON.parse(raw).map((entry) => {
    const at = entry.indexOf("=");
    return [entry.slice(0, at), entry.slice(at + 1)];
  });
  return Object.fromEntries(pairs);
}

// The session's own containers, named after the suffix the store picked.
function sessionNames() {
  return browser.execute(() => {
    const spec = window.__cdCodingAgentStore.getState().spec;
    return { agent: spec?.agentContainerName ?? "", gateway: spec?.gatewayContainerName ?? "" };
  });
}

function transcript() {
  return browser.execute(() => {
    const view = window.__cdCodingAgentStore.getState().view;
    return {
      phase: view.phase,
      items: view.timeline.map((entry) => ({
        kind: entry.kind,
        // A transcript message carries its author in `role`, NOT in `kind` — both the prompt and the answer
        // are `kind: "message"`. Filtering on the kind alone finds the user's own prompt and nothing else.
        role: entry.role ?? "",
        status: entry.status ?? "",
        tool: entry.tool ?? "",
        text: `${entry.message ?? entry.content ?? ""}`.slice(0, 600),
      })),
    };
  });
}

// Start a session the way the drawer's own submit does — the resolved options, straight into the store. Used for
// the shapes the drawer cannot be steered to without driving the ModelPicker's discovery popover; scenario 1
// drives the real form instead, so both routes into `start` are covered.
async function startSession(options) {
  const started = await browser.executeAsync(
    (opts, done) => {
      const read = () => {
        const state = window.__cdCodingAgentStore.getState();
        return { status: state.status, reason: state.error ?? "", log: state.startLog.join(" | ") };
      };
      window.__cdCodingAgentStore
        .getState()
        .start(opts)
        .then(
          () => done(read()),
          (failure) => done({ ...read(), reason: String(failure) }),
        );
    },
    options,
  );
  return started;
}

async function stopSession() {
  await browser.executeAsync((done) => {
    window.__cdCodingAgentStore
      .getState()
      .stop()
      .then(() => done(true), () => done(false));
  });
}

// Ask, then wait for the turn to really finish. The phase is STILL `idle` the instant a prompt is submitted —
// a turn only starts once the container answers — so waiting for `idle` alone returns before anything has
// happened, and the teardown that follows CANCELS the model mid-load. Wait for a settled answer (or a
// reported error) instead. A local model is pulled into VRAM on the first request, which is why this is
// patient rather than clever.
async function askAndSettle(reason) {
  await browser.execute((prompt) => {
    void window.__cdCodingAgentStore.getState().submit(prompt);
  }, PROMPT);
  // Sampled WHILE the turn runs, because that is the only time it exists: a working indicator asserted after
  // the turn has settled would always be absent, and asserted before it would always be absent too.
  let sawWorkingIndicator = false;
  await browser.waitUntil(
    async () => {
      const snapshot = await transcript();
      if (!sawWorkingIndicator) {
        sawWorkingIndicator = await browser.execute(() => document.querySelector(".ThinkingStatus") !== null);
      }
      if (snapshot.items.some((item) => item.kind === "error")) return true;
      return snapshot.phase === "idle" && assistantText(snapshot).trim().length > 0;
    },
    { timeout: TURN_TIMEOUT, interval: 2000, timeoutMsg: reason },
  );
  return { ...(await transcript()), sawWorkingIndicator };
}

function assistantText(snapshot) {
  return snapshot.items
    .filter((item) => item.kind === "message" && item.role === "assistant")
    .map((item) => item.text)
    .join(" ");
}

// What the run learned, printed on the way through: a live transcript is the only record of why a model did what
// it did, and reconstructing it from an assertion message costs another turn.
function report(label, snapshot) {
  console.log(`${label} phase=${snapshot.phase} ${JSON.stringify(snapshot.items, null, 2)}`);
}

// The harness seeds user-settings.json before the app boots (wdio.conf.js), so the providers this spec needs
// have to be written here and the renderer restarted to pick them up — the drawer reads its provider and model
// from the store, which is loaded once at boot. Both providers are pointed at the same local server and made
// KEYLESS on purpose: nothing is written to the OS keyring, and the run costs nothing.
function seedProviders() {
  const file = path.join(USER_DATA, "user-settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  const provider = { model: MODEL, baseURL: PROVIDER_URL, auth: { scheme: "none" } };
  settings.ai = {
    ...settings.ai,
    defaultProvider: "lmstudio",
    providers: {
      ...settings.ai?.providers,
      lmstudio: provider,
      // The `anthropic` CATALOG entry is the only id that resolves to kind "anthropic" — the kind is read from
      // the catalog, never from settings — so it is what makes the agent speak anthropic-messages. Pointed at
      // the same local server, which serves /v1/messages as well as /v1/chat/completions.
      anthropic: provider,
    },
  };
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

let connectionId = "";
let openaiShape = {};
let anthropicShape = {};

describe("the provider-shape contract against real containers", () => {
  before(async function () {
    const blocked = await firstReason([() => appModeReason("real"), () => loadedModelReason(MODEL, 12000, 16384)]);
    if (blocked) return skipSuite(this, blocked);
    seedProviders();
    // The renderer loads user settings once, at boot; a reload is what makes the seed above reach the drawer.
    // A sentinel marks THIS document, so the wait below ends on the new one rather than after a fixed pause:
    // a reload that outlasts a guessed delay leaves the OLD dom on screen, every query matches it, and the
    // reload then wipes what was just found — which surfaces much later as a null element in an innocent step.
    await browser.execute(() => {
      window.__cdPreReload = true;
      window.location.hash = "#/screens/ai/assistant";
      window.location.reload();
    });
    await browser.waitUntil(
      async () =>
        await browser.execute(
          () => window.__cdPreReload !== true && typeof window.__cdCodingAgentStore !== "undefined",
        ),
      { timeout: 60000, interval: 500, timeoutMsg: "the renderer never came back up after the settings reload" },
    );
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Coding Agent screen never mounted",
    });

    // The connection comes from the app's OWN engine port rather than the DOM: a container pair needs a
    // CONNECTED engine, and `running` is the only thing that says so. Engines come up while the app boots and
    // do not finish together, so the preferred one gets its own window before any running engine will do.
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
      await browser.waitUntil(async () => (await runningConnections()).length > 0, {
        timeout: 30000,
        interval: 2000,
        timeoutMsg: "no engine connection ever came up — is the app in mock mode, or is no engine API listening?",
      });
    }
    const running = connections.filter((entry) => entry.running);
    const target = running.find((entry) => entry.engine === PREFERRED_ENGINE) ?? running[0];
    connectionId = target.id;
    program = target.engine === "podman" ? "podman" : "docker";
    console.log(`LIVE ENGINE ${target.engine} (${target.id}) via ${program}`);
    assert.ok(
      hasImage(AGENT_IMAGE),
      `${AGENT_IMAGE} is missing from ${program} — build it first: yarn cli agent-image --engine ${program}`,
    );
  });

  after(async () => {
    // A session left running holds its published port and its container pair. Torn down even when a scenario
    // failed, so the next run does not fail on a name collision it cannot explain.
    await stopSession().catch(() => undefined);
  });

  describe("an openai-completions provider, started from the drawer", () => {
    before(async function startFromDrawer() {
      this.timeout(HOOK_TIMEOUT);
      // The REAL form: the drawer resolves the connection, the workspace, the provider and the model, and its own
      // submit calls start(). Nothing here reaches into the store to shortcut that.
      await browser.execute(() => {
        Array.from(document.querySelectorAll(".ResourceListActionButton"))
          .find((button) => (button.textContent ?? "").includes("Start session"))
          ?.click();
      });
      await $(".AppStartAgentSessionDrawer #agentWorkspacePath").waitForExist({
        timeout: 15000,
        timeoutMsg: "the start drawer never opened",
      });
      // Discovery and the key probe both answer asynchronously; the submit stays disabled until they have.
      await browser.pause(1500);
      await browser.execute((text) => {
        const input = document.querySelector(".AppStartAgentSessionDrawer #agentWorkspacePath");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, text);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      }, WORKSPACE);
      await browser.pause(400);

      const form = await browser.execute(() => {
        const drawer = document.querySelector(".AppStartAgentSessionDrawer");
        const submit = drawer?.querySelector('.bp6-dialog-body button[type="submit"]');
        return {
          model: drawer?.querySelector(".ModelPickerTriggerLabel")?.textContent ?? "",
          workspace: drawer?.querySelector("#agentWorkspacePath")?.value ?? "",
          disabled: submit?.hasAttribute("disabled") ?? true,
          problems: Array.from(drawer?.querySelectorAll(".AgentStartProblems div") ?? []).map((l) => l.textContent),
        };
      });
      assert.equal(
        form.disabled,
        false,
        `the drawer refused to start: ${JSON.stringify(form.problems)} (model "${form.model}")`,
      );

      await browser.execute(() => {
        document.querySelector('.AppStartAgentSessionDrawer .bp6-dialog-body button[type="submit"]')?.click();
      });
      await browser.waitUntil(
        async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().status)) !== "starting",
        { timeout: START_TIMEOUT, interval: 1000, timeoutMsg: "the drawer's session never left `starting`" },
      );
      const state = await browser.execute(() => {
        const store = window.__cdCodingAgentStore.getState();
        return { status: store.status, reason: store.error ?? "", log: store.startLog.join(" | ") };
      });
      assert.equal(state.status, "ready", `the session did not become ready: ${state.reason} [${state.log}]`);

      const names = await sessionNames();
      openaiShape = { agent: containerEnv(names.agent), gateway: containerEnv(names.gateway), names };
      openaiShape.turn = await askAndSettle("the openai-completions turn never finished");
      report("OPENAI-COMPLETIONS TURN", openaiShape.turn);

      // The action behind the composer's New-session button: useAIStore.newSession() is a one-line wrapper
      // around this, and only this store is exposed to a spec.
      const restart = await browser.executeAsync((done) => {
        window.__cdCodingAgentStore
          .getState()
          .restart()
          .then(
            () => done({ ok: true }),
            (failure) => done({ ok: false, reason: String(failure) }),
          );
      });
      openaiShape.restartReason = restart.ok ? "" : restart.reason;
      if (restart.ok) {
        await browser.waitUntil(
          async () => (await browser.execute(() => window.__cdCodingAgentStore.getState().status)) === "ready",
          { timeout: START_TIMEOUT, interval: 1000, timeoutMsg: "the restarted session never became ready" },
        );
        openaiShape.restarted = await browser.execute(() => ({
          agent: window.__cdCodingAgentStore.getState().spec?.agentContainerName ?? "",
          timeline: window.__cdCodingAgentStore.getState().view.timeline.length,
        }));
      }
      await stopSession();
    });

    it("tells the agent to speak openai-completions, on a /v1 base", () => {
      assert.equal(openaiShape.agent.CD_MODEL_API, "openai-completions");
      // pi's openai client posts /chat/completions onto a base that must already carry the version segment.
      assert.ok(
        openaiShape.agent.CD_GATEWAY_URL.endsWith("/v1"),
        `the openai shape needs a /v1 base, got ${openaiShape.agent.CD_GATEWAY_URL}`,
      );
    });

    it("gives the gateway a keyless credential shape and no key to sign with", () => {
      assert.equal(openaiShape.gateway.CD_UPSTREAM_AUTH_SCHEME, "none");
      // The defect this replaced: `required()` on an empty key killed the gateway for every keyless server.
      assert.equal(openaiShape.gateway.CD_UPSTREAM_API_KEY, "");
      assert.equal(openaiShape.gateway.CD_UPSTREAM_KIND, "local");
    });

    it("rewrites a provider on this machine to the engine's host alias", () => {
      // 127.0.0.1 inside the container is the container. Without the rewrite the upstream is simply unreachable.
      const alias = program === "podman" ? "host.containers.internal" : "host.docker.internal";
      assert.ok(
        openaiShape.gateway.CD_UPSTREAM_BASE_URL.includes(alias),
        `the upstream was not rewritten to ${alias}: ${openaiShape.gateway.CD_UPSTREAM_BASE_URL}`,
      );
    });

    it("answers a real turn through the container pair", () => {
      assert.ok(
        assistantText(openaiShape.turn).includes(ANSWER),
        `the model never answered ${ANSWER}: ${JSON.stringify(openaiShape.turn.items)}`,
      );
    });

    // Between submitting and the first token there is nothing else on screen, so without this the session
    // reads as frozen for however long the model takes.
    it("shows that the agent is working while the turn runs", () => {
      assert.ok(openaiShape.turn.sawWorkingIndicator, "no working indicator ever appeared during the turn");
    });

    // "New conversation" can only mean a fresh SESSION here — pi holds the conversation inside it and the
    // bridge carries no reset. The button used to reject into a swallowed promise and look dead.
    it("starts a genuinely new conversation, on a new container pair", () => {
      assert.ok(openaiShape.restarted, `the session did not come back up: ${openaiShape.restartReason}`);
      assert.notEqual(
        openaiShape.restarted.agent,
        openaiShape.names.agent,
        "a new conversation must be a new container pair, not the same one relabelled",
      );
      assert.equal(openaiShape.restarted.timeline, 0, "the transcript must be empty again");
    });
  });

  describe("an anthropic provider", () => {
    before(async function startAnthropic() {
      this.timeout(HOOK_TIMEOUT);
      const started = await startSession({
        connectionId,
        workspacePath: WORKSPACE,
        modelId: MODEL,
        providerId: "anthropic",
        providerKind: "anthropic",
        upstreamAuth: { scheme: "none" },
        upstreamBaseUrl: PROVIDER_URL,
        appVersion: APP_VERSION,
        egress: true,
      });
      assert.equal(started.status, "ready", `the anthropic session did not become ready: ${started.reason} [${started.log}]`);

      const names = await sessionNames();
      anthropicShape = { agent: containerEnv(names.agent), gateway: containerEnv(names.gateway), names };
      anthropicShape.turn = await askAndSettle("the anthropic-messages turn never finished");
      report("ANTHROPIC-MESSAGES TURN", anthropicShape.turn);
      await stopSession();
    });

    it("tells the agent to speak anthropic-messages, on the ORIGIN", () => {
      assert.equal(anthropicShape.agent.CD_MODEL_API, "anthropic-messages");
      // The whole defect in one assertion: the Anthropic SDK posts /v1/messages onto whatever base it is given,
      // so a base carrying /v1 makes the request arrive as /v1/v1/messages and 404.
      assert.equal(
        /\/v1\/?$/.test(anthropicShape.agent.CD_GATEWAY_URL),
        false,
        `the anthropic shape must be handed the origin, got ${anthropicShape.agent.CD_GATEWAY_URL}`,
      );
    });

    it("tells the gateway the upstream is anthropic, so it signs x-api-key", () => {
      // The gateway reads this to pick x-api-key over Authorization: Bearer. Its keyless case signs neither,
      // which is what makes a local Anthropic-shaped server work without a key at all.
      assert.equal(anthropicShape.gateway.CD_UPSTREAM_KIND, "anthropic");
      assert.equal(anthropicShape.gateway.CD_UPSTREAM_AUTH_SCHEME, "none");
    });

    it("answers a real turn through the container pair", () => {
      assert.ok(
        assistantText(anthropicShape.turn).includes(ANSWER),
        `the model never answered ${ANSWER}: ${JSON.stringify(anthropicShape.turn.items)}`,
      );
    });
  });
});
