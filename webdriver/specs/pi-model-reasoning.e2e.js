import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The thinking level, per model, on the WebKitGTK shell: it is offered only for a model somebody actually published a
// reasoning capability for, and it offers exactly the efforts that were published — not pi's whole vocabulary.
//
// Four sources, all real code, driven the way a user drives it (`/model <id>` typed into the composer, `/settings`
// to read the session back):
//
//   the stand-in's own model  — its fictional provider publishes the capability, so demo mode has a real control
//   pi's own catalogue        — the levels pi ships per model, for a provider with no endpoint to ask (o3-mini)
//   `provider-catalog.json`   — the app's prefix claim, which is all anyone knows about a model pi never published
//   the provider's listing    — OpenRouter's own `reasoning` entry, with the efforts and `mandatory`
//
// pi's catalogue arriving at all is the half that could break in the shell rather than in a unit test: its generated
// data is JSON imported with an import attribute, and it has to survive the renderer bundle into WebKitGTK.
//
// The listing is served by a stub on loopback in OpenRouter's own shape, copied from the live listing, so the probe
// that reads it is the shipped one and the run needs no network and no key. The one thing this cannot prove is that
// OpenRouter still publishes that shape; `modelWindow.test.ts` carries the payload and the real listing was read.
//
// No screenshot: which levels a control offers is a DOM question.

const SCREEN = '[data-screen="ai.assistant"]';
const DRAWER = ".AssistantSettingsDrawer";
const BOOT_MODEL = "mock-assistant";
// OpenAI serves an id-only listing, so these differ only in what somebody published about them: nothing for gpt-4o,
// real levels in pi's catalogue for o3-mini, and — for a model pi has never heard of — the app's own prefix claim.
const PLAIN_MODEL = "gpt-4o";
const DECLARED_MODEL = "o3-mini";
const UNPUBLISHED_MODEL = "gpt-5-unreleased-preview";
// Mandatory reasoning, five published efforts topping out at xhigh — `qwen/qwen3.8-max` as the live listing has it.
const PUBLISHED_MODEL = "qwen/qwen3.8-max";
const PUBLISHED_ENTRY = {
  id: PUBLISHED_MODEL,
  context_length: 262144,
  supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "temperature"],
  reasoning: {
    mandatory: true,
    default_enabled: true,
    supported_efforts: ["xhigh", "high", "medium", "low", "minimal"],
    default_effort: "xhigh",
  },
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SETTINGS_FILE = path.join(
  process.env.CONTAINER_DESKTOP_USER_DATA_DIR ?? path.join(repoRoot, "webdriver", ".e2e-user-data"),
  "user-settings.json",
);

