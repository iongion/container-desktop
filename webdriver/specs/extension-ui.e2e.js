import { strict as assert } from "node:assert";

// Drives the pi extension-UI surfaces through the real store on the real renderer: each host_request goes in
// the way the bridge delivers it, and the assertion is on the DOM the user would see. Element waits, never
// browser.execute polling — script evaluation right after a state change is unreliable under WebKitWebDriver.

async function openAssistant() {
  await browser.execute(() => {
    window.location.hash = "#/screens/ai/assistant";
  });
  await $('[data-screen="ai.assistant"]').waitForExist({
    timeout: 45000,
    timeoutMsg: "the Assistant screen never mounted",
  });
  // The reset is written inside the page function on purpose: an `undefined` in a browser.execute ARGUMENT is
  // dropped by JSON serialization, so a passed-in state object would silently fail to clear a pending dialog.
  await browser.execute(() => {
    window.__cdCodingAgentStore.setState({
      status: "ready",
      view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
      chrome: { statuses: {}, widgets: {} },
      pendingDialog: undefined,
    });
  });
}

async function hostRequest(method, payload, requestId = "r1") {
  await browser.execute(
    (m, p, id) => {
      window.__cdCodingAgentStore.getState().handleHostRequest({
        type: "host_request",
        requestId: id,
        method: m,
        payload: p,
      });
    },
    method,
    payload,
    requestId,
  );
}

// One screenshot per WebDriver session is the ceiling here: saveScreenshot forces a paint WebKitGTK had
// parked, and the command after a second one hangs and takes the session with it. The DOM assertions below
// are the actual verification, so images are opt-in via PI_SHOTS=<n> (n = how many to allow, default 0).
let shotsLeft = Number(process.env.PI_SHOTS ?? 0);
async function shot(path) {
  if (shotsLeft <= 0) return;
  shotsLeft -= 1;
  await browser.saveScreenshot(path);
}

