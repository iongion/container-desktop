// Inventory screens over the deterministic mock backend, ported from the deleted CDP suite. The engine
// comes from CONTAINER_DESKTOP_MOCK (wdio.conf forwards it into the app), one engine per run because the app
// launches once per wdio session. Counts, routes and selectors are the ported originals.
import { expectAtLeast, navigate, waitReady } from "../support/mockApp.js";

const ENGINE = (process.env.CONTAINER_DESKTOP_MOCK || "podman").toLowerCase();
const SPECS = {
  podman: {
    defaultConnectionId: "mock.podman.system",
    counts: { containers: 9, images: 4, networks: 2, pods: 12, volumes: 2 },
  },
  docker: {
    defaultConnectionId: "mock.docker.system",
    counts: { containers: 9, images: 5, networks: 2, volumes: 2 },
  },
};
const spec = SPECS[ENGINE];

(spec ? describe : describe.skip)(`mock ${ENGINE} inventory over the webview`, () => {
  before(async () => {
    await browser.pause(4000);
    await waitReady(browser);
  });

  it("uses the mock system connection as the default connected row", async () => {
    await navigate(browser, "/screens/connections/manage");
    const observed = await browser.execute((id) => {
      const row = document.querySelector(`tr[data-connection-id="${id}"]`);
      return {
        rows: document.querySelectorAll('[data-table="host.connections"] tbody tr').length,
        mocks: document.querySelectorAll('tr[data-connection-id^="mock."]').length,
        row: row
          ? {
              isDefault: row.getAttribute("data-connection-is-default"),
              isCurrent: row.getAttribute("data-connection-is-current"),
              isConnected: row.getAttribute("data-connection-is-connected"),
              isSystem: row.getAttribute("data-connection-is-system"),
            }
          : null,
      };
    }, spec.defaultConnectionId);

    // The deterministic mock defines ten connections: podman and docker each in system/ssh/wsl/lima, plus
    // Apple Container in system/ssh.
    expect(observed.rows).toBeGreaterThanOrEqual(10);
    expect(observed.mocks).toBe(10);
    expect(observed.row).toEqual({
      isDefault: "yes",
      isCurrent: "yes",
      isConnected: "yes",
      isSystem: "yes",
    });
  });

  it("renders core inventory screens from deterministic fixtures", async () => {
    await navigate(browser, "/screens/containers");
    await expectAtLeast(browser, "[data-container]", spec.counts.containers);
    await navigate(browser, "/screens/images");
    await expectAtLeast(browser, "[data-image]", spec.counts.images);
    await navigate(browser, "/screens/networks");
    await expectAtLeast(browser, "[data-network]", spec.counts.networks);
    if (spec.counts.pods) {
      await navigate(browser, "/screens/pods");
      await expectAtLeast(browser, "[data-pod]", spec.counts.pods);
    }
    await navigate(browser, "/screens/volumes");
    await expectAtLeast(browser, '[data-table="volumes"] tbody tr', spec.counts.volumes);
  });

  // Podman only: the scanner fixture is served for that engine's mock.
  (ENGINE === "podman" ? it : it.skip)("renders the image security report from the mock scanner", async () => {
    await navigate(browser, "/screens/images");
    const imageId = await browser.execute(
      () => document.querySelector("[data-image]")?.getAttribute("data-image") ?? "",
    );
    expect(imageId).toBeTruthy();
    await navigate(browser, `/screens/image/${encodeURIComponent(imageId)}/security`);

    // Scanning is on demand — the panel reads "Not scanned yet" until this is pressed. The signature panel's
    // button carries the same class, so match on the label; it is disabled until the scan target resolves.
    const scan = await browser.$("button*=Scan for vulnerabilities");
    await scan.waitForEnabled({ timeout: 30000 });
    await scan.click();

    // Assert the REPORT, not the filtered rows: the severity filter defaults to CRITICAL + HIGH by design and
    // this fixture's findings are medium/low, so an empty table is the correct rendering of that default.
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            document.querySelectorAll('[data-table="image.scanning.report"]').length === 1 &&
            [...document.querySelectorAll(".SecuritySeverityCountPill")].reduce(
              (total, pill) => total + Number(pill.textContent || "0"),
              0,
            ) > 0,
        ),
      { timeout: 30000, interval: 500, timeoutMsg: "the scan never produced a report with findings" },
    );
  });
});
