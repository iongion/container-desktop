// Regression proof that OMA's real runTeam path works in the WebKitGTK webview without Node built-ins.
import { strict as assert } from "node:assert";

describe("OMA webview node-blocker proof (WebKitGTK)", () => {
  it("runs OMA runTeam end-to-end in the WebKitGTK webview with no node error", async () => {
    await browser.waitUntil(
      async () => browser.execute(() => document.documentElement?.getAttribute("data-phase") === "ready"),
      { timeout: 90000, timeoutMsg: "app never reached data-phase=ready" },
    );

    const result = await browser.executeAsync((done) => {
      import("/src/packages/ai-system/tests/runtime/omaShim/webviewSmoke.ts")
        .then((m) => m.omaWebviewSmoke())
        .then((r) => done(r))
        .catch((e) => done({ ok: false, importError: String((e && (e.stack || e.message)) || e) }));
    });

    console.log("OMA WEBKITGTK PROOF:", JSON.stringify(result));
    assert.equal(result.ok, true, `expected ok:true (no node error), got ${JSON.stringify(result)}`);
    assert.equal(result.success, true, `expected success:true (runTeam completed), got ${JSON.stringify(result)}`);
    assert.equal(result.status, "ok", `expected status:ok, got ${JSON.stringify(result)}`);
  });
});
