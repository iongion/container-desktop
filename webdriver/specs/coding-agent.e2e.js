// Verifies the Coding Agent screen renders and its store is wired: the route mounts, the composer is
// disabled until a session is ready, and a projected transcript reaches the DOM. The container session
// itself is covered end-to-end elsewhere; this spec is about the screen.
import { strict as assert } from "node:assert";

const ROUTE = "#/screens/ai/coding-agent";

// The app boots asynchronously (preload bridge, mock backend, router), so poll for the screen rather
// than pausing a fixed amount — a fixed wait is what makes a spec pass locally and flake in CI.
async function navigate(route) {
  await browser.execute((hash) => {
    window.location.hash = hash;
  }, route);
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(document.querySelector('[data-screen="ai.codingAgent"]'))),
    { timeout: 45000, interval: 500, timeoutMsg: `the Coding Agent screen never mounted at ${route}` },
  );
}

describe("Coding Agent screen", () => {
  it("mounts at its route with the status bar and a disabled composer", async () => {
    await navigate(ROUTE);

    const screen = await browser.execute(() => {
      const root = document.querySelector('[data-screen="ai.codingAgent"]');
      if (!root) return { mounted: false };
      const composer = root.querySelector(".CodingAgentComposer");
      return {
        mounted: true,
        status: root.querySelector(".CodingAgentStatus")?.textContent?.trim(),
        composerDisabled: composer ? composer.disabled : null,
        hasTranscript: Boolean(root.querySelector(".CodingAgentTranscript")),
      };
    });

    assert.equal(screen.mounted, true, "the screen did not mount at its route");
    assert.equal(screen.status, "idle", "a fresh screen should report idle");
    assert.equal(screen.composerDisabled, true, "the composer must stay disabled until a session is ready");
    assert.equal(screen.hasTranscript, true, "the transcript region is missing");
  });

  it("renders assistant, tool and error items from the projected transcript", async () => {
    await navigate(ROUTE);

    // Drive the store directly: this asserts the screen renders what the reducer produces, without
    // requiring a live container session.
    const rendered = await browser.execute(() => {
      window.__cdErrors = [];
      window.addEventListener("error", (event) => {
        window.__cdErrors.push(`${event.message} :: ${String(event.error?.stack ?? "").slice(0, 600)}`);
      });
      const store = window.__cdCodingAgentStore;
      if (!store) return { store: false };
      store.setState({
        status: "ready",
        items: [
          { kind: "user", id: "u1", text: "hello agent" },
          { kind: "assistant", id: "a1", text: "PI-GUI-OK", streaming: false },
          {
            kind: "tool",
            id: "t1",
            toolCallId: "c1",
            toolName: "bash",
            args: { command: "ls" },
            output: "README.md",
            state: "ok",
          },
          { kind: "error", id: "e1", message: "boom" },
        ],
      });
      return { store: true };
    });
    assert.equal(rendered.store, true, "the dev store handle was not exposed");
    await browser.pause(600);

    // Read through WebDriver element queries rather than browser.execute: evaluating script right after
    // this state change proved unreliable under WebKitWebDriver, and element queries assert the same DOM.
    const messages = await $$(".CodingAgentMessage").map((node) => node.getText());
    const toolName = await $(".CodingAgentToolName").getText();
    const toolOutput = await $(".CodingAgentToolOutput").getText();
    const toolState = await $(".CodingAgentTool").getAttribute("data-state");
    const errorText = await $(".CodingAgentError").getText();
    const composerDisabled = !(await $(".CodingAgentComposer").isEnabled());
    const status = await $(".CodingAgentStatus").getText();

    assert.deepEqual(messages, ["hello agent", "PI-GUI-OK"], "user and assistant text did not render");
    assert.equal(toolName, "bash");
    assert.equal(toolOutput, "README.md");
    assert.equal(toolState, "ok");
    assert.equal(errorText, "boom");
    // getText() returns RENDERED text and the status chip is uppercased by --app theme styling, so compare
    // case-insensitively rather than encoding the CSS transform into the assertion.
    assert.equal(status.toLowerCase(), "ready");
    assert.equal(composerDisabled, false, "the composer should enable once the session is ready");

    await browser.saveScreenshot("/tmp/coding-agent-transcript.png");
  });

  it("takes its colours from the app theme tokens rather than hardcoded values", async () => {
    await navigate(ROUTE);
    const styling = await browser.execute(() => {
      const root = document.querySelector('[data-screen="ai.codingAgent"]');
      const bar = root?.querySelector(".CodingAgentBar");
      if (!bar) return { barBackground: null, surfaceToken: "" };
      const surface = getComputedStyle(document.documentElement).getPropertyValue("--app-surface").trim();
      return { barBackground: getComputedStyle(bar).backgroundColor, surfaceToken: surface };
    });
    assert.ok(styling.surfaceToken.length > 0, "--app-surface token is not defined");
    assert.ok(styling.barBackground && styling.barBackground !== "rgba(0, 0, 0, 0)", "the bar has no themed surface");
  });
});

describe("Coding Agent error item", () => {
  it("renders an error transcript item without crashing the renderer", async () => {
    await navigate(ROUTE);
    await browser.execute(() => {
      window.__cdErrors = [];
      window.addEventListener("error", (event) => {
        window.__cdErrors.push(`${event.message} :: ${String(event.error?.stack ?? "").slice(0, 500)}`);
      });
      window.__cdCodingAgentStore.setState({
        status: "ready",
        items: [{ kind: "error", id: "e1", message: "boom" }],
      });
    });
    await browser.pause(800);
    // The pending page exception is delivered to the next evaluation, so absorb it and then read the trap.
    try {
      await browser.execute(() => true);
    } catch {
      /* expected while a page error is pending */
    }
    const captured = await browser.execute(() => window.__cdErrors ?? []);
    const rendered = await browser.execute(
      () => document.querySelector('[data-screen="ai.codingAgent"] .CodingAgentError')?.textContent ?? null,
    );
    assert.equal(captured.length, 0, `renderer threw while rendering an error item:\n${captured.join("\n")}`);
    assert.equal(rendered, "boom", "the error item did not render");
  });
});
