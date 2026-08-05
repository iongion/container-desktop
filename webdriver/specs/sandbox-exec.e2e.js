// Sandbox execution end-to-end over W3C WebDriver (Tauri / WebKitGTK). The hermetic executionTargets.mock.test
// exercises the real execution selector + exec-routed workspace against an in-memory VirtualEngineHost in node;
// this drives the SAME real selector IN the WebKitGTK webview realm, where the Tauri/Wails AI system actually
// hosts it. A mock-only seam (webviewAISystem __aiSandboxExecProbe, DCE'd from production) resolves a disposable
// sandbox target, writes a file through the container-routed workspace, reads it back, and reports the sandbox
// lifecycle — proving the session's files live in the container, and that the container does not outlive the run.
//
// Requires the mock app (wdio.conf sets CONTAINER_DESKTOP_MOCK). No provider key or real engine is involved.

describe("Sandbox execution over the Tauri webview (WebKitGTK / WebDriver)", () => {
  before(async () => {
    // The debug binary boots and hosts the AI system before it is interactive — settle, then confirm the seam.
    await browser.pause(4000);
    await browser.waitUntil(async () => browser.execute(() => typeof window.__aiSandboxExecProbe === "function"), {
      timeout: 30000,
      timeoutMsg: "the sandbox-exec probe seam (mock app) never became available",
    });
  });

  it("resolves a sandbox target and round-trips a file through the container workspace", async () => {
    const result = await browser.executeAsync((done) => {
      window
        .__aiSandboxExecProbe()
        .then((observed) => done({ ok: true, observed }))
        .catch((error) => done({ ok: false, error: String((error && error.message) || error) }));
    });

    expect(result.ok).toBe(true);
    const { observed } = result;
    // The file written through the sandbox's exec-routed workspace reads back — it lives IN the container.
    expect(observed.readBack).toBe("hello-sandbox");
    // Sandbox lifecycle: none before, exactly one labeled sandbox while resolved, none after dispose.
    expect(observed.before).toBe(0);
    expect(observed.during).toBe(1);
    expect(observed.after).toBe(0);
  });
});
