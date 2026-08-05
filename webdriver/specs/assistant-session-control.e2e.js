// The Assistant header's session control, driven in the running app: the name renames, the caret lists the
// conversations this workspace has, and the things that used to crowd the row now live behind them.
//
// HARNESS RULES:
//   • The popover and the "…" menu are PORTALED to <body>, so their selectors are never scoped to the screen.
//   • Rename text carries no doubled character — WebKitWebDriver collapses a repeat inside one action chain.
//   • ONE saveScreenshot per session; this spec takes none, everything it asserts is text.

import { strict as assert } from "node:assert";

const SCREEN = '[data-screen="ai.assistant"]';
const READY_TIMEOUT = 45000;
const RENAMED = "Trim the podman disk";

function picker() {
  return browser.execute(() => {
    const root = document.querySelector(".AssistantSessionPicker");
    return {
      present: !!root,
      name: root?.querySelector(".bp6-editable-text-content")?.textContent ?? "",
      placeholder: root?.querySelector(".bp6-editable-text")?.classList.contains("bp6-editable-text-placeholder"),
      editing: !!root?.querySelector(".bp6-editable-text-editing"),
      // What the row used to carry and no longer does: the container id moved into the list's own footer.
      containerLabel: document.querySelector(".AssistantSessionContainer") !== null,
      workspaceButton: document.querySelector("button.AssistantSessionWorkspace") !== null,
    };
  });
}

function list() {
  return browser.execute(() => {
    const root = document.querySelector(".AssistantSessionList");
    if (!root) return { open: false, rows: [] };
    return {
      open: true,
      search: root.querySelector(".AssistantSessionListSearch input") !== null,
      rows: Array.from(root.querySelectorAll(".AssistantSessionRow")).map((row) => ({
        title: row.querySelector(".bp6-menu-item-label")
          ? (row.querySelector(".bp6-text-overflow-ellipsis")?.textContent ?? "")
          : (row.textContent ?? ""),
        age: row.querySelector(".bp6-menu-item-label")?.textContent ?? "",
        current: row.querySelector(".bp6-active") !== null || row.classList.contains("bp6-active"),
      })),
      // Everything else the list offers, read as plain text so a label change is visible rather than silent.
      items: Array.from(root.querySelectorAll(".bp6-menu-item")).map((item) => (item.textContent ?? "").trim()),
      container: root.querySelector(".AssistantSessionListFoot code")?.textContent ?? "",
    };
  });
}

async function openList() {
  await $(".AssistantSessionListToggle").click();
  await browser.waitUntil(async () => (await list()).open, {
    timeout: READY_TIMEOUT,
    timeoutMsg: "the session list never opened",
  });
  // The rows arrive from the session, one command later than the popover.
  await browser.waitUntil(async () => (await list()).rows.length > 0, {
    timeout: READY_TIMEOUT,
    timeoutMsg: "the session list stayed empty — the workspace's sessions never arrived",
  });
  return list();
}

async function closeList() {
  await browser.keys("Escape");
  await browser.waitUntil(async () => !(await list()).open, {
    timeout: READY_TIMEOUT,
    timeoutMsg: "the session list stayed open",
  });
}

let resting = {};
let opened = {};
let renamed = {};
let reopened = {};
let switched = {};
let overflow = {};

