// Workspace-access end-to-end over W3C WebDriver (Tauri / WebKitGTK). This is the ONE seam the hermetic suite
// cannot cover: platform/tauri/capabilities/workspaceAccess.ts → `invoke` (camelCase→snake_case arg mapping) →
// the native workspace_* commands in src-tauri/src/host.rs.
//
// It is driven through the channels that USE that seam today — the project context the assistant is given: reading
// the workspace's rule and memory files, writing a memory into it, and clearing it again. The prompt-driven
// `createChat`/`submitChat`/`getChatSnapshot` path this spec used to drive belonged to the in-app engine and has not
// existed since the assistant moved into a container, so it could only ever time out.
//
// Runs against the mock app (CONTAINER_DESKTOP_MOCK=1, set by wdio.conf). The fixture workspace + ai.workspaceRoot
// are seeded into an ISOLATED CONTAINER_DESKTOP_USER_DATA_DIR by wdio.conf onPrepare (before the app launches, so
// it wins the boot-time settings-write race) — never the developer's release-app data.

import { strict as assert } from "node:assert";
import path from "node:path";

// The harness seeds this folder and points ai.workspaceRoot at it (wdio.conf onPrepare).
const FIXTURE = path.join(
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(process.cwd(), "webdriver", ".e2e-user-data"),
  "workspace-fixture",
);

const context = () =>
  browser.executeAsync((done) => {
    window.AI.getProjectContext()
      .then((snapshot) => done(snapshot))
      .catch((error) => done({ error: String(error?.message ?? error) }));
  });

describe("Workspace over the Tauri invoke bridge (WebKitGTK / WebDriver)", () => {
  before(async () => {
    // The debug binary boots and hosts the AI system before it is interactive — settle, then confirm the seam's own
    // channel is up (the fixture workspace was pre-seeded by wdio.conf onPrepare).
    await browser.pause(4000);
    await browser.waitUntil(async () => browser.execute(() => !!window.AI?.getProjectContext), {
      timeout: 30000,
      timeoutMsg: "window.AI never exposed the project-context channel",
    });
    // Host-side reads follow the SESSION's folder, so the session has to be on the fixture: mock mode boots one on
    // the home directory, which is a real folder with none of this spec's files in it.
    await browser.waitUntil(async () => browser.execute(() => !!window.__cdCodingAgentStore), { timeout: 30000 });
    await browser.executeAsync((workspacePath, done) => {
      const store = window.__cdCodingAgentStore.getState();
      store
        .stop()
        .then(() =>
          window.__cdCodingAgentStore.getState().start({
            connectionId: "mock-connection",
            workspacePath,
            modelId: "mock-assistant",
            upstreamBaseUrl: "",
            appVersion: "0.0.0",
          }),
        )
        .then(() => done(true))
        .catch(() => done(false));
    }, FIXTURE);
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => window.__cdCodingAgentStore.getState().spec?.workspacePath)) === FIXTURE,
      { timeout: 30000, timeoutMsg: "the session never took the fixture workspace" },
    );
  });

  // Reading: the snapshot's root is the CANONICAL fixture path, which only Rust can answer — the webview never
  // resolves a real path — and its files were read through workspace_read.
  it("reads the workspace through the native commands", async () => {
    const snapshot = await context();
    assert.equal(snapshot.error, undefined, `getProjectContext failed: ${snapshot.error}`);
    assert.equal(snapshot.state, "ready", `the project context was not ready: ${JSON.stringify(snapshot.state)}`);
    assert.equal(snapshot.workspaceRoot, FIXTURE);
    assert.ok(Array.isArray(snapshot.rules), "the rules half of the snapshot was not read");
    assert.ok(Array.isArray(snapshot.memory), "the memory half of the snapshot was not read");
  });

  // Writing: the same seam in the other direction. A memory added has to be there on the NEXT read, which is a
  // separate invoke round trip — a write the binding dropped would still leave the first answer looking right.
  it("writes into the workspace through the native commands, and reads it back", async () => {
    const token = `WS-SEAM-${Date.now().toString(36)}`;
    const written = await browser.executeAsync((content, done) => {
      window.AI.addProjectMemory(content)
        .then((snapshot) => done({ ok: true, entries: snapshot.memory?.length ?? 0 }))
        .catch((error) => done({ ok: false, error: String(error?.message ?? error) }));
    }, token);
    assert.equal(written.ok, true, `addProjectMemory failed: ${written.error}`);

    const reread = await context();
    const entries = reread.memory ?? [];
    assert.ok(
      entries.some((entry) => (entry.content ?? "").includes(token)),
      `the memory written through the seam did not read back: ${JSON.stringify(entries.map((e) => e.content))}`,
    );
  });

  // And removing it: the fixture is shared with the other specs, so this leaves nothing behind.
  it("clears what it wrote, through the same seam", async () => {
    const cleared = await browser.executeAsync((done) => {
      window.AI.clearProjectMemory()
        .then((snapshot) => done({ ok: true, entries: snapshot.memory?.length ?? 0 }))
        .catch((error) => done({ ok: false, error: String(error?.message ?? error) }));
    });
    assert.equal(cleared.ok, true, `clearProjectMemory failed: ${cleared.error}`);
    assert.equal(cleared.entries, 0, "the memory file still had entries after it was cleared");
  });
});
