// Settings → Lifecycle hooks, end to end on the mock: a hook added on the screen is listed there, and a container's
// start runs it — a failing before-start hook (`false`, which the mock answers with exit 1 like the real program)
// refuses the start and says why. Routes come from the screens' own paths; the container comes from the live list.

import { keystrokeChunks } from "../support/keystrokes.js";
import { expectAtLeast, navigate, waitReady } from "../support/mockApp.js";

const CONTAINERS = "/screens/containers";
const HOOKS = "/screens/settings/user-settings?category=hooks";

async function typeInto(selector, text) {
  const input = await $(selector);
  await input.click();
  for (const chunk of keystrokeChunks(text)) {
    await browser.keys(chunk);
  }
}

// A stopped container, read from its own detail screen: the list shortens names inside a group, the detail header's
// breadcrumb shows the whole one, and its Start button is always there.
async function pickStoppedContainer() {
  await navigate(browser, CONTAINERS);
  await expectAtLeast(browser, 'tr[data-state="exited"] .ContainerLogsButton', 1, 30000);
  const href = await browser.execute(
    () => document.querySelector('tr[data-state="exited"] .ContainerLogsButton')?.getAttribute("href") ?? "",
  );
  // The link is absolute (http://localhost:3000/#/screens/…); the route is what follows the hash.
  const route = href.slice(href.indexOf("#") + 1);
  const connectionId = new URLSearchParams(route.split("?")[1] ?? "").get("connId") ?? "";
  await navigate(browser, route);
  // The container's own crumb (tabbedCrumbs) links to its Inspect screen and carries its whole name.
  const crumb = '.AppBreadcrumbs a.bp6-breadcrumb[href*="/inspect"]';
  await (await $(crumb)).waitForExist({ timeout: 15000 });
  const name = await browser.execute((selector) => document.querySelector(selector)?.textContent?.trim() ?? "", crumb);
  return { route, name, connectionId };
}

describe("lifecycle hooks — settings screen and a container start", () => {
  let target;

  it("lists a hook added on the Lifecycle hooks screen", async () => {
    await waitReady(browser, 90000);
    target = await pickStoppedContainer();
    expect(target?.name).toBeTruthy();
    expect(target?.connectionId).toBeTruthy();

    await navigate(browser, HOOKS);
    await (await $('[data-form="lifecycle-hooks"]')).waitForExist({ timeout: 15000 });
    await (await $('[data-action="hooks.add"]')).click();
    await (await $('[data-form="lifecycle-hook"]')).waitForExist({ timeout: 5000 });
    await typeInto("#hookName", target.name);
    await (await $("#hookConnection")).selectByAttribute("value", target.connectionId);
    await typeInto("#hookBeforeStart", "false");
    await (await $('[data-action="hooks.save"]')).click();
    await (await $(`tr[data-hook="container/${target.name}"]`)).waitForExist({ timeout: 10000 });
    const row = await browser.execute(
      (name) => document.querySelector(`tr[data-hook="container/${name}"]`)?.textContent ?? "",
      target.name,
    );
    expect(row).toContain("false");
  });

  it("refuses the container's start when its before-start hook fails, and says why", async () => {
    await navigate(browser, target.route);
    const startSelector = '.AppScreenHeader [data-action="container.restart"]';
    await (await $(startSelector)).waitForExist({ timeout: 15000 });
    await (await $(startSelector)).click();
    await browser.waitUntil(
      async () =>
        browser.execute(() =>
          [...document.querySelectorAll(".bp6-toast")].some((toast) => /before-start hook/.test(toast.textContent)),
        ),
      { timeout: 15000, interval: 300, timeoutMsg: "no toast named the failed before-start hook" },
    );
    const toast = await browser.execute(
      () =>
        [...document.querySelectorAll(".bp6-toast")].find((candidate) =>
          /before-start hook/.test(candidate.textContent),
        )?.textContent ?? "",
    );
    expect(toast).toContain(target.name);
    expect(toast).toContain("exit 1");
  });
});
