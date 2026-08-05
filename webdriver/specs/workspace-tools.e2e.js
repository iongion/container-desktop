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
    const written = await call("writeFile", { path: "notes/plan.md", contents: "a plan in the container" });
    assert.equal(written.threw, false, `runWorkspaceOp threw: ${written.error}`);
    assert.deepEqual(written.result, { ok: true, value: { path: "notes/plan.md", written: true } });

    const read = await call("readFile", { path: "notes/plan.md" });
    // The read went to the SAME backend: the selector is memoized per run, so one sandbox served both calls.
    assert.deepEqual(read.result, { ok: true, value: "a plan in the container" });
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
    // A target is a container; the connection chosen above is how it is reached, never a target of its own.
    assert.deepEqual(
      offered.options.map((option) => option.value),
      ["off", "container", "sandbox"],
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
    // Existing is not rendered: the field mounts, then React fills it from the kind. Wait for the image copy and
    // for the form to have said what is missing, or the read below races the cycle that produces both.
    await browser.waitUntil(
      async () =>
        !!(await browser.execute(
          () =>
            /Pick an image/.test(document.querySelector("#agentExecutionRef")?.placeholder ?? "") &&
            Array.from(document.querySelectorAll(".AgentStartProblems div")).some((line) =>
              /Name the container the tools run in/.test(line.textContent ?? ""),
            ),
        )),
      { timeout: 10000, timeoutMsg: "the sandbox target never asked for an image and said what was missing" },
    );
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
    assert.match(sandbox.placeholder ?? "", /Pick an image, or type a reference/);

    // The picker is the point: a container is named by choosing one the CONNECTION actually runs, not by
    // remembering it. Rows carry the image and the short id, because that is what tells two apart.
    await browser.execute(() => {
      const select = document.querySelector("#agentExecutionKind");
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, "container");
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // The field is the SAME element the sandbox step left behind, so its existence proves nothing here: wait for
    // the container kind to have actually re-rendered it before reading or clicking it.
    await browser.waitUntil(
      async () =>
        /Pick a running container/.test(
          (await browser.execute(() => document.querySelector("#agentExecutionRef")?.placeholder)) ?? "",
        ),
      { timeout: 10000, timeoutMsg: "a container target never asked for a container" },
    );
    await $("#agentExecutionRef").click();
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelectorAll(".ExecutionTargetOptionName").length)) > 0,
      { timeout: 15000, timeoutMsg: "the picker never offered a running container on this connection" },
    );
    const picker = await browser.execute(() => ({
      placeholder: document.querySelector("#agentExecutionRef")?.placeholder,
      rows: Array.from(document.querySelectorAll(".ExecutionTargetOption")).map((row) => ({
        name: row.querySelector(".ExecutionTargetOptionName")?.textContent ?? "",
        meta: row.querySelector(".ExecutionTargetOptionMeta")?.textContent ?? "",
      })),
    }));
    assert.match(picker.placeholder ?? "", /Pick a running container, or type a name or id/);
    assert.ok(picker.rows.length > 0, "the picker offered nothing");
    for (const row of picker.rows) {
      assert.ok(row.name.length > 0, `a picker row had no name: ${JSON.stringify(row)}`);
      assert.match(row.meta, /[0-9a-f]{12}/, `a picker row did not carry a short id: ${JSON.stringify(row)}`);
    }

    // And a name the list has not seen is still accepted — a container can be started between filling this in and
    // starting the session, so the picker must never be the only way to name one.
    const typed = `never-listed-${Date.now().toString(36)}`;
    await browser.keys(typed);
    await browser.waitUntil(
      async () =>
        !!(await browser.execute(
          (value) =>
            Array.from(document.querySelectorAll(".bp6-menu-item")).some((item) =>
              (item.textContent ?? "").includes(`Use "${value}"`),
            ),
          typed,
        )),
      { timeout: 10000, timeoutMsg: "the picker refused a reference it had not listed" },
    );
    await browser.keys("Enter");
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelector("#agentExecutionRef")?.value)) === typed,
      { timeout: 10000, timeoutMsg: "the typed reference never reached the field" },
    );
    const committed = await browser.execute(() => ({
      value: document.querySelector("#agentExecutionRef")?.value,
      problems: Array.from(document.querySelectorAll(".AgentStartProblems div")).map((line) => line.textContent),
    }));
    assert.equal(committed.value, typed, "the typed reference did not reach the field");
    assert.ok(
      !committed.problems.some((line) => /Name the container the tools run in/.test(line ?? "")),
      `the form still complained after a reference was named: ${JSON.stringify(committed.problems)}`,
    );
    // Nothing named yet, so the form refuses to start rather than starting a session whose every call would fail.
    assert.equal(sandbox.submitDisabled, true);
    assert.ok(
      sandbox.problems.some((line) => /Name the container the tools run in/.test(line ?? "")),
      `the form did not say what it was missing: ${JSON.stringify(sandbox.problems)}`,
    );
  });

  // The knowledge search asks the app for NOTHING — its entries ship inside the agent image — so what proves it in
  // the renderer is the card: a tool the session answered itself, titled and rendered like any other.
  it("renders a knowledge search the session answered itself", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
      });
      const store = window.__cdCodingAgentStore.getState();
      store.applyBridgeEvent({
        type: "tool_start",
        toolCallId: "knowledge-1",
        toolName: "searchKnowledge",
        args: { query: "cannot connect to podman socket" },
      });
      store.applyBridgeEvent({
        type: "tool_end",
        toolCallId: "knowledge-1",
        toolName: "searchKnowledge",
        isError: false,
        text: "## Rootless Podman API socket not available (podman-rootless-socket, podman)\nSolution: Enable the user API service.",
        // The shape the real tool answers with: a count and the entries, which is what the card has to render.
        details: {
          matches: 1,
          entries: [
            {
              id: "podman-rootless-socket",
              domain: "podman",
              title: "Rootless Podman API socket not available",
              symptom: "Cannot connect to the Podman socket",
              solution: "Enable the user API service",
              commands: ["systemctl --user enable --now podman.socket"],
            },
          ],
        },
      });
      store.applyBridgeEvent({ type: "idle" });
    });
    // A tool card opens closed, so what the user sees first is the title. Read that, then open it the way they would.
    const closed = await browser.execute(() => {
      const card = document.querySelector(".AICard");
      return {
        count: document.querySelectorAll(".AICard").length,
        title: card?.querySelector(".AICardTitle")?.textContent ?? "",
        expanded: card?.querySelector(".AICardHead")?.getAttribute("aria-expanded") ?? "",
      };
    });
    assert.equal(closed.count, 1, "the knowledge search rendered nothing at all");
    assert.equal(closed.title, "Search knowledge", "the card did not carry the app's own title for the tool");
    assert.equal(closed.expanded, "false");

    await browser.execute(() => {
      document.querySelector(".AICard .AICardHead")?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          (document.querySelector(".AICard .bp6-collapse-body")?.textContent ?? "").includes(
            "Rootless Podman API socket",
          ),
        ),
      { timeout: 10000, timeoutMsg: "the entry the tool found was never rendered in the opened card" },
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
        view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
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
