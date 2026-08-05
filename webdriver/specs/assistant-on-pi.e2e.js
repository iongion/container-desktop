import { strict as assert } from "node:assert";

describe("Assistant surface on the pi session", () => {
  it("mounts, renders its composer, and shows pi transcript items", async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    // Element waits, not browser.execute polling: script evaluation under WebKitWebDriver is unreliable
    // right after navigation, and a failing evaluation looks identical to "not mounted yet".
    await $('[data-screen="ai.assistant"]').waitForExist({ timeout: 45000, timeoutMsg: "the Assistant screen never mounted" });
    assert.equal(await $(".AIComposerInput").isExisting(), true, "the assistant composer is missing");

    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: {
          sessionId: "pi-session",
          phase: "idle",
          lastSeq: 2,
          timeline: [
            {
              kind: "message",
              id: "u1",
              role: "user",
              content: "what can you do",
              delivery: "applied",
              status: "complete",
            },
            {
              kind: "message",
              id: "a1",
              role: "assistant",
              content: "**Running on pi**",
              delivery: "applied",
              status: "complete",
            },
          ],
        },
      });
    });
    await browser.pause(900);
    await browser.saveScreenshot("/tmp/assistant-on-pi.png");
    const body = await $(".AppScreen").getText();
    assert.ok(body.includes("Running on pi"), `the pi transcript did not reach the assistant surface:\n${body}`);
  });
});
