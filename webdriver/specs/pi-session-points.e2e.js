// The picker behind pi's own `/fork` and `/tree`, driven through the REAL composer in the running app.
//
// Both commands answer with DATA when given no argument and act when given an id. Before this the answer was
// discarded, so the commands looked inert — which is exactly what a DOM assertion can prove and a unit test cannot.
// The mock session is the far end of the socket, so the renderer runs its production path: parse the command, cross
// the bridge, read the answer, open the picker, send the chosen id back through the same command.
//
// HARNESS RULES:
//   • Typing a slash opens the completion palette, and Enter ACCEPTS a completion while it is open — so the palette
//     has to be dismissed before Enter can mean "send". This cost a run.
//   • ONE saveScreenshot per session; this spec takes none, everything it asserts is text.
import { strict as assert } from "node:assert";

const READY_TIMEOUT = 30000;

async function runSlashCommand(text) {
  const input = await $(".AIComposerInput");
  await input.setValue(text);
  await browser.keys("Escape");
  await browser.keys("Enter");
}

// What the drawer is showing, read in one go: the title tells which question was asked, and the rows carry the
// identity, the marker and the action.
function drawer() {
  return browser.execute(() => {
    const root = document.querySelector(".AssistantSessionTreeDrawer");
    if (!root) return { open: false, title: "", rows: [] };
    return {
      open: true,
      title: root.querySelector(".bp6-heading")?.textContent ?? "",
      note: root.querySelector(".AssistantSessionTreeToolbar span")?.textContent ?? "",
      empty: root.querySelector(".AssistantSessionTreeEmpty")?.textContent ?? "",
      rows: Array.from(root.querySelectorAll(".AssistantSessionTreeRow")).map((row) => ({
        title: row.querySelector(".AssistantSessionTreeTitle strong")?.textContent ?? "",
        role: row.querySelector(".AssistantSessionTreeTitle code")?.textContent ?? "",
        sub: row.querySelector(".AssistantSessionTreeBody small")?.textContent ?? "",
        action: row.querySelector("button")?.textContent ?? "",
        here: row.querySelector(".bp6-tag")?.textContent ?? "",
        // Depth is rendered as padding, so this is the only way to prove a child sits under its parent.
        indent: Number.parseInt(row.style.paddingLeft || "0", 10),
      })),
    };
  });
}

async function waitForDrawer(reason) {
  await browser.waitUntil(async () => (await drawer()).open, { timeout: READY_TIMEOUT, timeoutMsg: reason });
  return drawer();
}

async function waitForDrawerGone(reason) {
  await browser.waitUntil(async () => !(await drawer()).open, { timeout: READY_TIMEOUT, timeoutMsg: reason });
}

// Which command the session was last asked to run, and with what. The mock echoes an id-bearing call back as
// `{command, args}`, which is what proves the pick reached the bridge rather than only closing the drawer.
function lastCommand() {
  return browser.execute(() => window.__cdPickedCommand ?? null);
}

async function recordCommands() {
  await browser.execute(() => {
    const store = window.__cdCodingAgentStore;
    if (store.__cdCommandSpy) return;
    store.__cdCommandSpy = true;
    const state = store.getState();
    const original = state.runPiCommand;
    store.setState({
      runPiCommand: async (name, args) => {
        if (args) window.__cdPickedCommand = { name, args };
        return original(name, args);
      },
    });
  });
}

let forkView = {};
let treeView = {};

describe("the session points pi answers with", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });
    // The mock app boots with a scripted session, and without one the composer refuses text.
    await browser.waitUntil(
      async () => await browser.execute(() => window.__cdCodingAgentStore.getState().status === "ready"),
      { timeout: READY_TIMEOUT, timeoutMsg: "the mock session never became ready" },
    );
    await recordCommands();
  });

  it("opens a picker on the fork points a bare /fork answers with", async () => {
    await runSlashCommand("/fork");
    forkView = await waitForDrawer("the fork picker never opened");
    assert.equal(forkView.title, "Fork the session");
    assert.equal(forkView.rows.length, 2, `expected both fork points: ${JSON.stringify(forkView.rows)}`);
    assert.equal(forkView.rows[0].title, "how many containers are running?");
    // The id is what the follow-up command is named by, so the row has to show it.
    assert.equal(forkView.rows[0].sub, "mock-entry-1");
    assert.equal(forkView.rows[0].action, "Fork here");
  });

  it("forks from the point the user picked, by its id", async () => {
    const buttons = await $$(".AssistantSessionTreeDrawer .AssistantSessionTreeRow button");
    await buttons[1].click();
    await waitForDrawerGone("the picker stayed open after a fork the session accepted");
    // The SAME command the user typed, now carrying the id it was asking for.
    assert.deepEqual(await lastCommand(), { name: "fork", args: "mock-entry-2" });
  });

  it("opens a branch picker on the tree a bare /tree answers with, and marks where you are", async () => {
    await runSlashCommand("/tree");
    treeView = await waitForDrawer("the tree picker never opened");
    assert.equal(treeView.title, "Session tree");
    assert.equal(treeView.rows.length, 3, `expected the whole tree: ${JSON.stringify(treeView.rows)}`);
    // The live branch is stated, not implied: a picker that cannot say "you are here" is a list of ids.
    assert.equal(treeView.rows[0].here, "Here");
    assert.equal(treeView.rows[1].here, "Here");
    assert.equal(treeView.rows[2].here, "", "a branch that is not live must not be marked as where you are");
    assert.equal(treeView.rows[2].action, "Switch");
    // Only a row you are not already on offers a move.
    assert.equal(treeView.rows[0].action, "");
  });

  it("renders a child branch under its parent", () => {
    assert.ok(
      treeView.rows[1].indent > treeView.rows[0].indent,
      `a child must be indented under its parent: ${JSON.stringify(treeView.rows.map((row) => row.indent))}`,
    );
    assert.equal(treeView.rows[1].indent, treeView.rows[2].indent, "siblings must sit at the same depth");
  });

  it("keeps pi's own word for what each entry is", () => {
    assert.equal(treeView.rows[0].sub, "Message");
    assert.equal(treeView.rows[0].role, "user");
  });

  it("switches to the branch the user picked, by its id", async () => {
    const buttons = await $$(".AssistantSessionTreeDrawer .AssistantSessionTreeRow button");
    await buttons[buttons.length - 1].click();
    await waitForDrawerGone("the picker stayed open after a branch switch the session accepted");
    assert.deepEqual(await lastCommand(), { name: "tree", args: "mock-entry-3" });
  });
});
