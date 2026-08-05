import { strict as assert } from "node:assert";

// Verifies every pi tool card on the real renderer. The bridge events the container would send — tool_start
// then tool_end, with pi's ACTUAL text formats and thin `details` — are pushed through the store's own
// applyBridgeEvent, so the projector, the registry and the card all run exactly as in a live session.
//
// All nine cases go into ONE transcript and are read back as ONE DOM snapshot. That is not just speed: a
// WebKitWebDriver session degrades over many round-trips (a `browser.execute` after a click-and-repaint can
// hang and take the session with it), and it also proves the nine cards coexist in one transcript.

const PATCH = [
  "--- src/app.ts",
  "+++ src/app.ts",
  "@@ -1,4 +1,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  " const c = 4;",
  " const d = 5;",
].join("\n");

// Each case is exactly what pi returns: the payload as text, `details` carrying only truncation/limit flags.
const CASES = [
  { tool: "bash", args: { command: "yarn test" }, text: "Test Files  1 passed\nTests  3 passed\n" },
  {
    tool: "bash",
    args: { command: "false" },
    text: "some output\nCommand exited with code 1",
    isError: true,
  },
  {
    tool: "read",
    args: { path: "src/app.ts", offset: 1, limit: 100 },
    text: "const a = 1;\nconst b = 2;\n\n[Showing lines 1-100 of 900. Use offset=101 to continue.]",
    details: { truncation: { truncated: true, outputLines: 100, totalLines: 900 } },
  },
  {
    tool: "write",
    args: { path: "new.ts", content: "export const answer = 42;\n" },
    text: "Successfully wrote 26 bytes to new.ts",
  },
  {
    tool: "edit",
    args: { path: "src/app.ts", edits: [{ oldText: "const b = 2;", newText: "const b = 3;" }] },
    text: "ok",
    details: { diff: "display diff", patch: PATCH, firstChangedLine: 2 },
  },
  { tool: "ls", args: { path: "src" }, text: "README.md\ncomponents/\nindex.ts\n" },
  {
    tool: "grep",
    args: { pattern: "TODO", path: "src" },
    text: "src/a.ts:12: // TODO fix\nsrc/b.ts:3: // TODO later\n\n[100 matches limit reached. Use limit=200 for more]",
    details: { matchLimitReached: 100 },
  },
  { tool: "find", args: { pattern: "*.ts" }, text: "src/a.ts\nsrc/b.ts\n" },
  {
    tool: "gondolin_vm_status",
    args: { vm: "alpha" },
    text: "running",
    details: { vm: "alpha", state: "running", uptimeSeconds: 42 },
  },
];

// What a plugin publishes for the GUI, as the two bridge events the container emits for it.
const PLUGIN_DATA = [
  { type: "entry", entryId: "e2", customType: "probe:card", data: { status: "done", counts: [1, 2, 3] } },
  { type: "custom_message", customType: "probe:msg", content: "from a plugin", details: { ok: true } },
];

let cards = [];

// Find the one card whose title matches, so an assertion never depends on transcript order.
function card(title) {
  const found = cards.filter((entry) => entry.title === title);
  assert.equal(found.length, 1, `expected exactly one "${title}" card, got ${found.length} of ${cards.length}`);
  return found[0];
}

