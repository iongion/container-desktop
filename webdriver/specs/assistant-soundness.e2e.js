// Every surface this unit made honest, driven in the running app.
//
// The mock session is the far end of the socket, so the RENDERER runs its production path: it composes the project
// context, publishes it, performs the web search, projects the usage and context reports, and offers pi's own
// commands. What the container does with them is covered hermetically (session.test.ts drives a real pi session).

import { strict as assert } from "node:assert";
import path from "node:path";

const READY_TIMEOUT = 30000;

// The harness pre-seeds this folder as the workspace fixture and points ai.workspaceRoot at it. The SESSION is
// started on the same folder here, which is what makes the host-side project reads answer for the agent.
const WORKSPACE = path.join(
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data"),
  "workspace-fixture",
);

async function waitForStore() {
  await browser.waitUntil(async () => await browser.execute(() => !!window.__cdCodingAgentStore), {
    timeout: READY_TIMEOUT,
    timeoutMsg: "the coding agent store never appeared",
  });
}

// A turn is over when the session says it is idle, which is also when the reports have been published.
async function waitForIdle() {
  await browser.waitUntil(
    async () => await browser.execute(() => window.__cdCodingAgentStore.getState().view.phase === "idle"),
    { timeout: READY_TIMEOUT, timeoutMsg: "the turn never went idle" },
  );
}