describe("the assistant's session control", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(SCREEN).waitForExist({ timeout: READY_TIMEOUT, timeoutMsg: "the Assistant screen never mounted" });
    // The mock app boots with a scripted session, which is the state this control belongs to.
    await browser.waitUntil(
      async () => await browser.execute(() => window.__cdCodingAgentStore.getState().status === "ready"),
      { timeout: READY_TIMEOUT, timeoutMsg: "the mock session never became ready" },
    );
    // A mock session's spec carries no container names — it has no containers — so the id whose new home is the
    // list's footer is put there the way pi-start-drawer.e2e.js puts it in the header.
    await browser.execute(() => {
      const store = window.__cdCodingAgentStore;
      store.setState({ spec: { ...store.getState().spec, agentContainerName: "cd-agent-spec01" } });
    });
    await $(".AssistantSessionPicker").waitForExist({
      timeout: READY_TIMEOUT,
      timeoutMsg: "the header has no session control",
    });
    resting = await picker();

    opened = await openList();
    await closeList();

    // Rename through the real control: click the name, type, confirm. The field is read through `execute` rather
    // than through an element handle — Blueprint replaces the content span with an input, so a handle taken before
    // the switch goes stale and its re-fetch races the re-render.
    await $(".AssistantSessionPicker .bp6-editable-text-content").click();
    await browser.waitUntil(async () => (await picker()).editing, {
      timeout: READY_TIMEOUT,
      timeoutMsg: "clicking the name did not open it for editing",
    });
    await browser.execute((text) => {
      const input = document.querySelector(".AssistantSessionPicker input");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, text);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    }, RENAMED);
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await picker()).name === RENAMED, {
      timeout: READY_TIMEOUT,
      timeoutMsg: "the header did not take the new name",
    });
    renamed = await picker();
    renamed.stored = await browser.execute(() => window.__cdCodingAgentStore.getState().sessionName);

    reopened = await openList();

    // Leave this conversation for the other one the workspace has.
    const others = await $$(".AssistantSessionList .AssistantSessionRow");
    await others[others.length - 1].click();
    await browser.waitUntil(async () => !(await list()).open, {
      timeout: READY_TIMEOUT,
      timeoutMsg: "picking a session left the list open",
    });
    await browser.pause(600);
    switched = await picker();
    switched.session = await browser.execute(() => ({
      name: window.__cdCodingAgentStore.getState().sessionName ?? "",
      status: window.__cdCodingAgentStore.getState().status,
    }));

    // What made room for the name: the workspace and the editor moved into the header's "…" overflow.
    await browser.execute(() => {
      document.querySelector('.ResourceListUtilityActions button svg[data-icon="more"]')?.closest("button")?.click();
    });
    await $(".bp6-popover-content .bp6-menu").waitForExist({
      timeout: READY_TIMEOUT,
      timeoutMsg: "the header's utility menu never opened",
    });
    overflow = await browser.execute(() => ({
      items: Array.from(document.querySelectorAll(".bp6-popover-content .bp6-menu .bp6-menu-item")).map((item) =>
        (item.textContent ?? "").trim(),
      ),
    }));
    await browser.keys("Escape");
  });

  it("names the session in the header, and says so when it has no name yet", () => {
    assert.ok(resting.present, "the header must carry the session control");
    assert.equal(resting.editing, false, "the control rests as a name, not as an open field");
    // A session nobody has named reads as unnamed rather than as a container id.
    assert.ok(
      resting.placeholder || resting.name.length > 0,
      `the control must show a name or say there is none, got "${resting.name}"`,
    );
    assert.equal(resting.containerLabel, false, "the container id must no longer sit in the header row");
    assert.equal(resting.workspaceButton, false, "the workspace button must have left the header row");
  });

  it("lists the conversations this workspace already has, newest first, marking the one you are in", () => {
    assert.ok(opened.search, "the list must offer a search");
    assert.equal(opened.rows.length, 2, `expected the workspace's sessions: ${JSON.stringify(opened.rows)}`);
    assert.ok(opened.rows[0].title.includes("Release triage"), `the newest row: ${opened.rows[0].title}`);
    assert.ok(opened.rows[0].current, "the conversation the session is on must be marked");
    assert.equal(opened.rows[1].current, false, "a conversation you are not in must not be marked as current");
    assert.ok(opened.rows[0].age.length > 0, "each row says how long ago it was touched");
  });

  it("offers a new conversation and names the pair, in the list rather than in the header", () => {
    assert.ok(
      opened.items.some((item) => item.includes("New session")),
      `the list must offer a new session: ${JSON.stringify(opened.items)}`,
    );
    assert.equal(opened.container, "cd-agent-spec01", "the container id's new home is the list's footer");
  });

  it("renames the session from the header, and the session itself takes the name", () => {
    assert.equal(renamed.name, RENAMED);
    assert.equal(renamed.editing, false, "confirming closes the field");
    // Not just on screen: this is what the session answered, which is what a rename has to mean.
    assert.equal(renamed.stored, RENAMED);
    assert.ok(
      reopened.rows.some((row) => row.title.includes(RENAMED)),
      `the session's own listing must carry the new name: ${JSON.stringify(reopened.rows)}`,
    );
  });

  it("switches to the conversation the user picked, and the name stays the session's", () => {
    assert.equal(switched.session.status, "ready", "switching must not cost the session");
    // The conversation that was opened has no name of pi's own…
    assert.equal(switched.session.name, "");
    // …so the header names the SESSION again, which is the record the rename mirrored into settings — the same one
    // the launcher row and the next boot read.
    assert.equal(switched.name, RENAMED);
  });

  it("keeps the workspace, the editor and the stop behind the header's overflow", () => {
    for (const label of ["Workspace", "VS Code", "Stop session"]) {
      assert.ok(
        overflow.items.some((item) => item.includes(label)),
        `${label} must be in the header's utility menu: ${JSON.stringify(overflow.items)}`,
      );
    }
  });
});
