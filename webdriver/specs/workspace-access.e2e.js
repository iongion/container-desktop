// Workspace-access end-to-end over W3C WebDriver (Tauri / WebKitGTK). This is the ONE seam the Electron CDP run
// cannot cover: platform/tauri/capabilities/workspaceAccess.ts → `invoke` (camelCase→snake_case arg mapping) →
// the native workspace_* commands in src-tauri/src/host.rs. Everything above it (owned loop, workspace toolset,
// specs, cards) is shared with Electron and already verified there.
//
// Requires a mock app (CONTAINER_DESKTOP_MOCK=1) serving the renderer, and an AI workspace folder configured in
// Settings → AI (user-settings.json `ai.workspaceRoot`), which the mock adapter's workspace prompts act on.

const POLL_ATTEMPTS = 80;
const POLL_INTERVAL_MS = 250;

async function submitPrompt(sessionId, content) {
  return browser.executeAsync(
    (sid, text, done) => {
      (async () => {
        try {
          await window.AI.createChat({ id: sid, title: "workspace-access" });
          await window.AI.submitChat({
            sessionId: sid,
            message: { id: "m1", content: text, createdAt: Date.now() },
            history: [],
          });
          done({ ok: true });
        } catch (error) {
          done({ ok: false, error: String(error && error.message ? error.message : error) });
        }
      })();
    },
    sessionId,
    content,
  );
}

async function snapshot(sessionId) {
  return browser.executeAsync((sid, done) => {
    window.AI.getChatSnapshot(sid)
      .then((view) => done(view))
      .catch((error) => done({ error: String(error && error.message ? error.message : error) }));
  }, sessionId);
}

// Drive one prompt to completion and return the first tool timeline item.
async function runPrompt(sessionId, content) {
  const submitted = await submitPrompt(sessionId, content);
  expect(submitted.ok).toBe(true);
  let view = null;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    view = await snapshot(sessionId);
    const timeline = view?.timeline ?? [];
    const hasTool = timeline.some((item) => item.kind === "tool");
    if ((view?.phase === "idle" || view?.phase === "error") && hasTool) break;
    await browser.pause(POLL_INTERVAL_MS);
  }
  return (view?.timeline ?? []).find((item) => item.kind === "tool") ?? null;
}

describe("Workspace over the Tauri invoke bridge (WebKitGTK / WebDriver)", () => {
  before(async () => {
    // The debug binary boots and connects to engines before it is interactive — settle first.
    await browser.pause(4000);
  });

  it("reads a real file through workspace_read (Rust)", async () => {
    const tool = await runPrompt(`cw-read-${Date.now()}`, "read the file package.json please");
    expect(tool).not.toBe(null);
    expect(tool.tool).toBe("readFile");
    expect(tool.status).toBe("complete");
    // Proves the Rust command returned real file contents through the invoke bridge.
    expect(String(tool.result?.content ?? "")).toContain("demo");
  });

  it("globs the workspace through workspace_glob (Rust)", async () => {
    const tool = await runPrompt(`cw-glob-${Date.now()}`, "list the files in this project");
    expect(tool).not.toBe(null);
    expect(tool.tool).toBe("findFiles");
    expect(tool.status).toBe("complete");
    expect(Array.isArray(tool.result?.files)).toBe(true);
    expect(tool.result.files).toContain("package.json");
  });

  it("greps the workspace through workspace_grep (Rust)", async () => {
    const tool = await runPrompt(`cw-grep-${Date.now()}`, 'grep "hello world" in the project');
    expect(tool).not.toBe(null);
    expect(tool.tool).toBe("searchText");
    expect(tool.status).toBe("complete");
    expect(tool.result?.matches?.length).toBeGreaterThan(0);
    expect(tool.result.matches[0].line).toBe(1);
  });

  // The security property: confinement is enforced in RUST, not in the webview binding.
  it("rejects a path that escapes the workspace root", async () => {
    const tool = await runPrompt(`cw-escape-${Date.now()}`, "read the file ../../../secret.env");
    expect(tool).not.toBe(null);
    expect(tool.tool).toBe("readFile");
    expect(tool.status).toBe("error");
    expect(String(tool.message ?? "")).toContain("escapes the workspace");
  });
});
