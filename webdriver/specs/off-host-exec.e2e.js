// Off-host worker execution end-to-end over W3C WebDriver (Tauri / WebKitGTK) — the Phase 3 B runtime proof.
// The hermetic executionTargets.mock.test exercises the real execution selector + exec-routed workspace against an
// in-memory VirtualEngineHost in node; this drives the SAME real selector IN the WebKitGTK webview realm, where the
// Tauri/Wails AI system actually hosts it. A mock-only seam (webviewAISystem __aiOffHostProbe, DCE'd from
// production) resolves a worker's sandbox target, writes a file through the container-routed workspace, reads it
// back, and reports the sandbox lifecycle — proving a worker runs OFF-host, not on the host workspace.
//
// Requires the mock app (wdio.conf sets CONTAINER_DESKTOP_MOCK). No provider key or real engine is involved.

describe("Off-host worker execution over the Tauri webview (WebKitGTK / WebDriver)", () => {
  before(async () => {
    // The debug binary boots and hosts the AI system before it is interactive — settle, then confirm the seam.
    await browser.pause(4000);
    await browser.waitUntil(async () => browser.execute(() => typeof window.__aiOffHostProbe === "function"), {
      timeout: 30000,
      timeoutMsg: "the off-host probe seam (mock app) never became available",
    });
  });

  it("resolves a sandbox target and round-trips a file through the off-host workspace", async () => {
    const result = await browser.executeAsync((done) => {
      window
        .__aiOffHostProbe()
        .then((observed) => done({ ok: true, observed }))
        .catch((error) => done({ ok: false, error: String((error && error.message) || error) }));
    });

    expect(result.ok).toBe(true);
    const { observed } = result;
    // The file written through the sandbox's exec-routed workspace reads back — the worker acted OFF-host.
    expect(observed.readBack).toBe("hello-offhost");
    // Sandbox lifecycle: none before, exactly one labeled sandbox while resolved, none after dispose.
    expect(observed.before).toBe(0);
    expect(observed.during).toBe(1);
    expect(observed.after).toBe(0);
  });
});
