import { strict as assert } from "node:assert";

// The workspace toolset end to end in the WebKitGTK webview: the agent asks the APP to act on a file or run a
// command, and the app performs it WHERE the session chose — this machine, the engine's own host, a container, or a
// disposable sandbox it creates and removes.
//
// Two halves, both real:
//
// 1. The CHANNEL. `window.AI.runWorkspaceOp` is the shipped path — the real broker, the real execution selector and
//    the real exec-routed workspace, resolved against a sandbox target. Under CONTAINER_DESKTOP_MOCK the engine
//    behind it is the in-memory VirtualEngineHost, so a sandbox is genuinely created and genuinely written into
//    without a real engine and without touching anything of the user's.
// 2. The GATE. A workspace mutation is an operation the APP performs, so it is decided at the boundary that can hold
//    it: `execCommand` raises an approval card and nothing runs until the user answers.

const SANDBOX = { kind: "sandbox", connectionId: "mock-connection", image: "alpine:3" };
const RUN_ID = "workspace-tools-e2e";

const call = (op, args, target, runId) =>
  browser.executeAsync(
    (request, done) => {
      window.AI.runWorkspaceOp(request)
        .then((result) => done({ threw: false, result }))
        .catch((error) => done({ threw: true, error: String((error && error.message) || error) }));
    },
    { op, args, target: target ?? SANDBOX, runId: runId ?? RUN_ID },
  );

