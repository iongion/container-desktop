import { strict as assert } from "node:assert";

// Verifies the container toolset on the real renderer, end to end through the app's OWN path: the `engine_op`
// host request the container would send goes through the store's handleHostRequest, the permission gate, the
// `ai:engine:op` channel and its zod boundary, into the broker's engineOps — which in mock mode is the fixture
// engine. Nothing along that chain is stubbed except the bridge client, which records what the container is told.
//
// The container half (pi registering these tools and calling back over `engine_op`) is covered by the hermetic
// suite plus `node support/pi-plugins-probe.mjs`, which proves a real container still starts with them registered.
//
// ONE session, read back as DOM/state snapshots, with ONE saveScreenshot per run — a command after a second one
// hangs and takes the session with it.
//
// HARNESS NOTE: an `async` page function handed to browser.execute does NOT work here. WebKitWebDriver cannot
// serialize the promise it returns, so the step looks like it succeeded and its rejection is reported against
// whichever command runs NEXT — which reads as an unrelated failure in an unrelated place. Every asynchronous
// step below is therefore KICKED OFF by a synchronous page function that parks the outcome on a global, then
// polled with waitUntil.

const ENGINE_OP = (op, args, requestId) => ({
  type: "host_request",
  requestId,
  method: "engine_op",
  payload: { op, args },
});

// Run one asynchronous store call to completion without ever handing a promise back to the driver.
async function step(name, event) {
  await browser.execute(
    (stepName, payload) => {
      window.__cdSteps = window.__cdSteps ?? {};
      window.__cdSteps[stepName] = { done: false, error: "" };
      const finish = (error) => {
        window.__cdSteps[stepName] = {
          done: true,
          error: error ? String(error.stack ?? error.message ?? error) : "",
        };
      };
      try {
        Promise.resolve(window.__cdRunStep(stepName, payload)).then(() => finish(null), finish);
      } catch (error) {
        finish(error);
      }
    },
    name,
    event ?? null,
  );
  await browser.waitUntil(
    async () => (await browser.execute((stepName) => window.__cdSteps[stepName].done === true, name)) === true,
    { timeout: 30000, interval: 200, timeoutMsg: `the step "${name}" never settled` },
  );
  return browser.execute((stepName) => window.__cdSteps[stepName].error, name);
}

let readAnswer = {};
let gated = {};
let approved = {};
let rejected = {};
let unknown = {};
let cards = [];
const failures = {};