// Which source the app asks about a model is its SAVED default provider, because a scripted session was started
// without one. Read-modify-write keeps the harness's own seeded keys (the workspace fixture) intact.
const pointAppAt = (providerId, providers = {}) => {
  const settings = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  const ai = settings.ai ?? {};
  settings.ai = {
    ...ai,
    defaultProvider: providerId,
    providers: { ...(ai.providers ?? {}), ...providers },
  };
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`);
};

let stub;
let stubRequests = 0;

const startStub = () =>
  new Promise((resolve) => {
    stub = createServer((request, response) => {
      stubRequests += 1;
      const body = request.url?.startsWith("/api/v1/models") ? { data: [PUBLISHED_ENTRY] } : { data: [] };
      // The probe runs in the web view, so its origin is not this server's.
      response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      response.end(JSON.stringify(body));
    });
    stub.listen(0, "127.0.0.1", () => resolve(stub.address().port));
  });

let booted = {};
let plain = {};
let declared = {};
let unpublished = {};
let publishedLevels = {};

describe("assistant thinking level", () => {
  before(async () => {
    const port = await startStub();

    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(SCREEN).waitForExist({ timeout: 45000, timeoutMsg: "the Assistant screen never mounted" });
    await $(`${SCREEN} .AIComposerInput`).waitForExist({
      timeout: 30000,
      timeoutMsg: "the composer never appeared — the scripted session did not come up",
    });
    await browser.waitUntil(
      () => browser.execute(() => (window.__cdCodingAgentStore?.getState().sessionModel ?? "") !== ""),
      { timeout: 30000, timeoutMsg: "the session never reported a model" },
    );

    const type = async (value) => {
      await browser.execute(
        (screen, text) => {
          const input = document.querySelector(`${screen} .AIComposerInput`);
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
          setter?.call(input, text);
          input?.dispatchEvent(new Event("input", { bubbles: true }));
        },
        SCREEN,
        value,
      );
      await browser.pause(200);
    };
    const send = () =>
      browser.execute((screen) => {
        document.querySelector(`${screen} .AIComposerSend`)?.click();
      }, SCREEN);

    // What the drawer offers for the model now answering. The drawer takes its state from the answer that opened it,
    // so every reading opens a fresh one — a re-answered drawer keeps the state it mounted with.
    const readThinking = async () => {
      await type("/settings");
      await send();
      await $(DRAWER).waitForExist({ timeout: 30000, timeoutMsg: "/settings never answered with the drawer" });
      await browser.pause(400);
      const reading = await browser.execute((drawer) => {
        const rows = Array.from(document.querySelectorAll(`${drawer} .AssistantSettingsRow`));
        const row = rows.find((node) => (node.querySelector("strong")?.textContent ?? "").includes("Thinking level"));
        const active = row?.querySelector(".AssistantSettingsChoice .bp6-active");
        return {
          model: window.__cdCodingAgentStore?.getState().sessionModel ?? "",
          present: !!row,
          levels: Array.from(row?.querySelectorAll(".AssistantSettingsChoice button") ?? []).map(
            (node) => node.textContent ?? "",
          ),
          selected: active?.textContent ?? "",
          notices: Array.from(document.querySelectorAll(`${drawer} .AssistantSettingsNotice`)).map(
            (node) => node.textContent ?? "",
          ),
        };
      }, DRAWER);
      await browser.execute((drawer) => {
        document.querySelector(`${drawer} .AppDrawerHeaderActions button[aria-label="Close"]`)?.click();
      }, DRAWER);
      await $(DRAWER).waitForExist({ reverse: true, timeout: 15000, timeoutMsg: "the drawer never closed" });
      await browser.pause(200);
      return reading;
    };

    const switchTo = async (id) => {
      await type(`/model ${id}`);
      await send();
      await browser.waitUntil(
        () => browser.execute((target) => window.__cdCodingAgentStore?.getState().sessionModel === target, id),
        { timeout: 45000, timeoutMsg: `the session never moved to ${id}` },
      );
      await browser.pause(400);
      return readThinking();
    };

    booted = await readThinking();

    // OpenAI publishes nothing to ask, so these two models differ only in what the app's own catalogue declares.
    pointAppAt("openai");
    plain = await switchTo(PLAIN_MODEL);
    declared = await switchTo(DECLARED_MODEL);
    unpublished = await switchTo(UNPUBLISHED_MODEL);

    // The provider's own listing, served on loopback in OpenRouter's shape. The id stays `openrouter` because that is
    // what selects the probe; only where it looks is this spec's.
    pointAppAt("openrouter", { openrouter: { model: "", baseURL: `http://127.0.0.1:${port}/api/v1` } });
    publishedLevels = await switchTo(PUBLISHED_MODEL);
  });

  after(() => {
    stub?.close();
  });

  it("offers the levels the stand-in's own provider published", () => {
    assert.equal(booted.model, BOOT_MODEL, "the scripted session must be up before its levels mean anything");
    assert.ok(booted.present, "a model published as a reasoner must have a thinking level to set");
    assert.deepEqual(
      booted.levels,
      ["Off", "Minimal", "Low", "Medium", "High"],
      "with no efforts published, pi's own set stands — and it stops at high",
    );
    assert.equal(booted.selected, "Medium", "the level the session holds must be the one shown as active");
  });

  it("offers no level at all for a model nobody published reasoning for", () => {
    assert.equal(plain.model, PLAIN_MODEL, "the switch itself must have happened");
    assert.equal(plain.present, false, `${PLAIN_MODEL} reasons as far as nobody is concerned`);
    assert.ok(
      plain.notices.some((text) => text.includes("does not reason")),
      `the drawer must say why there is no control, got ${JSON.stringify(plain.notices)}`,
    );
  });

  // pi's own catalogue, with no request made at all: OpenAI has no endpoint that answers this, and pi ships the
  // model's published levels. o3-mini takes low, medium or high and cannot be asked to stop, so those are the levels
  // offered and there is no Off — where the app's own prefix claim could only have said "it reasons".
  it("offers the levels pi published for a model no endpoint can be asked about", () => {
    assert.equal(declared.model, DECLARED_MODEL);
    assert.ok(declared.present, `${DECLARED_MODEL} is published as a reasoner by pi's own catalogue`);
    assert.deepEqual(declared.levels, ["Low", "Medium", "High"]);
    assert.equal(declared.selected, "Medium", "the level survives a switch that still supports it");
  });

  // pi's data is a generated snapshot, so a model newer than it falls back to the app's own prefix claim — which
  // names WHICH models think and nothing more, leaving pi's own set standing.
  it("falls back to the app's own claim for a model pi never published", () => {
    assert.equal(unpublished.model, UNPUBLISHED_MODEL);
    assert.ok(unpublished.present, `${UNPUBLISHED_MODEL} matches a prefix provider-catalog.json declares`);
    assert.deepEqual(unpublished.levels, ["Off", "Minimal", "Low", "Medium", "High"]);
  });

  it("offers exactly what the provider published, including above high and without off", () => {
    assert.equal(publishedLevels.model, PUBLISHED_MODEL);
    assert.ok(stubRequests > 0, "the shipped probe must have asked the listing");
    assert.ok(publishedLevels.present, "a model whose listing publishes efforts must offer them");
    assert.deepEqual(
      publishedLevels.levels,
      ["Minimal", "Low", "Medium", "High", "Extra high"],
      "the published efforts, in pi's order — and no Off, because this model cannot be asked to stop reasoning",
    );
    assert.equal(publishedLevels.selected, "Medium");
  });
});
