// Proves the credential boundary the coding agent's gateway depends on: a provider key reaches the container's
// env file WITHOUT ever entering the web view, and the web view cannot read it back.
//
// This is the path that was broken — the vault deliberately refuses getKey in this realm, so the host composes
// the file with a placeholder and the realm that OWNS the vault substitutes it while writing.
//
// Runs against a real app on either shell, and NEVER writes to the vault when it does not have to: if the
// provider already holds a secret it is used as-is and left untouched (the file's value is only ever compared
// by shape, never printed); only an empty slot gets a scratch secret, which is cleared afterwards.
import { strict as assert } from "node:assert";
import { readFileSync, rmSync, statSync } from "node:fs";

import { appModeReason, skipSuite } from "../support/prerequisites.js";

// A catalog provider is required (the host resolves its kind + auth from settings), and openrouter is the
// keyed cloud one.
const PROVIDER = "openrouter";
const SECRET = "sk-or-e2e-scratch-do-not-use";

let stored = {};
let written = {};
let readBack = {};

describe("the agent gateway's credential boundary", () => {
  before(async function agentSecretFile() {
    this.timeout(60000);
    // The mock app's key store is a fixture, so nothing it wrote would prove the native substitution this is about.
    const blocked = appModeReason("real");
    if (blocked) return skipSuite(this, blocked);
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $('[data-screen="ai.assistant"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Assistant screen never mounted",
    });

    stored = await browser.executeAsync((provider, done) => {
      window.AI.hasKey(provider).then(
        (has) => done({ ok: true, has }),
        (failure) => done({ ok: false, reason: String(failure) }),
      );
    }, PROVIDER);
    assert.equal(stored.ok, true, `could not read the key state: ${stored.reason}`);

    // Drive the REAL channel a session start uses. An existing key is used untouched; an empty slot is filled
    // with the scratch secret so the substitution is still provable on a machine with no cloud key configured.
    written = await browser.executeAsync(
      (provider, secret, useExisting, done) => {
        const ready = useExisting ? Promise.resolve() : window.AI.setKey(provider, secret, { allowDegraded: true });
        ready
          .then(() =>
            window.AI.writeAgentGatewayEnv({
              provider,
              fileName: "e2e-scratch-gateway.env",
              baseUrl: "https://openrouter.ai/api/v1",
              bridgeToken: "e2e-bridge-token",
              gatewayPort: 8788,
            }),
          )
          .then(
            (result) => done({ ok: true, path: result.path }),
            (failure) => done({ ok: false, reason: String(failure) }),
          );
      },
      PROVIDER,
      SECRET,
      stored.has,
    );

    // Read it from NODE, not from the web view — the point is that only a realm outside the web view can.
    if (written.ok) {
      readBack = await browser.executeAsync(
        (path, done) => {
          window.FS.readTextFile(path).then(
            (text) => done({ ok: true, text }),
            (failure) => done({ ok: false, reason: String(failure) }),
          );
        },
        written.path,
      );
    }
  });

  after(async () => {
    // The file this spec wrote holds a REAL credential when the slot was already populated, so it is removed
    // whatever happens — leaving it behind would undo the very boundary the spec exists to prove.
    if (written.path) rmSync(written.path, { force: true });
    // Only clear what this spec created. A pre-existing key is the developer's, and is left exactly as found.
    if (stored.has) return;
    await browser
      .executeAsync((provider, done) => {
        window.AI.clearKey(provider).then(
          () => done(true),
          () => done(false),
        );
      }, PROVIDER)
      .catch(() => undefined);
  });

  it("writes the gateway env with the stored secret substituted by the host", () => {
    assert.equal(written.ok, true, `the gateway env was not written: ${written.reason}`);
    const contents = readFileSync(written.path, "utf8");
    // Compared by SHAPE, never printed: a failure message must not leak the developer's own key.
    const value = /^CD_UPSTREAM_API_KEY=(.*)$/m.exec(contents)?.[1] ?? "";
    assert.ok(value.length > 0, "the stored secret did not reach the env file the container is given");
    if (!stored.has) {
      assert.equal(value, SECRET, "the substituted value is not the secret that was stored");
    }
    // The placeholder is an implementation detail of the boundary and must never survive into the file.
    assert.equal(contents.includes("__CD_KEYCHAIN_SECRET__"), false, "the placeholder was left unsubstituted");
    assert.ok(contents.includes("CD_UPSTREAM_KIND=openai-compatible"), "the provider's wire shape is missing");
  });

  it("hardens the file to owner-only", () => {
    const mode = statSync(written.path).mode & 0o777;
    assert.equal(mode, 0o600, `the credential file must be 0600, got ${mode.toString(8)}`);
  });

  it("refuses to read that file back from the web view", () => {
    assert.equal(
      readBack.ok,
      false,
      "the web view read the credential file back — the boundary is decorative if this succeeds",
    );
  });
});