describe("pi container tools", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // `undefined` passed as a browser.execute ARGUMENT is dropped by JSON serialization, so the reset is written
    // inside the page function rather than passed in.
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
        chrome: { statuses: {}, widgets: {} },
        pendingDialog: undefined,
        pendingEngineOps: {},
        // A session scope is what makes the default connection and a remembered decision resolvable.
        spec: { workspacePath: "/work", agentContainerName: "cd-agent-e2e" },
        connectionId: "podman-1",
      });
      // There is no container in this session, so the client records what it was told and that is the assertion.
      window.__cdEngineOpAnswers = [];
      window.__cdEngineOpAborted = false;
      window.__cdCodingAgentStore.setState({
        client: {
          respond: async (requestId, response) => {
            window.__cdEngineOpAnswers.push({ requestId, response });
          },
          prompt: async () => {},
          abort: async () => {
            window.__cdEngineOpAborted = true;
          },
          close: () => {},
          surfaceInput: async () => {},
          surfaceResize: async () => {},
          setTheme: async () => {},
          listResources: async () => ({ extensions: [], commands: [], skills: [], prompts: [] }),
        },
      });
      // The step bodies live in the page, so the driver only ever sends a name plus a serializable payload.
      window.__cdRunStep = (name, event) => {
        const store = () => window.__cdCodingAgentStore.getState();
        if (name === "read" || name === "gate" || name === "rejectAsk" || name === "unknown") {
          return store().handleHostRequest(event);
        }
        if (name === "approve") return store().resolveApproval("op-remove", "allow");
        if (name === "reject") return store().resolveApproval("op-reject", "reject");
        throw new Error(`unknown step ${name}`);
      };
    });

    // An ungated read: performed at once, through the real channel into the fixture engine, which holds
    // listContainers for a beat — hence polling rather than a bare pause.
    failures.read = await step("read", ENGINE_OP("listContainers", {}, "op-read"));

    readAnswer = await browser.execute(() => {
      const answer = window.__cdEngineOpAnswers.find((entry) => entry.requestId === "op-read");
      const value = answer?.response?.value;
      return {
        answered: !!answer,
        ok: value?.ok === true,
        count: Array.isArray(value?.value) ? value.value.length : -1,
        firstId: Array.isArray(value?.value) ? (value.value[0]?.Id ?? "") : "",
        timeline: window.__cdCodingAgentStore.getState().view.timeline.length,
      };
    });

    // A mutation: asks first, and answers nothing until the user decides.
    const removal = ENGINE_OP("removeContainer", { id: "mock-c-1", connectionId: "podman-1" }, "op-remove");
    failures.gate = await step("gate", removal);

    gated = await browser.execute(() => {
      const state = window.__cdCodingAgentStore.getState();
      const item = state.view.timeline.find((entry) => entry.kind === "approval");
      return {
        answers: window.__cdEngineOpAnswers.length,
        held: Object.keys(state.pendingEngineOps),
        tool: item?.tool ?? "",
        reason: item?.reason ?? "",
        status: item?.status ?? "",
      };
    });

    failures.approve = await step("approve");

    approved = await browser.execute(() => {
      const state = window.__cdCodingAgentStore.getState();
      const answer = window.__cdEngineOpAnswers.find((entry) => entry.requestId === "op-remove");
      const item = state.view.timeline.find((entry) => entry.kind === "approval");
      return {
        answered: !!answer,
        ok: answer?.response?.value?.ok === true,
        value: answer?.response?.value?.value ?? null,
        status: item?.status ?? "",
        held: Object.keys(state.pendingEngineOps).length,
      };
    });

    // A rejection: refused as a value the model can read, and the agent stopped rather than left to retry.
    failures.rejectAsk = await step("rejectAsk", ENGINE_OP("removeVolume", { id: "mock-v-1" }, "op-reject"));
    failures.reject = await step("reject");

    rejected = await browser.execute(() => {
      const answer = window.__cdEngineOpAnswers.find((entry) => entry.requestId === "op-reject");
      return {
        ok: answer?.response?.value?.ok,
        // NOT named `error`: WebdriverIO reads a returned object with an `error` key as a WebDriver error
        // response and throws it, so the refusal text would surface as a spec failure whose message is the
        // refusal itself. Cost a run to find.
        refusal: answer?.response?.value?.error ?? "",
        aborted: window.__cdEngineOpAborted === true,
        held: Object.keys(window.__cdCodingAgentStore.getState().pendingEngineOps).length,
      };
    });

    // Something that is not a container operation must not reach the engine at all.
    failures.unknown = await step("unknown", ENGINE_OP("bash", { command: "rm -rf /" }, "op-unknown"));

    unknown = await browser.execute(() => ({
      answered: window.__cdEngineOpAnswers.some((entry) => entry.requestId === "op-unknown"),
    }));

    // The payoff: a container tool result renders as the real container card, not a generic JSON blob. Pushed as
    // the two bridge events the container emits, exactly as the tool-cards spec does.
    await browser.execute(() => {
      const store = window.__cdCodingAgentStore.getState();
      store.applyBridgeEvent({ type: "tool_start", toolCallId: "card-1", toolName: "listContainers", args: {} });
      store.applyBridgeEvent({
        type: "tool_end",
        toolCallId: "card-1",
        toolName: "listContainers",
        isError: false,
        text: "2 containers",
        details: [
          {
            Id: "aaaaaaaaaaaa",
            Name: "web",
            Image: "nginx:latest",
            Computed: { Name: "web", DecodedState: "running" },
          },
          {
            Id: "bbbbbbbbbbbb",
            Name: "db",
            Image: "postgres:16",
            Computed: { Name: "db", DecodedState: "exited" },
          },
        ],
      });
      store.applyBridgeEvent({ type: "idle" });
    });

    await $(".AICard").waitForExist({ timeout: 20000, timeoutMsg: "no card ever rendered" });
    // Cards open collapsed, so Blueprint has not mounted their bodies yet.
    await browser.execute(() => {
      for (const head of document.querySelectorAll(".AICardHead")) head.click();
    });
    await browser.pause(600);

    cards = await browser.execute(() =>
      Array.from(document.querySelectorAll(".AICard")).map((element) => ({
        title: element.querySelector(".AICardTitle")?.textContent ?? "",
        text: element.textContent ?? "",
        json: element.querySelector(".AICardJson") !== null,
      })),
    );

    if (process.env.PI_CONTAINER_TOOLS_SHOT) await browser.saveScreenshot(process.env.PI_CONTAINER_TOOLS_SHOT);
  });

  it("drives every step without the page throwing", () => {
    assert.deepEqual(failures, { read: "", gate: "", approve: "", rejectAsk: "", reject: "", unknown: "" });
  });

  it("performs a container read at once, with no approval card", () => {
    assert.equal(readAnswer.answered, true, "the read was never answered");
    assert.equal(readAnswer.ok, true, "the read did not succeed");
    assert.equal(readAnswer.timeline, 0, "a read must not put anything in the transcript");
  });

  it("answers the read with what the engine actually returned", () => {
    assert.ok(readAnswer.count > 0, `expected containers from the engine, got ${readAnswer.count}`);
    assert.ok(readAnswer.firstId.length > 0, "the returned container carried no id");
  });

  it("asks before a container mutation, and holds it until the user decides", () => {
    assert.equal(
      gated.answers,
      1,
      "the mutation was answered before the user decided — check the app's AI permission mode is Always ask",
    );
    assert.deepEqual(gated.held, ["op-remove"], "the operation was not held for the user");
    assert.equal(gated.tool, "removeContainer");
    assert.equal(gated.status, "pending");
  });

  it("names the entity and the connection on the approval card", () => {
    assert.equal(gated.reason, "mock-c-1 on podman-1", `the card read "${gated.reason}"`);
  });

  it("runs the held operation on approval and answers with the engine's result", () => {
    assert.equal(approved.answered, true, "approving never answered the container");
    assert.equal(approved.ok, true, "the approved operation did not succeed");
    assert.equal(approved.value, true, "the engine's own return value did not reach the container");
    assert.equal(approved.status, "allowed");
    assert.equal(approved.held, 0, "the operation stayed held after it ran");
  });

  it("refuses a rejected operation as a result, and stops the agent", () => {
    assert.equal(rejected.ok, false, "a rejection must answer with a failure the model can read");
    assert.ok(rejected.refusal.length > 0, "the refusal carried no reason");
    assert.equal(rejected.aborted, true, "the agent was not stopped after the rejection");
    assert.equal(rejected.held, 0, "the rejected operation stayed held");
  });

  it("never sends a non-container operation to the engine", () => {
    assert.equal(unknown.answered, false, "an operation that is not a container tool was answered");
  });

  it("renders a container tool result as the real container card", () => {
    const card = cards.find((entry) => entry.text.includes("nginx:latest"));
    assert.ok(card, `no card showed the container rows, got ${JSON.stringify(cards.map((entry) => entry.title))}`);
    assert.ok(card.text.includes("web"), "the card did not name the first container");
    assert.ok(card.text.includes("db"), "the card did not name the second container");
    assert.equal(card.json, false, "the container result fell back to the generic JSON card");
  });
});
