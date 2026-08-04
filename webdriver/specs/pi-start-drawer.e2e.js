import { strict as assert } from "node:assert";

// Verifies the Coding Agent's session-start UI on the real renderer: the empty state and its Start CTA, the
// start drawer (connection, workspace folder, the shared ModelPicker, egress), the refusals that keep a
// half-filled form from starting anything, the options the form resolves, and the session summary the screen
// shows once a session is up. Starting a real container pair is covered by the live specs; this covers what
// only the app can answer.
//
// Everything goes into ONE session, read back as DOM snapshots, with ONE saveScreenshot per run (a command
// after a second one hangs and takes the session with it).

const WORKSPACE = "/var/data/agent-space";

let idle = {};
let opened = {};
let blank = {};
let filled = {};
let started = {};
let ready = {};

describe("pi coding agent session start", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/coding-agent";
    });
    await $('[data-screen="ai.codingAgent"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Coding Agent screen never mounted",
    });

    // The mock app boots WITH a scripted session, so "no session" is something to arrange rather than assume.
    await browser.execute(() => {
      window.__cdOriginalStart = window.__cdCodingAgentStore.getState().start;
      window.__cdCodingAgentStore.setState({
        client: undefined,
        status: "idle",
        spec: undefined,
        connectionId: undefined,
        error: undefined,
        startLog: [],
      });
    });
    await $(".CodingAgentEmptyState").waitForExist({
      timeout: 15000,
      timeoutMsg: "the empty state never appeared after the session was dropped",
    });

    idle = await browser.execute(() => ({
      nonIdeal: document.querySelector(".bp6-non-ideal-state-visual") !== null,
      title: document.querySelector(".bp6-non-ideal-state .bp6-heading")?.textContent ?? "",
      ctas: Array.from(document.querySelectorAll(".ResourceListActionButton")).map((button) => button.textContent ?? ""),
      // Nothing to stop when nothing runs, so the "…" utility menu must be absent.
      utility: document.querySelectorAll('.ResourceListUtilityActions svg[data-icon="more"]').length,
      reload: document.querySelectorAll(".ResourceListActionsReload").length,
      tabs: Array.from(document.querySelectorAll(".AISectionTabBar a")).map((anchor) => ({
        text: anchor.textContent ?? "",
        active: anchor.classList.contains("bp6-active"),
      })),
      drawer: document.querySelector(".AppStartAgentSessionDrawer") !== null,
    }));

    await browser.execute(() => {
      Array.from(document.querySelectorAll(".ResourceListActionButton"))
        .find((button) => (button.textContent ?? "").includes("Start session"))
        ?.click();
    });
    await $(".AppStartAgentSessionDrawer #agentWorkspacePath").waitForExist({
      timeout: 15000,
      timeoutMsg: "the start drawer never opened",
    });
    // The picker resolves its label from discovery, which answers asynchronously in the mock too.
    await browser.pause(600);

    const drawerState = () => {
      const drawer = document.querySelector(".AppStartAgentSessionDrawer");
      const submit = drawer?.querySelector('.bp6-dialog-body button[type="submit"]');
      return {
        title: drawer?.querySelector(".AppDrawerHeaderTitle")?.textContent ?? "",
        position: drawer?.classList.contains("bp6-position-right") ?? false,
        connection: drawer?.querySelector(".ConnectionSelectButton")?.textContent ?? "",
        workspace: drawer?.querySelector("#agentWorkspacePath")?.value ?? "",
        browse: drawer?.querySelector('#agentWorkspacePath ~ .bp6-input-action svg[data-icon="folder-open"]') !== null,
        model: drawer?.querySelector(".ModelPickerTriggerLabel")?.textContent ?? "",
        egress: drawer?.querySelector(".bp6-switch input")?.checked ?? false,
        submitText: submit?.textContent ?? "",
        submitDisabled: submit?.hasAttribute("disabled") ?? true,
        // The header carries the same submit, bound to the form by id.
        headerSubmit: drawer?.querySelector('.AppDrawerHeaderActions button[type="submit"]') !== null,
        problems: Array.from(drawer?.querySelectorAll(".AgentStartProblems div") ?? []).map(
          (line) => line.textContent ?? "",
        ),
        imageNote: drawer?.querySelector(".AgentStartImageNote")?.textContent ?? "",
      };
    };
    opened = await browser.execute(drawerState);

    const typeWorkspace = async (value) => {
      await browser.execute((text) => {
        const input = document.querySelector(".AppStartAgentSessionDrawer #agentWorkspacePath");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, text);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await browser.pause(300);
    };

    // A workspace is the only thing the agent may touch, so an empty one has to refuse — with a reason.
    await typeWorkspace("");
    blank = await browser.execute(drawerState);

    await typeWorkspace(WORKSPACE);
    filled = await browser.execute(drawerState);

    // The one screenshot this session allows goes on the drawer — the surface this spec exists for. Every
    // later state is read back through the DOM instead.
    await browser.saveScreenshot(process.env.PI_START_DRAWER_SHOT || "/tmp/pi-start-drawer.png");

    // Record what the form resolves instead of starting a real container pair.
    await browser.execute(() => {
      window.__cdStartCalls = [];
      window.__cdCodingAgentStore.setState({
        start: async (options) => {
          window.__cdStartCalls.push(options);
        },
      });
    });
    await browser.execute(() => {
      document.querySelector('.AppStartAgentSessionDrawer .bp6-dialog-body button[type="submit"]')?.click();
    });
    await browser.pause(600);
    started = await browser.execute(() => ({ calls: window.__cdStartCalls }));

    // A ready session takes the screen: the drawer closes and the form collapses into the summary bar.
    await browser.execute((workspace) => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        spec: { workspacePath: workspace, modelId: "mock-assistant", agentContainerName: "cd-agent-spec01" },
      });
    }, WORKSPACE);
    await $(".CodingAgentBar").waitForExist({
      timeout: 15000,
      timeoutMsg: "the session bar never appeared for a ready session",
    });
    await browser.pause(300);
    ready = await browser.execute(() => ({
      drawer: document.querySelector(".AppStartAgentSessionDrawer") !== null,
      workspace: document.querySelector(".CodingAgentWorkspace")?.textContent ?? "",
      model: document.querySelector(".CodingAgentModel")?.textContent ?? "",
      container: document.querySelector(".CodingAgentContainer")?.textContent ?? "",
      dot: document.querySelector(".CodingAgentStatusDot") !== null,
      ctas: Array.from(document.querySelectorAll(".ResourceListActionButton")).map((button) => button.textContent ?? ""),
      utility: document.querySelectorAll('.ResourceListUtilityActions svg[data-icon="more"]').length,
      composer: document.querySelector(".CodingAgentComposer") !== null,
      emptyState: document.querySelector(".CodingAgentEmptyState") !== null,
    }));

    await browser.execute(() => {
      if (window.__cdOriginalStart) window.__cdCodingAgentStore.setState({ start: window.__cdOriginalStart });
    });
  });

  it("offers an empty state and a Start CTA when no session is running", () => {
    assert.ok(idle.nonIdeal, "the empty state must be shown");
    assert.equal(idle.title, "No coding agent session");
    assert.ok(
      idle.ctas.some((text) => text.includes("Start session")),
      `the Start CTA must be in the header, got ${JSON.stringify(idle.ctas)}`,
    );
    assert.equal(idle.utility, 0, "there is nothing to stop, so no utility menu");
    assert.equal(idle.reload, 1, "the header keeps its reload button");
    assert.equal(idle.drawer, false, "the drawer opens on demand, not on mount");
    assert.ok(
      idle.tabs.some((tab) => tab.text.includes("Coding Agent") && tab.active),
      "the section tab bar must mark this screen active",
    );
  });

  it("opens the form in a right-hand drawer with the app's own controls", () => {
    assert.equal(opened.title, "Start a coding agent session");
    assert.ok(opened.position, "the drawer must come from the right, like every other form drawer");
    assert.ok(opened.connection.length > 0, "the ConnectionSelect must offer a connected engine");
    assert.ok(opened.browse, "the workspace field must offer the folder picker");
    assert.ok(opened.model.length > 0, `the shared ModelPicker must show a selection, got "${opened.model}"`);
    assert.ok(opened.egress, "egress is allowed by default");
    assert.ok(opened.submitText.includes("Start session"), "the form's own submit is last");
    assert.ok(opened.headerSubmit, "the drawer header carries the same submit");
    assert.ok(opened.imageNote.includes("pi-agent"), "the image that has to build is named");
  });

  it("refuses to start without a workspace folder, and says why", () => {
    assert.equal(blank.workspace, "");
    assert.ok(blank.submitDisabled, "an empty workspace cannot start a session");
    assert.ok(
      blank.problems.some((text) => text.includes("folder")),
      `the reason must name the folder, got ${JSON.stringify(blank.problems)}`,
    );
  });

  it("enables the start once the form is complete", () => {
    assert.equal(filled.workspace, WORKSPACE);
    assert.equal(filled.submitDisabled, false, "a complete form must be startable");
    assert.deepEqual(filled.problems, [], "a complete form has nothing to complain about");
  });

  it("resolves the form into the session's start options", () => {
    assert.equal(started.calls.length, 1, "submitting must start exactly one session");
    const [options] = started.calls;
    assert.equal(options.workspacePath, WORKSPACE);
    assert.equal(options.egress, true);
    assert.ok(options.connectionId, "a connection must be chosen");
    assert.ok(options.modelId, "a model must be chosen");
    assert.ok(options.upstreamBaseUrl.startsWith("http"), "the gateway needs an endpoint to dial");
    assert.ok(options.providerId, "the inference source must be recorded");
    assert.equal(options.upstreamApiKey, "", "the provider key must never come from the renderer");
    // The gateway signs the upstream from these, and pi speaks the shape they imply. An endpoint without them
    // is silently assumed to be OpenAI-shaped and bearer-authenticated, which Anthropic is not.
    assert.ok(options.providerKind, "the provider's wire shape must travel with the endpoint");
    assert.ok(options.upstreamAuth?.scheme, "the provider's credential shape must travel with the endpoint");
  });

  it("collapses into the session summary once the session is ready", () => {
    assert.equal(ready.drawer, false, "a ready session closes the form");
    assert.equal(ready.emptyState, false, "the empty state gives way to the transcript");
    assert.ok(ready.dot, "the summary shows the session is up");
    assert.equal(ready.workspace, WORKSPACE);
    assert.equal(ready.model, "mock-assistant");
    assert.equal(ready.container, "cd-agent-spec01");
    assert.ok(ready.composer, "a ready session has a composer");
    assert.equal(
      ready.ctas.some((text) => text.includes("Start session")),
      false,
      "a running session has nothing to start",
    );
    assert.equal(ready.utility, 1, "a running session can be stopped from the utility menu");
  });
});
