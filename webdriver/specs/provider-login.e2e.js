import { strict as assert } from "node:assert";

// Signing in to a provider, driven on the WebKitGTK shell.
//
// The button wears pi's OWN label, and every line the drawer shows is a frame the flow raised: the progress line while
// its callback server listens, the authorization URL, and the manual-paste prompt it races that callback against. The
// paste is what completes it here, because the callback server lives inside a container the browser cannot reach.
//
// The far end of the socket is the scripted login container (mock mode), exactly as the assistant's own specs script
// the session — the renderer runs its production path: pi's frames, the verdict on the credential, the keychain write.

const SCREEN = '[data-screen="settings-settings"]';
const PANEL = '[data-category="ai"]';
const FORM = ".AIProviderConfigForm";
const ACTIONS = ".AIProviderConfigActions";
const DRAWER = ".ProviderLoginDrawer";

const clickText = (selector, text) =>
  browser.execute(
    (sel, want) => {
      const node = Array.from(document.querySelectorAll(sel)).find((item) =>
        (item.textContent ?? "").trim().includes(want),
      );
      node?.click();
      return !!node;
    },
    selector,
    text,
  );

let offered = {};
let asked = {};
let done = {};

describe("signing in to a provider", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/settings/user-settings?category=ai";
    });
    await $(`${SCREEN} ${PANEL}`).waitForExist({ timeout: 45000, timeoutMsg: "Settings → AI never mounted" });
    await $(`${SCREEN} ${FORM}`).waitForExist({ timeout: 20000, timeoutMsg: "the provider form never rendered" });

    // Configure OpenRouter: its own row in the shared source list, which is where a sign-in belongs.
    assert.equal(await clickText(`${PANEL} .bp6-menu-item`, "OpenRouter"), true, "no OpenRouter row to configure");
    await browser.waitUntil(
      async () => (await $(`${PANEL} ${FORM}`).getAttribute("data-provider")) === "openrouter",
      { timeout: 15000, timeoutMsg: "the form never switched to OpenRouter" },
    );

    offered = await browser.execute(
      (panel, actions) => {
        const buttons = Array.from(document.querySelectorAll(`${panel} ${actions} button`));
        return {
          labels: buttons.map((node) => (node.textContent ?? "").trim()),
          disabled: buttons
            .filter((node) => (node.textContent ?? "").includes("Sign in"))
            .map((node) => node.disabled),
        };
      },
      PANEL,
      ACTIONS,
    );

    assert.equal(await clickText(`${PANEL} ${ACTIONS} button`, "Sign in with OpenRouter"), true, "no sign-in button");
    await $(DRAWER).waitForExist({ timeout: 20000, timeoutMsg: "the sign-in drawer never opened" });
    await $(`${DRAWER} [data-form="provider.login"] input`).waitForExist({
      timeout: 20000,
      timeoutMsg: "the flow never asked anything",
    });

    asked = await browser.execute((drawer) => {
      const link = document.querySelector(`${drawer} .ProviderLoginAuthUrl a`);
      const label = document.querySelector(`${drawer} .bp6-form-group label`);
      return {
        title: document.querySelector(`${drawer} .bp6-heading`)?.textContent?.trim() ?? "",
        authHref: link?.getAttribute("href") ?? "",
        authTarget: link?.getAttribute("target") ?? "",
        instructions: document.querySelector(`${drawer} .ProviderLoginInstructions`)?.textContent?.trim() ?? "",
        promptLabel: label?.textContent?.trim() ?? "",
        placeholder: document.querySelector(`${drawer} [data-form="provider.login"] input`)?.placeholder ?? "",
        progress: document.querySelector(`${drawer} .ProviderLoginLog`)?.textContent?.trim() ?? "",
        inputType: document.querySelector(`${drawer} [data-form="provider.login"] input`)?.type ?? "",
      };
    }, DRAWER);
  });

  it("offers pi's own label beside the credential actions, and only there", () => {
    assert.deepEqual(offered.labels, ["Save connection", "Save credential", "Sign in with OpenRouter", "Test connection"]);
    assert.deepEqual(offered.disabled, [false], "the sign-in was offered but not clickable");
  });

  it("shows the authorization URL as a link the shell sends to the browser", () => {
    assert.equal(asked.title, "Sign in with OpenRouter");
    assert.match(asked.authHref, /^https:\/\/openrouter\.ai\/auth\?/, `unexpected auth url: ${asked.authHref}`);
    assert.equal(asked.authTarget, "_blank");
    assert.match(asked.instructions, /paste the final redirect URL/i);
  });

  it("asks pi's own question, with pi's own placeholder, unmasked", () => {
    assert.match(asked.promptLabel, /paste the authorization code \/ redirect URL/i);
    assert.match(asked.placeholder, /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    assert.equal(asked.inputType, "text", "a pasted redirect URL is not a secret to mask");
    assert.match(asked.progress, /Listening for OpenRouter OAuth callback/);
  });

  // pi reads a bare paste AS the code, so the only redirect it refuses is one whose `code` came back empty — which
  // is what the provider sends when authorization was declined on its own page.
  it("refuses a redirect URL whose code came back empty, in the flow's own words", async () => {
    await browser.execute((drawer) => {
      const input = document.querySelector(`${drawer} [data-form="provider.login"] input`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "http://127.0.0.1:41999/oauth/callback?code=");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    }, DRAWER);
    assert.equal(await clickText(`${DRAWER} button`, "Continue"), true, "no Continue button");
    await browser.waitUntil(
      async () =>
        await browser.execute(
          (drawer) => !!document.querySelector(`${drawer} .bp6-callout.bp6-intent-warning`),
          DRAWER,
        ),
      { timeout: 20000, timeoutMsg: "a codeless paste was accepted" },
    );
    const refusal = await browser.execute(
      (drawer) => document.querySelector(`${drawer} .bp6-callout.bp6-intent-warning`)?.textContent?.trim() ?? "",
      DRAWER,
    );
    assert.match(refusal, /Missing authorization code/);
  });

  // Skipping the step is the flow's own path, not a dismissal: pi's OpenRouter login hands the login back to the
  // loopback callback it was racing, and the app has to show what came of that rather than close on the user.
  it("reports what the flow said when the paste step is skipped", async () => {
    assert.equal(await clickText(`${PANEL} ${ACTIONS} button`, "Sign in with OpenRouter"), true, "no sign-in button");
    await $(`${DRAWER} [data-form="provider.login"] input`).waitForExist({
      timeout: 20000,
      timeoutMsg: "the flow never asked again",
    });
    assert.equal(await clickText(`${DRAWER} button`, "Skip this step"), true, "no skip button");
    await browser.waitUntil(
      async () =>
        await browser.execute(
          (drawer) =>
            (document.querySelector(`${drawer} .bp6-callout.bp6-intent-warning`)?.textContent ?? "").includes(
              "cancelled",
            ),
          DRAWER,
        ),
      { timeout: 20000, timeoutMsg: "skipping the step reported nothing" },
    );
  });

  it("stores the key the flow returned, and says the keychain has it", async () => {
    // A second run of the same flow, now completed with a redirect URL that carries a code — which is what the
    // browser lands on and what pi's own prompt asks for.
    assert.equal(await clickText(`${PANEL} ${ACTIONS} button`, "Sign in with OpenRouter"), true, "no sign-in button");
    await $(`${DRAWER} [data-form="provider.login"] input`).waitForExist({
      timeout: 20000,
      timeoutMsg: "the flow never asked again",
    });
    await browser.execute((drawer) => {
      const input = document.querySelector(`${drawer} [data-form="provider.login"] input`);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "http://127.0.0.1:41999/oauth/callback?code=live-code-42");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    }, DRAWER);
    assert.equal(await clickText(`${DRAWER} button`, "Continue"), true, "no Continue button");
    await browser.waitUntil(
      async () =>
        await browser.execute(
          (drawer) => !!document.querySelector(`${drawer} .bp6-callout.bp6-intent-success`),
          DRAWER,
        ),
      { timeout: 30000, timeoutMsg: "the sign-in never reported success" },
    );
    done = await browser.execute(
      (drawer) => ({
        callout: document.querySelector(`${drawer} .bp6-callout.bp6-intent-success`)?.textContent?.trim() ?? "",
        // What the VAULT was handed. The mock vault reports `hasKey` true for every provider by design, so presence
        // proves nothing — the recorded write is the only evidence of which secret was stored, and under which id.
        written: globalThis.__cdMockKeyWrites?.() ?? {},
      }),
      DRAWER,
    );
    assert.match(done.callout, /Signed in\. The key is stored in the OS keychain\./);
    assert.equal(
      done.written.openrouter,
      "sk-or-v1-mock-0123456789abcdef",
      `the key the flow returned did not reach the vault: ${JSON.stringify(done.written)}`,
    );
  });
});