describe("pi tool cards", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    // Written inside the page function on purpose: an `undefined` passed as a browser.execute ARGUMENT is
    // dropped by JSON serialization, so a passed-in state object would silently fail to clear the timeline.
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({
        status: "ready",
        view: { sessionId: "pi-session", phase: "idle", lastSeq: 0, timeline: [] },
        chrome: { statuses: {}, widgets: {} },
        pendingDialog: undefined,
      });
    });

    await browser.execute((entries) => {
      const store = window.__cdCodingAgentStore.getState();
      entries.forEach((entry, index) => {
        const toolCallId = `call-${index}`;
        store.applyBridgeEvent({ type: "tool_start", toolCallId, toolName: entry.tool, args: entry.args });
        store.applyBridgeEvent({
          type: "tool_end",
          toolCallId,
          toolName: entry.tool,
          isError: entry.isError === true,
          text: entry.text,
          details: entry.details,
        });
      });
      // The turn is over, so the composer reads idle rather than mid-steer.
      store.applyBridgeEvent({ type: "idle" });
    }, CASES);

    await browser.execute((entries) => {
      const store = window.__cdCodingAgentStore.getState();
      for (const entry of entries) store.applyBridgeEvent(entry);
    }, PLUGIN_DATA);

    await $(".AICard").waitForExist({ timeout: 20000, timeoutMsg: "no card ever rendered" });

    // Cards open collapsed, so Blueprint has not mounted their bodies yet. Clicking through the DOM rather
    // than the WebDriver actions pipeline keeps this to a single round-trip.
    await browser.execute(() => {
      for (const head of document.querySelectorAll(".AICardHead")) head.click();
    });
    await browser.pause(600);

    cards = await browser.execute(() =>
      Array.from(document.querySelectorAll(".AICard")).map((element) => ({
        title: element.querySelector(".AICardTitle")?.textContent ?? "",
        text: element.textContent ?? "",
        added: element.querySelectorAll(".AICardDiffLine--add").length,
        removed: element.querySelectorAll(".AICardDiffLine--del").length,
        notice: element.querySelector(".AICardNotice")?.textContent ?? "",
      })),
    );
    // ONE screenshot per run, taken last. A saveScreenshot forces a paint WebKitGTK had parked, and the
    // command after a SECOND one reliably hangs and takes the session with it — so the transcript's lower
    // half is captured by a second run with PI_CARDS_SCROLL_END=1 rather than by a second screenshot here.
    const scrollTo = process.env.PI_CARDS_SCROLL_TO;
    if (scrollTo) {
      await browser.execute((wanted) => {
        const rendered = Array.from(document.querySelectorAll(".AICard"));
        const target =
          wanted === "end"
            ? rendered[rendered.length - 1]
            : rendered.find((element) => (element.querySelector(".AICardTitle")?.textContent ?? "").includes(wanted));
        target?.scrollIntoView({ block: "center" });
      }, scrollTo);
      await browser.pause(400);
    }
    await browser.saveScreenshot(process.env.PI_CARDS_SHOT ?? "/tmp/pi-cards-top.png");
  });

  it("renders one card per tool call and per plugin payload", () => {
    const expected = CASES.length + PLUGIN_DATA.length;
    assert.equal(cards.length, expected, `expected ${expected} cards, got ${cards.length}`);
  });

  it("renders a plugin's appended entry as an inspectable data card", () => {
    const entry = card("probe:card");
    assert.ok(entry.text.includes("counts"), `the plugin's own payload must be inspectable: ${entry.text}`);
    assert.ok(entry.text.includes("done"), `the payload values must render: ${entry.text}`);
  });

  it("renders a plugin's custom message with its text above its details", () => {
    const message = card("probe:msg");
    assert.ok(message.text.includes("from a plugin"), `the message text must render: ${message.text}`);
    assert.ok(message.text.includes("\"ok\""), `its details must render too: ${message.text}`);
  });

  it("renders bash as an exec card with its command, and no invented exit code", () => {
    const bash = card("bash yarn test");
    assert.ok(bash.text.includes("Tests  3 passed"), `command output missing: ${bash.text}`);
    assert.ok(!/\bexit\b/i.test(bash.text), `pi reports no exit code, so the card must not claim one: ${bash.text}`);
  });

  it("renders a failed bash as an error carrying pi's exit-code message", () => {
    const failed = cards.filter((entry) => entry.text.includes("Command exited with code 1"));
    assert.equal(failed.length, 1, "the failed command must render exactly one card");
    assert.equal(failed[0].title, "", "a failure renders as the shared error callout, not a titled card body");
  });

  it("renders read as a file card and lifts pi's truncation notice out of the content", () => {
    const read = card("read src/app.ts:1-100");
    assert.ok(read.text.includes("const a = 1;"), `file content missing: ${read.text}`);
    assert.ok(read.notice.includes("Use offset=101"), `the truncation notice must be shown: ${read.notice}`);
    const body = read.text.replace(read.notice, "");
    assert.ok(!body.includes("[Showing lines"), `the notice must not stay inside the content: ${body}`);
  });

  it("renders write from its arguments, because pi answers with only a byte count", () => {
    const write = card("write new.ts");
    assert.ok(write.text.includes("answer = 42"), `the written content must be shown: ${write.text}`);
    assert.ok(!write.text.includes("26 bytes"), `the byte count is not the file: ${write.text}`);
  });

  it("renders edit as a diff of pi's unified patch", () => {
    const edit = card("edit src/app.ts · +1/−1");
    assert.ok(edit.text.includes("const b = 3;"), `the added line must render: ${edit.text}`);
    assert.ok(edit.text.includes("const b = 2;"), `the removed line must render: ${edit.text}`);
    assert.equal(edit.added, 1, "exactly one added line");
    assert.equal(edit.removed, 1, "exactly one removed line");
  });

  it("renders ls as a listing, taking pi's trailing slash as the directory marker", () => {
    const ls = card("ls src");
    assert.ok(ls.text.includes("components"), `entries missing: ${ls.text}`);
    assert.ok(!ls.text.includes("components/"), "the slash is the marker, not part of the name");
    assert.ok(ls.text.includes("directory"), `a directory must be labelled as one: ${ls.text}`);
  });

  it("renders grep matches with their line numbers and shows its match-limit notice", () => {
    const grep = card("grep TODO in src");
    assert.ok(grep.text.includes("src/a.ts"), `the match path must render: ${grep.text}`);
    assert.ok(grep.text.includes("// TODO fix"), `the match text must render: ${grep.text}`);
    assert.ok(grep.text.includes("12"), `the match line number must render: ${grep.text}`);
    assert.ok(grep.notice.includes("100 matches limit"), `the limit notice must be shown: ${grep.notice}`);
  });

  it("renders find as a path list", () => {
    const find = card("find *.ts");
    assert.ok(find.text.includes("src/a.ts") && find.text.includes("src/b.ts"), `both paths: ${find.text}`);
  });

  it("falls back to inspectable JSON for a plugin tool nobody has classified", () => {
    const generic = card("gondolin_vm_status");
    assert.ok(generic.text.includes("uptimeSeconds"), `the plugin's own details must be inspectable: ${generic.text}`);
  });
});