describe("the assistant tells the truth about its session", () => {
  before(async () => {
    await waitForStore();
    // Start a session on the workspace fixture. The mock app boots with a scripted one whose workspace is a
    // placeholder, and since host-side reads now follow the SESSION's folder, that placeholder is what a project
    // read would answer for.
    await browser.execute(async (workspacePath) => {
      const store = window.__cdCodingAgentStore.getState();
      await store.stop();
      await window.__cdCodingAgentStore.getState().start({
        connectionId: "mock",
        workspacePath,
        modelId: "mock-assistant",
        upstreamBaseUrl: "http://127.0.0.1:1234/v1",
        appVersion: "0.0.0",
      });
    }, WORKSPACE);
    await browser.waitUntil(
      async () => await browser.execute(() => window.__cdCodingAgentStore.getState().status === "ready"),
      { timeout: READY_TIMEOUT, timeoutMsg: "the mock session never became ready" },
    );
  });

  // Phase 1.2, live: the app used to read whatever Settings named, which is a different folder from the one the
  // container mounted whenever the user picked one in the start drawer.
  it("reads the project from the folder the SESSION mounted", async () => {
    const answer = await browser.execute(async () => {
      const snapshot = await window.AI.getProjectContext();
      return {
        state: snapshot.state,
        workspaceRoot: snapshot.state === "ready" ? snapshot.workspaceRoot : undefined,
        sessionPath: window.__cdCodingAgentStore.getState().spec.workspacePath,
      };
    });
    assert.equal(answer.state, "ready");
    assert.equal(answer.workspaceRoot, answer.sessionPath);
  });

  it("gives the agent the project's rules and memories, and treats them as untrusted", async () => {
    const token = `SENTINEL-${Date.now()}`;
    const answer = await browser.execute(async (memory) => {
      await window.AI.clearProjectMemory().catch(() => undefined);
      await window.AI.addProjectMemory(`Always mention ${memory}.`);
      await window.__cdCodingAgentStore.getState().submit("what are the project rules?");
      // Re-read AFTER the submit: the store hands out immutable snapshots, so the one captured before it still
      // carries the context this turn had not been given yet.
      const published = window.__cdCodingAgentStore.getState().systemContext;
      return { text: published ? published.text : "", tainted: published ? published.tainted : false };
    }, token);

    // Published BEFORE the turn: the store records only what the session accepted.
    assert.ok(String(answer.text).includes(token), `expected to contain ${token}`);
    // Project prose is content the app did not author, so the turn carrying it cannot ride a remembered allow.
    assert.equal(answer.tainted, true);

    await waitForIdle();
    // The session can only quote back what actually reached it.
    const transcript = await browser.execute(() =>
      window.__cdCodingAgentStore
        .getState()
        .view.timeline.filter((item) => item.kind === "message" && item.role === "assistant")
        .map((item) => item.content)
        .join("\n"),
    );
    assert.ok(String(transcript).includes(token), `expected to contain ${token}`);
  });

  it("populates the usage and context panels from what the session reported", async () => {
    // Its own turn: a test that leans on the previous one's reports fails for whatever reason that one did.
    await browser.execute(async () => {
      await window.__cdCodingAgentStore.getState().submit("how many containers are running?");
    });
    await waitForIdle();
    const view = await browser.execute(() => {
      const state = window.__cdCodingAgentStore.getState();
      return { usage: state.view.usage, context: state.view.context };
    });
    assert.ok(view.usage.requests > 0, "expected a value greater than 0");
    assert.ok(view.usage.outputTokens > 0, "expected a value greater than 0");
    // The drawer used to say "No tools offered to the model" for a session that had just used one.
    assert.ok(view.context.tools.length > 0, "expected a value greater than 0");
    assert.ok(view.context.totals.estimatedTokens > 0, "expected a value greater than 0");
    // The app's own policy, applied to what pi reported: a mutation is gated, a read is not.
    const gated = view.context.tools.filter((tool) => tool.gated).map((tool) => tool.name);
    assert.ok(String(gated).includes("restartContainer"), `expected to contain ${"restartContainer"}`);
    assert.ok(!gated.includes("listContainers"), `expected not to contain ${"listContainers"}`);
    // The project memory the app injected shows up as a source, itemised — the session only ever saw the prose.
    assert.equal(view.context.sources.some((source) => source.kind === "memory"), true);
  });

  it("runs a web search for the agent, and refuses it when the user has it turned off", async () => {
    const refused = await browser.execute(async () => {
      const store = window.__cdCodingAgentStore.getState();
      const answers = [];
      const unsubscribe = store.client.onEvent((event) => {
        if (event.type === "tool_end") answers.push({ isError: event.isError, text: event.text });
      });
      await store.submit("search the web for podman rootless");
      await new Promise((resolve) => setTimeout(resolve, 2500));
      unsubscribe();
      return answers;
    });
    assert.ok(refused.length > 0, "expected a value greater than 0");
    // Default settings leave web search off, so the model gets the reason rather than silence.
    assert.equal(refused[0].isError, true);
    assert.match(refused[0].text, /turned off|unavailable/i);
  });

  it("offers pi's own commands under pi's own names, and explains the ones it cannot honour", async () => {
    const commands = await browser.execute(() => {
      const resources = window.__cdCodingAgentStore.getState().resources;
      return resources.builtins.map((builtin) => ({ name: builtin.name, runsIn: builtin.runsIn }));
    });
    assert.ok(String(commands.map((command) => command.name)).includes("compact"), `expected to contain ${"compact"}`);
    // `/login` is one the APP performs: it runs pi's own flow in a one-shot container and stores what comes back, so
    // the session reports it as the app's rather than as something nothing here can honour.
    const login = commands.find((command) => command.name === "login");
    assert.equal(login.runsIn, "app");
    // And pi's session-venue commands are still reported as pi's own.
    const compact = commands.find((command) => command.name === "compact");
    assert.equal(compact.runsIn, "session");
  });

  it("runs one of pi's own commands against the session", async () => {
    const result = await browser.execute(async () => {
      return await window.__cdCodingAgentStore.getState().runPiCommand("compact", "keep the decisions");
    });
    assert.equal(result.ok, true);
  });

  it("asks the session itself whether it can reach the model", async () => {
    const check = await browser.execute(
      async () => await window.__cdCodingAgentStore.getState().checkSessionProvider(),
    );
    assert.equal(check.reachable, true);
  });
});
