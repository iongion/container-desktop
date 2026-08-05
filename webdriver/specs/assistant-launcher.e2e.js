// The assistant's empty state IS its bootstrap, so the thing a user meets first has to be the thing under test: a
// row per connection, a verb that follows its state, and what that session may do stated on the row.

import { strict as assert } from "node:assert";

const SCREEN = '[data-screen="ai.assistant"]';
const READY_TIMEOUT = 45000;

describe("assistant launcher", () => {
  let seen = {};

  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    // The mock app comes up with a session already running, which is the state the launcher is deliberately absent
    // in. Its subject is the app with nothing to talk to, so the spec arranges that rather than asserting into it.
    await $(`${SCREEN} .AIComposerInput`).waitForExist({ timeout: READY_TIMEOUT });
    await browser.executeAsync((done) => {
      const store = window.__cdCodingAgentStore;
      if (!store) {
        done(false);
        return;
      }
      store
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    });
    await $(`${SCREEN} .AssistantLauncher`).waitForExist({
      timeout: READY_TIMEOUT,
      timeoutMsg: "the launcher never appeared — the assistant's empty state did not render",
    });
    await browser.waitUntil(
      async () => (await $$(`${SCREEN} .AssistantLauncherRow`)).length > 0,
      { timeout: READY_TIMEOUT, timeoutMsg: "the launcher offered nothing to start" },
    );
    seen = await browser.execute((selector) => {
      const text = (node) => (node?.textContent ?? "").trim();
      return {
        heading: text(document.querySelector(`${selector} .AssistantLauncher h2`)),
        rows: Array.from(document.querySelectorAll(`${selector} .AssistantLauncherRow`)).map((row) => ({
          name: text(row.querySelector(".AssistantLauncherTitle strong")),
          badge: text(row.querySelector(".AssistantLauncherBadge")),
          where: text(row.querySelector(".AssistantLauncherWhere span:last-child")),
          can: Array.from(row.querySelectorAll(".AssistantLauncherCan > span")).map(text),
          action: text(row.querySelector(".bp6-button")),
          primary: row.dataset.primary === "yes",
          engine: row.querySelector(".AssistantLauncherEngine")?.dataset.engineMarker ?? "",
        })),
        // The old modal-first empty state must be gone from the launcher itself. The screen header still offers a
        // start action, which is its job — the assertion is about what the user meets in the body.
        startButtons: Array.from(document.querySelectorAll(`${selector} .AssistantLauncher .bp6-button`)).filter(
          (button) => (button.textContent ?? "").trim() === "Start session",
        ).length,
      };
    }, SCREEN);
  });

  it("greets with the assistant rather than with a form", () => {
    assert.equal(seen.heading, "Your assistant is ready");
    assert.equal(seen.startButtons, 0, "the old Start session modal trigger is still the way in");
  });

  it("offers a row per connection, with the verb its state calls for", () => {
    assert.ok(seen.rows.length > 0);
    for (const row of seen.rows) {
      assert.ok(["Start", "Resume", "Continue"].includes(row.action), `unexpected action: ${row.action}`);
      assert.ok(row.name.length > 0, "a row with no name");
      assert.ok(row.where.includes("/"), `a row that does not say where it runs: ${row.where}`);
    }
  });

  // The point of the launcher: what the session may reach is on the row, not behind a form.
  it("says on the row what that session may do", () => {
    for (const row of seen.rows) {
      assert.ok(
        row.can.some((chip) => chip.includes("reads & writes")),
        `a row that does not say what it may touch: ${JSON.stringify(row.can)}`,
      );
      assert.ok(
        row.can.some((chip) => chip === "web access" || chip === "no web access"),
        `a row silent about web access: ${JSON.stringify(row.can)}`,
      );
    }
  });

  it("marks the offered default as the one to click", () => {
    const offered = seen.rows.filter((row) => row.primary);
    assert.ok(offered.length <= 1, "more than one row claims to be the default");
  });
});