describe("the workspace toolset", () => {
  before(async () => {
    // The debug binary hosts the AI system before it is interactive.
    await browser.waitUntil(async () => browser.execute(() => typeof window.AI?.runWorkspaceOp === "function"), {
      timeout: 45000,
      timeoutMsg: "the AI bridge never exposed runWorkspaceOp",
    });
  });

  it("writes and reads a file back through the target the session chose", async () => {
    const written = await call("writeFile", { path: "notes/plan.md", contents: "off-host plan" });
    assert.equal(written.threw, false, `runWorkspaceOp threw: ${written.error}`);
    assert.deepEqual(written.result, { ok: true, value: { path: "notes/plan.md", written: true } });

    const read = await call("readFile", { path: "notes/plan.md" });
    // The read went to the SAME backend: the selector is memoized per run, so one sandbox served both calls.
    assert.deepEqual(read.result, { ok: true, value: "off-host plan" });
  });

  it("runs a command on the target and reports its exit code, not just its output", async () => {
    const result = await call("execCommand", { program: "ls", args: ["-la"] });
    assert.equal(result.result.ok, true, `execCommand failed: ${JSON.stringify(result.result)}`);
    assert.equal(typeof result.result.value.code, "number");
    assert.equal(result.result.value.program, "ls");
  });

  it("lists and searches what it wrote", async () => {
    const found = await call("findFiles", { pattern: "**/*.md" });
    assert.equal(found.result.ok, true, JSON.stringify(found.result));
    assert.ok(
      found.result.value.some((path) => path.endsWith("plan.md")),
      `the file written above was not found: ${JSON.stringify(found.result.value)}`,
    );
  });

  // The target's own message is the useful one — it tells the model what to do next, where a generic failure would
  // make it retry the same call.
  it("carries the target's own failure back as a value the model can read", async () => {
    const missing = await call("readFile", { path: "nothing/here.txt" });
    assert.equal(missing.threw, false, "a failed operation must not reject the invoke");
    assert.equal(missing.result.ok, false);
    assert.ok(missing.result.error.length > 0, "a refusal with no reason is not a reason");
  });

  // As a value, not a throw: the caller is settling a request a containerized agent is blocked on, so even "this is
  // not one of my operations" has to come back as something the model can read.
  it("refuses an operation that is not a workspace tool at all", async () => {
    const refused = await call("listContainers", {});
    assert.equal(refused.threw, false, "a refusal must not reject the invoke");
    assert.deepEqual(refused.result, { ok: false, error: "Unknown workspace operation: listContainers" });
  });

  it("releases what the run built, and says so", async () => {
    const released = await browser.executeAsync((runId, done) => {
      window.AI.releaseWorkspaceTargets(runId)
        .then((result) => done({ threw: false, result }))
        .catch((error) => done({ threw: true, error: String((error && error.message) || error) }));
    }, RUN_ID);
    assert.equal(released.threw, false, `release threw: ${released.error}`);
    assert.deepEqual(released.result, { ok: true });
  });

  // A run whose sandbox was released starts a NEW one: the file the first sandbox held is gone, which is what
  // "disposable" means.
  it("starts a fresh target after a release, rather than reusing the disposed one", async () => {
    const read = await call("readFile", { path: "notes/plan.md" });
    assert.equal(read.result.ok, false, "the released sandbox's file survived, so it was not disposed");
  });

  // The choice itself, in the form that already picks the connection, the workspace, the model and egress. Read off
  // the real drawer: an option nobody can select is not an offer, and a target needing a name must ask for one.
  it("offers the target on the start form, and asks for what a container or an image needs", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({ client: undefined, status: "idle", spec: undefined, startLog: [] });
    });
    await $(".AssistantEmpty--noSession").waitForExist({
      timeout: 15000,
      timeoutMsg: "the empty state never appeared after the session was dropped",
    });
    await browser.execute(() => {
      Array.from(document.querySelectorAll(".ResourceListActionButton"))
        .find((button) => (button.textContent ?? "").includes("Start session"))
        ?.click();
    });
    await $(".AppStartAgentSessionDrawer #agentExecutionKind").waitForExist({
      timeout: 15000,
      timeoutMsg: "the start drawer never offered a workspace-tools target",
    });

    const offered = await browser.execute(() => {
      const select = document.querySelector("#agentExecutionKind");
      return {
        options: Array.from(select?.options ?? []).map((option) => ({ value: option.value, text: option.textContent })),
        value: select?.value,
        help: select?.closest(".bp6-form-group")?.querySelector(".bp6-form-helper-text")?.textContent ?? "",
        ref: document.querySelector("#agentExecutionRef") !== null,
      };
    });
    assert.deepEqual(
      offered.options.map((option) => option.value),
      ["off", "host", "remote", "container", "sandbox"],
    );
    assert.equal(offered.value, "off", "the toolset must not be offered until the user chooses a target");
    assert.match(offered.help, /keeps to its own container/);
    assert.equal(offered.ref, false, "nothing to name while no target needs a name");

    const asked = await browser.execute(() => {
      const select = document.querySelector("#agentExecutionKind");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "sandbox");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });
    assert.equal(asked, true);
    await $(".AppStartAgentSessionDrawer #agentExecutionRef").waitForExist({
      timeout: 10000,
      timeoutMsg: "a sandbox target never asked for an image",
    });
    const sandbox = await browser.execute(() => {
      const submit = document.querySelector('.AppStartAgentSessionDrawer .bp6-dialog-body button[type="submit"]');
      return {
        label: document.querySelector("#agentExecutionRef")?.closest(".bp6-form-group")?.querySelector("label")
          ?.textContent,
        placeholder: document.querySelector("#agentExecutionRef")?.placeholder,
        submitDisabled: submit?.hasAttribute("disabled") ?? true,
        problems: Array.from(document.querySelectorAll(".AgentStartProblems div")).map((line) => line.textContent),
      };
    });
    assert.match(sandbox.label ?? "", /Image/);
    assert.match(sandbox.placeholder ?? "", /Image reference/);
    // Nothing named yet, so the form refuses to start rather than starting a session whose every call would fail.
    assert.equal(sandbox.submitDisabled, true);
    assert.ok(
      sandbox.problems.some((line) => /Name the container the tools run in/.test(line ?? "")),
      `the form did not say what it was missing: ${JSON.stringify(sandbox.problems)}`,
    );
  });

  it("holds a workspace mutation for approval instead of performing it", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });
    // Always-ask, so the gate is the card rather than a remembered verdict.
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: { threadId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
        pendingEngineOps: {},
      });
    });
    const held = await browser.executeAsync((done) => {
      const store = window.__cdCodingAgentStore.getState();
      const requestId = "workspace-approval-1";
      void store
        .handleHostRequest({
          type: "host_request",
          requestId,
          method: "workspace_op",
          payload: { op: "execCommand", args: { program: "rm", args: ["-rf", "build"] } },
        })
        .then(() => {
          const state = window.__cdCodingAgentStore.getState();
          done({
            held: !!state.pendingEngineOps[requestId],
            op: state.pendingEngineOps[requestId]?.op,
            timeline: state.view.timeline.map((item) => item.kind),
          });
        });
    });
    assert.equal(held.held, true, "a workspace mutation ran without asking");
    assert.equal(held.op, "execCommand");
    assert.ok(held.timeline.includes("approval"), `no approval card in the timeline: ${held.timeline.join(", ")}`);
  });
});
