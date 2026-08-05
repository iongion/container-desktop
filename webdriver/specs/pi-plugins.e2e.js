import { strict as assert } from "node:assert";

// Verifies the Plugins sub-screen on the real renderer. The container half — pi's package manager, install,
// enable/disable, persistence — is covered end to end against a real container and a real published package
// by `node support/pi-plugins-probe.mjs`; this spec covers what only the app can answer: that the rows the
// bridge reports are built and painted, that the actions route back through the client, and that the install
// drawer refuses a dangerous source before anything is sent.
//
// Everything goes into ONE session, read back as DOM snapshots, with ONE saveScreenshot per run (a command
// after a second one hangs and takes the session with it).

const CONFIGURED = [
  { source: "npm:@acme/deploy-kit", scope: "user", filtered: false, installedPath: "/pkgs/deploy-kit" },
  { source: "git:github.com/acme/pi-notes@v2", scope: "user", filtered: false, installedPath: "/pkgs/notes" },
  { source: "npm:@acme/paused", scope: "user", filtered: true, installedPath: "/pkgs/paused", autoload: false },
  { source: "npm:@acme/missing", scope: "project", filtered: false },
];

const RESOURCES = {
  extensions: [{ path: "/pkgs/deploy-kit/index.ts", source: "npm:@acme/deploy-kit" }],
  commands: [{ name: "deploy", description: "Ship it", source: "npm:@acme/deploy-kit" }],
  skills: [{ name: "release-notes", description: "Draft notes", source: "git:github.com/acme/pi-notes@v2" }],
  prompts: [{ name: "changelog", description: "Write a changelog", source: "npm:@acme/deploy-kit" }],
};

let empty = {};
let table = {};
let drawer = {};
let afterDisable = {};

