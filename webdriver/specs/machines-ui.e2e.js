// The Machines screen lists Apple's `container machine` VMs beside Podman's, and its create drawer asks an Apple machine
// for an image instead of a disk size. Connection ids and names come from the mock's connections, the route from the
// screen's own Route.Path, the detail link from the row's href.

import { navigate, waitReady } from "../support/mockApp.js";

const APPLE = "mock.container.system";
const PODMAN = "mock.podman.system";

// The rendered rows of one connection's group: name, VM type, last up.
const rowsOf = (connectionId) =>
  browser.execute(
    (id) =>
      [...document.querySelectorAll(`[data-table="machines"] tbody tr[data-prefix-group="${id}"]`)]
        .filter((tr) => tr.querySelector(".InspectMachineButton"))
        .map((tr) => {
          const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
          return { name: cells[0], vmType: cells[1], lastUp: cells[7], href: tr.querySelector("a")?.getAttribute("href") };
        }),
    connectionId,
  );

const drawerFields = () =>
  browser.execute(() => ({
    image: Boolean(document.querySelector('[data-form="machine.create"] #machineImage')),
    disk: Boolean(document.querySelector('[data-form="machine.create"] #machineDiskSize')),
  }));

async function pickConnection(name) {
  await (await $(".bp6-drawer .ConnectionSelectButton")).click();
  const item = await $(`.ConnectionSelectMenuItem*=${name}`);
  await item.waitForClickable({ timeout: 10000 });
  await item.click();
}

describe("machines — Apple's container machine beside Podman's", () => {
  it("lists Apple machines under their connection, as Apple VMs", async () => {
    await waitReady(browser, 90000);
    await navigate(browser, "/screens/machines");
    await (await $('.AppScreenHeader input[type="search"]')).setValue("machine-default");
    await browser.waitUntil(async () => (await rowsOf(APPLE)).length > 0 && (await rowsOf(PODMAN)).length > 0, {
      timeout: 20000,
      timeoutMsg: "the search did not show both connections' default machines",
    });
    expect((await rowsOf(PODMAN)).map((row) => row.name)).toEqual(["podman-machine-default"]);
    const [apple] = await rowsOf(APPLE);
    expect(apple).toMatchObject({ name: "machine-default", vmType: "apple" });
    expect(apple.lastUp).not.toContain("Invalid");
  });

  it("opens an Apple machine's detail from its row", async () => {
    const [row] = await rowsOf(APPLE);
    expect(row.href).toContain(`connId=${APPLE}`);
    await navigate(browser, row.href.slice(row.href.indexOf("#") + 1));
    await (await $('[data-screen="machine.inspect"] .InspectSummary')).waitForExist({ timeout: 20000 });
    const text = await browser.execute(
      () => document.querySelector('[data-screen="machine.inspect"] .InspectSummary')?.textContent ?? "",
    );
    expect(text).toContain("machine-default");
    expect(text).toContain("running");
    expect(text).not.toContain("Rootful");
  });

  it("asks an Apple machine for an image, a Podman machine for a disk size, and creates it", async () => {
    await navigate(browser, "/screens/machines");
    await (await (await $(".AppScreenHeader")).$("button*=Create")).click();
    await (await $('[data-form="machine.create"]')).waitForExist({ timeout: 10000 });

    await pickConnection("System Podman");
    expect(await drawerFields()).toEqual({ image: false, disk: true });

    await pickConnection("System Container");
    expect(await drawerFields()).toEqual({ image: true, disk: false });

    await (await $("#machineName")).setValue("cd-e2e");
    await (await $("#machineImage")).setValue("debian:13");
    await (await $(".bp6-drawer form button[type='submit']")).click();
    await (await $('[data-form="machine.create"]')).waitForExist({ reverse: true, timeout: 15000 });
  });
});
