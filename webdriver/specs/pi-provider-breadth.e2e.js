import { strict as assert } from "node:assert";

// The picker's source list on the WebKitGTK shell, now that pi's own catalogue is behind it.
//
// What is under test is BREADTH plus the structure staying exactly as it was: the app's own sources first, in their
// own Local / Cloud groups and their own order, then one further group holding the providers pi ships that this app
// has no entry for. A row there says how many models pi publishes, and drilling into it lists them — with no key, no
// network and no settings entry, because a generated catalogue asks nobody.
//
// The chrome is asserted too (header, search, back) since the picker's look is deliberate and additive changes must
// not have moved it.

const SCREEN = '[data-screen="ai.assistant"]';
const TRIGGER = ".ModelPickerTrigger";
const POPOVER = ".ModelPicker";

let root = {};
let browsed = {};

describe("the picker's source list", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/assistant";
    });
    await $(SCREEN).waitForExist({ timeout: 45000, timeoutMsg: "the Assistant screen never mounted" });
    await $(`${SCREEN} ${TRIGGER}`).waitForExist({
      timeout: 30000,
      timeoutMsg: "the composer's model chip never appeared",
    });
    await browser.execute(
      (screen, trigger) => {
        document.querySelector(`${screen} ${trigger}`)?.click();
      },
      SCREEN,
      TRIGGER,
    );
    await $(POPOVER).waitForExist({ timeout: 15000, timeoutMsg: "the picker popover never opened" });
    await browser.pause(700);

    root = await browser.execute((popover) => {
      const dividers = Array.from(document.querySelectorAll(`${popover} .bp6-menu-header`));
      const rows = Array.from(document.querySelectorAll(`${popover} .bp6-menu-item`));
      const header = document.querySelector(`${popover} .ModelNavigatorHeader`);
      const style = header ? getComputedStyle(header) : null;
      const rowStyle = rows[0] ? getComputedStyle(rows[0]) : null;
      return {
        groups: dividers.map((node) => node.textContent?.trim() ?? ""),
        rows: rows.map((node) => ({
          label: node.querySelector(".bp6-text-overflow-ellipsis")?.textContent?.trim() ?? "",
          right: node.querySelector(".bp6-menu-item-label")?.textContent?.trim() ?? "",
          published: node.classList.contains("ProviderSourcePublished"),
        })),
        // The chrome the look depends on.
        chrome: {
          hasSearch: !!document.querySelector(`${popover} .ModelNavigatorSearch`),
          hasTitle: !!document.querySelector(`${popover} .ModelNavigatorTitle`),
          headerPad: style?.padding ?? "",
          rowFontSize: rowStyle?.fontSize ?? "",
        },
      };
    }, POPOVER);

    // Drill into a provider only pi carries. Mistral is in pi's catalogue and not in provider-catalog.json.
    const drilled = await browser.execute((popover, name) => {
      const rows = Array.from(document.querySelectorAll(`${popover} .bp6-menu-item`));
      const row = rows.find((node) => (node.querySelector(".bp6-text-overflow-ellipsis")?.textContent ?? "").trim() === name);
      row?.click();
      return !!row;
    }, POPOVER, "Mistral");
    await browser.pause(1500);

    browsed = {
      drilled,
      ...(await browser.execute((popover) => {
        const rows = Array.from(document.querySelectorAll(`${popover} .bp6-menu-item`));
        return {
          title: document.querySelector(`${popover} .ModelNavigatorTitle`)?.textContent?.trim() ?? "",
          notice: document.querySelector(`${popover} .ModelNavigatorUnkeyed`)?.textContent?.trim() ?? "",
          rows: rows.map((node) => ({
            id: node.querySelector(".ModelRowId")?.textContent?.trim() ?? "",
            facts: node.querySelector(".ModelRowFacts")?.textContent?.trim() ?? "",
            thinks: node.querySelector(".ModelRowThinks")?.textContent?.trim() ?? "",
          })),
        };
      }, POPOVER)),
    };
    await browser.keys(["Escape"]);
  });

  it("keeps the app's own groups, in order, ahead of pi's", () => {
    assert.deepEqual(
      root.groups.slice(0, 2),
      ["Local", "Cloud"],
      `the app's own groups come first and unchanged, got ${JSON.stringify(root.groups)}`,
    );
    assert.ok(
      root.groups.some((title) => title.includes("More providers")),
      `pi's breadth sits behind its own heading, got ${JSON.stringify(root.groups)}`,
    );
    const localFirst = root.rows.findIndex((row) => row.label === "LM Studio");
    const piFirst = root.rows.findIndex((row) => row.published);
    assert.ok(localFirst >= 0 && localFirst < piFirst, "the sources in daily use stay at the top");
  });

  it("offers what pi ships, each row saying how many models it publishes", () => {
    const published = root.rows.filter((row) => row.published);
    assert.ok(published.length > 20, `pi ships far more than the app's eight, got ${published.length}`);
    for (const row of published) {
      assert.match(row.right, /\d+\s+model/, `${row.label} must say its count, got ${JSON.stringify(row.right)}`);
    }
  });

  // The picker's look is deliberate: this change is additive, so the chrome must be untouched.
  it("leaves the picker's own chrome alone", () => {
    assert.ok(root.chrome.hasSearch, "the search box is part of the picker");
    assert.ok(root.chrome.hasTitle, "so is the title");
    assert.equal(root.chrome.headerPad, "8px", "the header padding is unchanged");
    assert.equal(root.chrome.rowFontSize, "13px", "the row font size is unchanged");
  });

  it("lists a pi-only provider's published models, with no key and no network", () => {
    assert.ok(browsed.drilled, `the Mistral row must be in the list, saw ${JSON.stringify(root.rows.map((r) => r.label))}`);
    assert.equal(browsed.title, "Mistral", "the panel drilled into it");
    assert.match(browsed.notice, /not set up here yet/, `it says why, got ${JSON.stringify(browsed.notice)}`);
    assert.ok(browsed.rows.length > 5, `pi publishes Mistral's catalogue, got ${browsed.rows.length}`);
    for (const row of browsed.rows) {
      assert.match(row.facts, /ctx/, `${row.id} must state its window, got ${JSON.stringify(row.facts)}`);
    }
    assert.ok(
      browsed.rows.some((row) => row.thinks),
      "pi publishes reasoning for some of them",
    );
  });
});