describe("pi plugins screen", () => {
  before(async () => {
    await browser.execute(() => {
      window.location.hash = "#/screens/ai/plugins";
    });
    await $('[data-screen="ai.plugins"]').waitForExist({
      timeout: 45000,
      timeoutMsg: "the Plugins screen never mounted",
    });

    // The mock app boots WITH a scripted session, so "no session" is now something to arrange rather than
    // assume. Drop the client before reading the empty state — this is the screen a user sees before any
    // session has reported a plugin.
    await browser.execute(() => {
      window.__cdCodingAgentStore.setState({ client: undefined, status: "idle" });
      window.__cdPluginStore.setState({ rows: [], updatable: [] });
    });
    await browser.waitUntil(
      async () => (await browser.execute(() => document.querySelectorAll('[data-table="ai-plugins"] tbody tr').length)) === 0,
      { timeout: 5000, timeoutMsg: "the plugin table never emptied after the session was dropped" },
    );

    empty = await browser.execute(() => ({
      nonIdeal: document.querySelector(".bp6-non-ideal-state-visual") !== null,
      title: document.querySelector(".bp6-non-ideal-state .bp6-heading")?.textContent ?? "",
      tabs: Array.from(document.querySelectorAll(".AISectionTabBar a")).map((anchor) => ({
        text: anchor.textContent ?? "",
        href: anchor.getAttribute("href") ?? "",
        active: anchor.classList.contains("bp6-active"),
      })),
      rows: document.querySelectorAll('[data-table="ai-plugins"] tbody tr').length,
    }));

    // A recording stand-in for the session's bridge client. The store's own refresh() runs against it, so
    // buildPluginRows and the whole render path are the ones a live session uses.
    await browser.execute(
      (configured, resources) => {
        window.__cdPluginCalls = [];
        window.__cdCodingAgentStore.setState({
          status: "ready",
          client: {
            listPlugins: async () => ({ configured }),
            listResources: async () => resources,
            installPlugin: async (source, scope) => window.__cdPluginCalls.push(["install", source, scope]),
            removePlugin: async (source, scope) => window.__cdPluginCalls.push(["remove", source, scope]),
            updatePlugins: async (source) => window.__cdPluginCalls.push(["update", source ?? null]),
            checkPluginUpdates: async () => {
              window.__cdPluginCalls.push(["checkUpdates"]);
              return ["npm:@acme/deploy-kit"];
            },
            setPluginEnabled: async (source, enabled, scope) =>
              window.__cdPluginCalls.push(["setEnabled", source, enabled, scope]),
            reloadSession: async () => window.__cdPluginCalls.push(["reload"]),
            // pi's own `/trust`, which the install drawer reads to decide whether the project scope can be chosen.
            // The spec moves this the way trusting a project would.
            runCommand: async (name, args) => {
              window.__cdPluginCalls.push(["runCommand", name, args]);
              if (name !== "trust") return { ok: true };
              if (args) window.__cdPluginTrust = args === "on";
              return { ok: true, data: { trust: { decision: window.__cdPluginTrust ?? null, matters: true, path: "/workspace" } } };
            },
            onEvent: () => () => {},
            prompt: async () => {},
            abort: async () => {},
            respond: async () => {},
            connect: async () => {},
            close: () => {},
          },
        });
        window.__cdPluginStore.getState().attach();
      },
      CONFIGURED,
      RESOURCES,
    );

    await $('[data-table="ai-plugins"] tbody tr').waitForExist({
      timeout: 20000,
      timeoutMsg: "the plugin table never rendered a row",
    });

    // A progress line from the container has to be legible while an install runs.
    await browser.execute(() => {
      window.__cdPluginStore.getState().applyBridgeEvent({
        type: "plugin_progress",
        source: "npm:@acme/deploy-kit",
        action: "install",
        phase: "progress",
        message: "fetching @acme/deploy-kit",
      });
    });
    await browser.pause(300);

    table = await browser.execute(() => {
      const rows = Array.from(document.querySelectorAll('[data-table="ai-plugins"] tbody tr'));
      const cell = (row, column) => row.querySelector(`td[data-column="${column}"]`)?.textContent?.trim() ?? "";
      const tags = (row, column) =>
        Array.from(row.querySelectorAll(`td[data-column="${column}"] .bp6-tag`)).map(
          (tag) => tag.textContent?.trim() ?? "",
        );
      return {
        count: rows.length,
        names: rows.map((row) => row.querySelector(".PluginNameText")?.textContent ?? ""),
        // The source is the title, so a row identifies the package even when the display name is short.
        titles: rows.map((row) => row.querySelector(".PluginNameText")?.getAttribute("title") ?? ""),
        // Blueprint 6 wraps the icon in a `bp6-icon` span and puts the name on the inner svg's `data-icon`.
        kindIcons: rows.map((row) => row.querySelector(".PluginName svg[data-icon]")?.getAttribute("data-icon") ?? ""),
        scopes: rows.map((row) => cell(row, "Scope")),
        states: rows.map((row) => tags(row, "State")),
        commands: rows.map((row) => tags(row, "Commands")),
        skills: rows.map((row) => tags(row, "Skills")),
        prompts: rows.map((row) => tags(row, "Prompts")),
        dimmed: rows.filter((row) => row.getAttribute("data-enabled") === "false").length,
        selectionLast: rows.every(
          (row) => row.lastElementChild?.getAttribute("data-column") === "select",
        ),
        rowMenus: document.querySelectorAll('[data-table="ai-plugins"] .ResourceItemInlineActionsMenu').length,
        progress: document.querySelector(".PluginProgress")?.textContent ?? "",
        headerCta: document.querySelector(".ResourceListActionButton")?.textContent ?? "",
        headerReload: document.querySelectorAll(".ResourceListActionsReload").length,
      };
    });

    // The row's Disable button must reach the client and then ask pi to reload, or a disabled plugin stays
    // loaded for the rest of the session.
    await browser.execute(() => {
      const buttons = Array.from(document.querySelectorAll('[data-table="ai-plugins"] tbody tr button'));
      buttons.find((button) => (button.textContent ?? "").includes("Disable"))?.click();
    });
    await browser.pause(600);
    afterDisable = await browser.execute(() => ({ calls: window.__cdPluginCalls }));

    // The install drawer: a source is parsed as it is typed, and the containment warning is not optional.
    await browser.execute(() => {
      const cta = Array.from(document.querySelectorAll(".ResourceListActionButton")).find((button) =>
        (button.textContent ?? "").includes("Install"),
      );
      cta?.click();
    });
    await $("#pluginSource").waitForExist({ timeout: 15000, timeoutMsg: "the install drawer never opened" });

    const type = async (value) => {
      await browser.execute((text) => {
        const input = document.querySelector("#pluginSource");
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, text);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);
      await browser.pause(300);
    };

    await type("npm:evil;rm -rf /");
    const rejected = await browser.execute(() => ({
      problem: document.querySelector(".PluginSourceProblem")?.textContent ?? "",
      submitDisabled: document.querySelector('#pluginSource ~ * button[type="submit"]') === null,
      installDisabled: Array.from(document.querySelectorAll('button[type="submit"]')).some((button) =>
        button.hasAttribute("disabled"),
      ),
    }));

    await type("npm:@acme/deploy-kit@2.1.0");
    const accepted = await browser.execute(() => ({
      tags: Array.from(document.querySelectorAll(".PluginSourcePreview .bp6-tag")).map(
        (tag) => tag.textContent?.trim() ?? "",
      ),
      name: document.querySelector(".PluginSourceName")?.textContent ?? "",
      notice: document.querySelector(".PluginInstallNotice")?.textContent ?? "",
      installDisabled: Array.from(document.querySelectorAll('button[type="submit"]')).some((button) =>
        button.hasAttribute("disabled"),
      ),
    }));

    // pi writes a project's own packages only on a TRUSTED project, so the choice is offered against pi's own
    // decision — read by pi's own command, which the mock answers undecided.
    const untrusted = await browser.execute(() => {
      const select = document.querySelector("#pluginScope");
      return {
        options: Array.from(select?.options ?? []).map((option) => option.value),
        value: select?.value,
        disabled: select?.hasAttribute("disabled") ?? false,
        help: select?.closest(".bp6-form-group")?.querySelector(".bp6-form-helper-text")?.textContent ?? "",
      };
    });

    // Trust it the way the session settings do, then reopen: the same read now answers yes.
    await browser.executeAsync((done) => {
      window.__cdCodingAgentStore
        .getState()
        .runPiCommand("trust", "on")
        .then(() => done(true));
    });
    await browser.pause(200);
    await browser.execute(() => {
      document.querySelector(".AppInstallPluginDrawer .AppDrawerHeaderActions button:last-child")?.click();
    });
    await browser.pause(400);
    await browser.execute(() => {
      const cta = Array.from(document.querySelectorAll(".ResourceListActionButton")).find((button) =>
        (button.textContent ?? "").includes("Install"),
      );
      cta?.click();
    });
    await $("#pluginScope").waitForExist({ timeout: 15000, timeoutMsg: "the install drawer never reopened" });
    await browser.pause(500);
    const trustedScope = await browser.execute(() => {
      const select = document.querySelector("#pluginScope");
      return { disabled: select?.hasAttribute("disabled") ?? false };
    });

    drawer = { rejected, accepted, untrusted, trustedScope };
    await browser.saveScreenshot(process.env.PI_PLUGINS_SHOT || "/tmp/pi-plugins.png");
  });

  it("offers the AI sections and an empty state before a session reports any plugin", () => {
    assert.equal(empty.rows, 0, "no session must mean no rows");
    assert.ok(empty.nonIdeal, "the empty state must be shown");
    assert.match(empty.title, /No plugins installed/);
    assert.deepEqual(
      empty.tabs.map((tab) => tab.href.replace(/^.*#/, "#")),
      ["#/screens/ai/assistant", "#/screens/ai/plugins"],
      "the tab bar must link the two AI screens that exist",
    );
    assert.ok(
      empty.tabs.find((tab) => tab.href.endsWith("/plugins"))?.active,
      "the Plugins tab must be lit on the Plugins screen",
    );
  });

  it("builds one row per configured package, named and classified", () => {
    assert.equal(table.count, 4);
    assert.deepEqual(table.names, ["@acme/deploy-kit", "acme/pi-notes", "@acme/paused", "@acme/missing"]);
    assert.deepEqual(table.titles[1], "git:github.com/acme/pi-notes@v2");
    assert.deepEqual(table.kindIcons, ["box", "git-branch", "box", "box"]);
    assert.deepEqual(table.scopes, ["User", "User", "User", "Project"]);
  });

  it("shows the enabled state and what each plugin contributes", () => {
    assert.deepEqual(table.states[0], ["Enabled"]);
    assert.deepEqual(table.states[2], ["Disabled"], "autoload off must read as disabled");
    assert.deepEqual(table.states[3], ["Enabled", "Not installed"], "a configured package with no path on disk");
    assert.equal(table.dimmed, 1, "only the disabled row is dimmed");
    assert.deepEqual(table.commands[0], ["/deploy"]);
    assert.deepEqual(table.prompts[0], ["/changelog"]);
    assert.deepEqual(table.skills[1], ["release-notes"], "attributed to the git package, not the npm one");
    assert.deepEqual(table.skills[0], [], "a contribution belongs to exactly one package");
  });

  it("keeps the table conventions: selection last, one inline menu per row, header CTA and reload", () => {
    assert.ok(table.selectionLast, "the selection checkbox must be the last column");
    assert.equal(table.rowMenus, 4, "every row gets the compact inline actions menu");
    assert.match(table.headerCta, /Install plugin/);
    assert.equal(table.headerReload, 1, "the header keeps a single trailing reload");
  });

  it("shows the container's install progress", () => {
    assert.match(table.progress, /fetching @acme\/deploy-kit/);
  });

  it("offers both of pi's package scopes, and only lets the project one be chosen once pi trusts the project", () => {
    assert.deepEqual(drawer.untrusted.options, ["user", "project"]);
    assert.equal(drawer.untrusted.value, "user", "the agent's own settings are the default");
    assert.equal(drawer.untrusted.disabled, true, "an untrusted project must not be installable into");
    assert.match(drawer.untrusted.help, /not trusted/);
    assert.equal(drawer.trustedScope.disabled, false, "trusting the project must open the choice");
  });

  it("routes a row's Disable through the bridge and reloads pi", () => {
    assert.deepEqual(afterDisable.calls[0], ["setEnabled", "npm:@acme/deploy-kit", false, "user"]);
    assert.deepEqual(afterDisable.calls[1], ["reload"], "pi must reload or the plugin stays loaded");
  });

  it("refuses a source with shell characters before anything is sent", () => {
    assert.match(drawer.rejected.problem, /shell characters/);
    assert.ok(drawer.rejected.installDisabled, "Install must stay disabled while the source is invalid");
  });

  it("previews a valid source and states that plugin code runs in the container", () => {
    assert.deepEqual(drawer.accepted.tags, ["npm", "2.1.0"]);
    assert.equal(drawer.accepted.name, "@acme/deploy-kit");
    assert.match(drawer.accepted.notice, /runs third-party code inside the agent container/);
    assert.ok(!drawer.accepted.installDisabled, "a valid source enables Install");
  });
});