describe("pi extension UI", () => {
  it("renders status entries and widget strips around the composer", async () => {
    await openAssistant();
    await hostRequest("setStatus", { statusKey: "probe", statusText: "running" });
    await hostRequest("setWidget", { widgetKey: "above", widgetLines: ["widget line one", "widget line two"] });
    await hostRequest("setWidget", { widgetKey: "below", widgetLines: ["below the editor"], widgetPlacement: "belowEditor" });

    await $(".ExtensionStatusStrip").waitForExist({ timeout: 15000, timeoutMsg: "the status strip never rendered" });
    await $(".ExtensionWidgetStrip--aboveEditor").waitForExist({ timeout: 15000, timeoutMsg: "no widget above" });
    await $(".ExtensionWidgetStrip--belowEditor").waitForExist({ timeout: 15000, timeoutMsg: "no widget below" });
    await shot("/tmp/ext-ui-chrome.png");

    const statusText = await $(".ExtensionStatusStrip").getText();
    assert.ok(statusText.includes("running"), `the status text is missing: ${statusText}`);
    const above = await $(".ExtensionWidgetStrip--aboveEditor").getText();
    assert.ok(above.includes("widget line one"), `the widget lines are missing: ${above}`);
    assert.ok(above.includes("widget line two"), `the second widget line is missing: ${above}`);

    // A cleared status must leave nothing behind, not an empty chip.
    await hostRequest("setStatus", { statusKey: "probe" });
    await $(".ExtensionStatusStrip").waitForExist({ reverse: true, timeout: 15000, timeoutMsg: "status never cleared" });
  });

  // pi's setWorkingMessage / setWorkingVisible / setWorkingIndicator all land on the app's own indicator, which
  // only exists while a turn is streaming — so the phase is put there first, the way a turn would.
  it("lets an extension name the working indicator, and hide it", async () => {
    await openAssistant();
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        view: { sessionId: "pi-session", phase: "model", lastSeq: 0, timeline: [] },
      });
    });
    await $(".ThinkingStatusText").waitForExist({ timeout: 15000, timeoutMsg: "the working indicator never rendered" });

    await hostRequest("setWorking", { workingMessage: "Indexing the repository" });
    await browser.waitUntil(async () => (await $(".ThinkingStatusText").getText()) === "Indexing the repository", {
      timeout: 15000,
      interval: 500,
      timeoutMsg: "the extension's working message never replaced the app's own word",
    });

    // pi's own way of saying "hide the indicator entirely".
    await hostRequest("setWorking", { workingFrames: [] });
    await $(".ThinkingStatus").waitForExist({
      reverse: true,
      timeout: 15000,
      timeoutMsg: "the working indicator stayed after an empty frame list",
    });

    // And back: visibility and message are separate calls in pi, so restoring one must not clear the other.
    await hostRequest("setWorking", { workingVisible: true, workingMessage: "Indexing the repository" });
    await browser.waitUntil(async () => (await $(".ThinkingStatusText").getText()) === "Indexing the repository", {
      timeout: 15000,
      interval: 500,
      timeoutMsg: "the indicator never came back",
    });
  });

  it("asks a select dialog and answers it with the chosen option", async () => {
    await openAssistant();
    await hostRequest("select", { title: "Pick one", options: ["alpha", "beta"] });
    await $(".ExtensionDialog").waitForExist({ timeout: 15000, timeoutMsg: "the select dialog never rendered" });
    const options = await $$(".ExtensionDialogOption");
    assert.equal(options.length, 2, "both choices should be offered");
    await shot("/tmp/ext-ui-select.png");

    await options[1].click();
    await $(".ExtensionDialog").waitForExist({ reverse: true, timeout: 15000, timeoutMsg: "the dialog never closed" });
  });

  it("renders confirm as an inline yes/no and input with a send action", async () => {
    await openAssistant();
    await hostRequest("confirm", { title: "Confirm?", message: "you picked beta" });
    await $(".ExtensionDialog").waitForExist({ timeout: 15000, timeoutMsg: "the confirm dialog never rendered" });
    const confirmText = await $(".ExtensionDialog").getText();
    assert.ok(confirmText.includes("you picked beta"), `the confirm message is missing: ${confirmText}`);
    assert.ok(/YES/i.test(confirmText) && /NO/i.test(confirmText), `confirm needs yes and no: ${confirmText}`);
    await shot("/tmp/ext-ui-confirm.png");
    await $(".ExtensionDialogActions button").click();
    await $(".ExtensionDialog").waitForExist({ reverse: true, timeout: 15000, timeoutMsg: "confirm never closed" });

    await hostRequest("input", { title: "Your name", placeholder: "type here" }, "r2");
    await $(".ExtensionDialog input").waitForExist({ timeout: 15000, timeoutMsg: "the input dialog never rendered" });
    await shot("/tmp/ext-ui-input.png");
  });

  it("shows a gated tool call as an approval card and records the rejection", async () => {
    await openAssistant();
    await hostRequest("approval", { toolName: "bash", toolCallId: "tc1", args: { command: "rm -rf build" } });
    await $(".AssistantApproval").waitForExist({ timeout: 15000, timeoutMsg: "the approval card never rendered" });
    const card = await $(".AssistantApproval").getText();
    assert.ok(card.includes("rm -rf build"), `the card must show what would run: ${card}`);
    await shot("/tmp/ext-ui-approval.png");

    const buttons = await $$(".AssistantApprovalActions button");
    assert.equal(buttons.length, 2, "the card offers allow and reject");
    await buttons[1].click();
    await $(".AssistantApprovalActions").waitForExist({
      reverse: true,
      timeout: 15000,
      timeoutMsg: "the approval never settled",
    });
    // Read the DOM, not getText(): WebKitGTK parks its compositor, so the freshly mounted verdict tag is in
    // the tree before it is "rendered text" — getText() misses it and reads like a missing feature.
    await $(".AssistantApproval .bp6-tag").waitForExist({ timeout: 15000, timeoutMsg: "no verdict tag" });
    const settled = await browser.execute(() => ({
      text: document.querySelector(".AssistantApproval")?.textContent ?? "",
      status: window.__cdCodingAgentStore.getState().view.timeline[0]?.status,
    }));
    assert.equal(settled.status, "rejected", "the store must record the rejection");
    assert.ok(/Declined/.test(settled.text), `a rejected call must read as declined: ${settled.text}`);
    await shot("/tmp/ext-ui-approval-declined.png");
  });

  it("lets an extension replace the composer draft", async () => {
    await openAssistant();
    await hostRequest("setEditorText", { text: "seeded by the extension" });
    await browser.waitUntil(
      async () => (await $(".AIComposerInput").getValue()) === "seeded by the extension",
      { timeout: 15000, timeoutMsg: "the composer draft was never replaced", interval: 300 },
    );
    await shot("/tmp/ext-ui-editor-text.png");
  });
});
