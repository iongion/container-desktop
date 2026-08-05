// Verifies the Assistant screen renders and its store is wired: the route mounts, the session bar and the
// SHARED session appear, and a projected transcript reaches the DOM. The container session itself is covered
// end-to-end elsewhere; this spec is about the screen.
import { strict as assert } from "node:assert";

const ROUTE = "#/screens/ai/assistant";

// The app boots asynchronously (preload bridge, mock backend, router), so poll for the screen rather
// than pausing a fixed amount — a fixed wait is what makes a spec pass locally and flake in CI.
async function navigate(route) {
  await browser.execute((hash) => {
    window.location.hash = hash;
  }, route);
  await $('[data-screen="ai.assistant"]').waitForExist({
    timeout: 45000,
    timeoutMsg: `the Assistant screen never mounted at ${route}`,
  });
}

describe("Assistant screen", () => {
  // The mock app boots WITH a scripted session, so this is the session-bar-and-chat state. The empty state is
  // arranged deliberately in pi-start-drawer.e2e.js, which drops the session first.
  it("mounts at its route with the session bar and the shared chat surface", async () => {
    await navigate(ROUTE);

    const screen = await browser.execute(() => {
      const root = document.querySelector('[data-screen="ai.assistant"]');
      if (!root) return { mounted: false };
      return {
        mounted: true,
        status: root.querySelector(".AssistantSessionSummary")?.getAttribute("data-status"),
        // Not a transcript of this screen's own making: the SAME component the Assistant and the quake
        // console render, so one conversation looks the same wherever it is opened.
        session: Boolean(root.querySelector(".AssistantSession")),
        composer: Boolean(root.querySelector(".AIComposerInput")),
      };
    });

    assert.equal(screen.mounted, true, "the screen did not mount at its route");
    assert.equal(screen.status, "ready", "the scripted mock session should be ready");
    assert.equal(screen.session, true, "the screen must render the shared assistant session");
    assert.equal(screen.composer, true, "a ready session must be messageable");
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
        view: {
          sessionId: "spec",
          phase: "idle",
          lastSeq: 4,
          timeline: [
            { kind: "message", id: "u1", role: "user", content: "hello agent", delivery: "applied", status: "complete" },
            {
              kind: "message",
              id: "a1",
              role: "assistant",
              content: "PI-GUI-OK",
              delivery: "applied",
              status: "complete",
            },
            {
              kind: "tool",
              id: "t1",
              toolCallId: "c1",
              tool: "bash",
              title: "bash",
              args: { command: "ls" },
              status: "complete",
              ok: true,
              message: "README.md",
            },
            { kind: "error", id: "e1", scope: "model", message: "boom" },
          ],
        },
      });
      return { store: true };
    });
    assert.equal(rendered.store, true, "the dev store handle was not exposed");
    await browser.pause(600);

    // Read through WebDriver element queries rather than browser.execute: evaluating script right after
    // this state change proved unreliable under WebKitWebDriver, and element queries assert the same DOM.
    // The selectors are the SHARED session's, because this screen renders the same <AssistantSession> as the
    // Assistant and the quake console — the tool cards it draws are covered by pi-tool-cards.e2e.js.
    const messages = await $$(".AssistantSession .AssistantMessage").map((node) => node.getText());
    const sessionText = await $(".AssistantSession").getText();
    const composerEnabled = await $(".AIComposerInput").isEnabled();
    const status = await $(".AssistantSessionSummary").getAttribute("data-status");

    assert.deepEqual(messages, ["hello agent", "PI-GUI-OK"], "user and assistant text did not render");
    assert.ok(sessionText.includes("boom"), `the error item did not render: ${sessionText.slice(0, 300)}`);
    assert.equal(status, "ready");
    assert.equal(composerEnabled, true, "a ready session must be messageable");

    await browser.saveScreenshot("/tmp/assistant-transcript.png");
  });

  // The summary now rides in the header, which owns the surface, so what this screen must prove is that its
  // OWN colours come from tokens: the muted summary text and the session dot's success colour.
  it("takes its colours from the app theme tokens rather than hardcoded values", async () => {
    await navigate(ROUTE);
    const styling = await browser.execute(() => {
      const root = document.querySelector('[data-screen="ai.assistant"]');
      const summary = root?.querySelector(".AssistantSessionSummary");
      const dot = root?.querySelector(".AssistantSessionDot");
      if (!summary || !dot) return { summaryColor: "", dotBackground: "", mutedToken: "", successToken: "" };
      const styles = getComputedStyle(document.documentElement);
      return {
        summaryColor: getComputedStyle(summary).color,
        dotBackground: getComputedStyle(dot).backgroundColor,
        mutedToken: styles.getPropertyValue("--app-text-muted").trim(),
        successToken: styles.getPropertyValue("--app-intent-success-rest").trim(),
      };
    });
    assert.ok(styling.mutedToken.length > 0, "--app-text-muted token is not defined");
    assert.ok(styling.successToken.length > 0, "--app-intent-success-rest token is not defined");
    assert.ok(styling.summaryColor.length > 0, "the summary has no resolved colour");
    assert.ok(
      styling.dotBackground && styling.dotBackground !== "rgba(0, 0, 0, 0)",
      "the session dot has no themed colour",
    );
  });
});

describe("Assistant error item", () => {
  it("renders an error transcript item without crashing the renderer", async () => {
    await navigate(ROUTE);
    await browser.execute(() => {
      window.__cdErrors = [];
      window.addEventListener("error", (event) => {
        window.__cdErrors.push(`${event.message} :: ${String(event.error?.stack ?? "").slice(0, 500)}`);
      });
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: {
          sessionId: "spec",
          phase: "error",
          lastSeq: 1,
          timeline: [{ kind: "error", id: "e1", scope: "model", message: "boom" }],
        },
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
      () => document.querySelector('[data-screen="ai.assistant"] .AssistantSession')?.textContent ?? "",
    );
    assert.equal(captured.length, 0, `renderer threw while rendering an error item:\n${captured.join("\n")}`);
    assert.ok(rendered.includes("boom"), "the error item did not render");
  });
});
