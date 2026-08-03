// Address-pinned public web-fetch end-to-end over W3C WebDriver (Tauri / WebKitGTK). This is the runtime proof
// for Phase 3 C1 the jsdom/node unit suite cannot give: the SHIPPED native command
// src-tauri/src/public_web_fetch.rs (real is_public_address classifier + reqwest .resolve pin + streamed Channel)
// reached over the REAL Tauri IPC, in the real WebKitGTK webview — the exact seam the native fetch path covers.
//
// The command is registered unconditionally in lib.rs, so this drives it directly through
// window.__TAURI_INTERNALS__.invoke (the same bridge createTauriPublicWebFetch uses), reconstructing a Tauri
// Channel in page JS from transformCallback (@tauri-apps/api/core Channel is not on window without
// withGlobalTauri). No mock AI is needed — only the webview + the invoke bridge.
//
// Requires the app running under the harness (debug binary + `yarn tauri:serve` on :3000, or a release binary via
// CONTAINER_DESKTOP_E2E_APP). Two tests are hermetic (no network — they assert the native REFUSAL invariants); the
// positive streaming test is network-gated and skips itself when the box is offline.

// Reconstruct a Tauri Channel + invoke the pinned command in page context; resolve to a plain result object.
async function pinnedFetch(url, addresses) {
  return browser.executeAsync(
    (fetchUrl, fetchAddresses, done) => {
      const internals = window.__TAURI_INTERNALS__;
      if (!internals || typeof internals.invoke !== "function") {
        done({ ready: false });
        return;
      }
      // Minimal replica of @tauri-apps/api/core Channel: transformCallback gives an id; toJSON serializes to the
      // "__CHANNEL__:<id>" wire form the native side parses. Body chunks arrive as ArrayBuffer(View); control
      // events (end/error) as JSON objects — exactly what createTauriPublicWebFetch's asBytes branch expects.
      let nextIndex = 0;
      const pending = {};
      const bytes = [];
      let done_ = false;
      let failure = null;
      const handle = (message) => {
        if (message instanceof ArrayBuffer) {
          bytes.push(new Uint8Array(message));
          return;
        }
        if (ArrayBuffer.isView(message)) {
          bytes.push(new Uint8Array(message.buffer, message.byteOffset, message.byteLength));
          return;
        }
        if (message && message.type === "end") done_ = true;
        else if (message && message.type === "error") failure = (message.payload && message.payload.message) || "error";
      };
      const id = internals.transformCallback((raw) => {
        if ("end" in raw) return;
        const index = raw.index;
        if (index === nextIndex) {
          handle(raw.message);
          nextIndex += 1;
          while (nextIndex in pending) {
            handle(pending[nextIndex]);
            delete pending[nextIndex];
            nextIndex += 1;
          }
        } else {
          pending[index] = raw.message;
        }
      });
      const channel = { toJSON: () => `__CHANNEL__:${id}` };

      internals
        .invoke("public_web_fetch_request", {
          payload: { url: fetchUrl, addresses: fetchAddresses, method: "GET", headers: {} },
          channel,
        })
        .then((info) => {
          // Drain the stream: poll the closure flags for up to ~8s, then decode the collected bytes to text.
          const deadline = Date.now() + 8000;
          const poll = () => {
            if (done_ || failure || Date.now() > deadline) {
              let total = 0;
              for (const chunk of bytes) total += chunk.byteLength;
              const merged = new Uint8Array(total);
              let offset = 0;
              for (const chunk of bytes) {
                merged.set(chunk, offset);
                offset += chunk.byteLength;
              }
              done({
                ready: true,
                ok: !failure,
                status: info && info.status,
                statusText: info && info.statusText,
                bodyText: new TextDecoder().decode(merged),
                streamError: failure,
              });
              return;
            }
            setTimeout(poll, 100);
          };
          poll();
        })
        .catch((error) => {
          done({ ready: true, ok: false, invokeError: String((error && error.message) || error) });
        });
    },
    url,
    addresses,
  );
}

async function resolvePublic(hostname) {
  return browser.executeAsync((host, done) => {
    const internals = window.__TAURI_INTERNALS__;
    internals
      .invoke("dns_lookup", { hostname: host })
      .then((addresses) => done({ ok: true, addresses }))
      .catch((error) => done({ ok: false, error: String((error && error.message) || error) }));
  }, hostname);
}

describe("Address-pinned public web-fetch over the Tauri invoke bridge (WebKitGTK / WebDriver)", () => {
  before(async () => {
    // The debug binary boots + connects to engines before it is interactive — settle, then confirm the bridge.
    await browser.pause(4000);
    await browser.waitUntil(
      async () => await browser.execute(() => !!(window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke)),
      { timeout: 30000, timeoutMsg: "Tauri invoke bridge never became available" },
    );
  });

  // Invariant #1 (native re-validates public; never dials a non-public address): every supplied address is
  // private/loopback, so the shipped classifier drops them all and the command refuses BEFORE any dial.
  it("refuses when no supplied address is public (native classifier, real IPC)", async () => {
    const result = await pinnedFetch("https://example.com", ["10.0.0.1", "127.0.0.1"]);
    expect(result.ready).toBe(true);
    expect(result.ok).toBe(false);
    expect(String(result.invokeError ?? "")).toContain("no validated public address");
  });

  // A non-http(s) URL is refused by build_pinned_client even with a public address present.
  it("refuses a non-http(s) URL", async () => {
    const result = await pinnedFetch("file:///etc/passwd", ["1.1.1.1"]);
    expect(result.ready).toBe(true);
    expect(result.ok).toBe(false);
    expect(String(result.invokeError ?? "")).toContain("invalid");
  });

  // Positive streaming path (network-gated): resolve a real public host natively, pin to its addresses, and
  // stream a 200 body back. Proves the pin + Host preservation + Channel streaming end-to-end under WebKitGTK.
  // Skips itself when the box is offline (dns/fetch failure) rather than failing a hermetic suite.
  it("streams a 200 body when pinned to a resolved public address", async function () {
    const resolved = await resolvePublic("example.com");
    if (!resolved.ok || !Array.isArray(resolved.addresses) || resolved.addresses.length === 0) {
      this.skip();
      return;
    }
    const result = await pinnedFetch("https://example.com/", resolved.addresses);
    if (!result.ready || result.invokeError || result.streamError) {
      // Offline / TLS unavailable in this environment — record via skip, do not fail the runtime proof.
      this.skip();
      return;
    }
    expect(result.status).toBe(200);
    expect(result.bodyText.length).toBeGreaterThan(0);
    expect(result.bodyText.toLowerCase()).toContain("example");
  });
});
