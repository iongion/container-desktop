import { existsSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AppSession, headlessFromEnv, launchApp, productionMainPath } from "./app-harness";

type MockEngineSpec = {
  engine: "podman" | "docker";
  defaultConnectionId: string;
  counts: {
    containers: number;
    images: number;
    networks: number;
    pods?: number;
    volumes: number;
  };
};

const skipReason = !existsSync(productionMainPath())
  ? "no production build - run `cross-env ENVIRONMENT=production yarn build`"
  : process.platform === "linux" && !process.env.DISPLAY && !headlessFromEnv()
    ? "no DISPLAY on Linux - run under a display, or set CONTAINER_DESKTOP_HEADLESS=1 (with xvfb)"
    : null;

if (skipReason) {
  console.warn(`[ui] mock backend skipped: ${skipReason}`);
}

const suite = skipReason ? describe.skip : describe;

const specs: MockEngineSpec[] = [
  {
    engine: "podman",
    defaultConnectionId: "mock.podman.system",
    counts: {
      containers: 9,
      images: 4,
      networks: 2,
      pods: 12,
      volumes: 2,
    },
  },
  {
    engine: "docker",
    defaultConnectionId: "mock.docker.system",
    counts: {
      containers: 9,
      images: 5,
      networks: 2,
      volumes: 2,
    },
  },
];

async function launchMockApp(engine: MockEngineSpec["engine"]) {
  const previousMock = process.env.CONTAINER_DESKTOP_MOCK;
  process.env.CONTAINER_DESKTOP_MOCK = engine;
  try {
    return await launchApp({ preloadTimeoutMs: 45_000 });
  } finally {
    if (previousMock === undefined) {
      delete process.env.CONTAINER_DESKTOP_MOCK;
    } else {
      process.env.CONTAINER_DESKTOP_MOCK = previousMock;
    }
  }
}

async function waitReady(page: Page) {
  await page.waitForFunction(
    () => {
      const html = document.documentElement;
      return html.dataset.phase === "ready" && html.dataset.running === "yes" && html.dataset.provisioned === "yes";
    },
    undefined,
    { timeout: 45_000 },
  );
}

async function navigate(page: Page, route: string) {
  await page.evaluate((nextRoute) => {
    if (window.location.hash !== `#${nextRoute}`) {
      window.location.hash = nextRoute;
    }
  }, route);
  await waitReady(page);
}

async function expectRows(page: Page, route: string, selector: string, minimum: number) {
  await navigate(page, route);
  await page.waitForFunction(
    (args: { selector: string; minimum: number }) => document.querySelectorAll(args.selector).length >= args.minimum,
    { selector, minimum },
    { timeout: 30_000 },
  );
  expect(await page.locator(selector).count()).toBeGreaterThanOrEqual(minimum);
}

for (const spec of specs) {
  suite(`mock ${spec.engine} UI`, () => {
    let session: AppSession;

    beforeAll(async () => {
      session = await launchMockApp(spec.engine);
      await waitReady(session.page);
    }, 90_000);

    afterAll(async () => {
      await session?.close().catch(() => {});
    });

    it("uses the mock system connection as the default connected row", async () => {
      await navigate(session.page, "/screens/connections/manage");

      const connectionRows = session.page.locator('[data-table="host.connections"] tbody tr');
      expect(await connectionRows.count()).toBeGreaterThanOrEqual(8);
      expect(await session.page.locator('tr[data-connection-id^="mock."]').count()).toBe(8);

      const row = session.page.locator(`tr[data-connection-id="${spec.defaultConnectionId}"]`);
      await row.waitFor({ timeout: 10_000 });
      expect(await row.getAttribute("data-connection-is-default")).toBe("yes");
      expect(await row.getAttribute("data-connection-is-current")).toBe("yes");
      expect(await row.getAttribute("data-connection-is-connected")).toBe("yes");
      expect(await row.getAttribute("data-connection-is-system")).toBe("yes");
    });

    it("renders core inventory screens from deterministic fixtures", async () => {
      await expectRows(session.page, "/screens/containers", "[data-container]", spec.counts.containers);
      await expectRows(session.page, "/screens/images", "[data-image]", spec.counts.images);
      await expectRows(session.page, "/screens/networks", "[data-network]", spec.counts.networks);
      if (spec.counts.pods) {
        await expectRows(session.page, "/screens/pods", "[data-pod]", spec.counts.pods);
      }
      await expectRows(session.page, "/screens/volumes", '[data-table="volumes"] tbody tr', spec.counts.volumes);
    });

    if (spec.engine === "podman") {
      it("renders the image security report from the mock scanner command", async () => {
        await navigate(session.page, "/screens/images");
        const imageId = await session.page.locator("[data-image]").first().getAttribute("data-image");
        expect(imageId).toBeTruthy();

        await expectRows(
          session.page,
          `/screens/image/${encodeURIComponent(imageId || "")}/security`,
          '[data-table="image.scanning.report"] tbody tr[data-severity]',
          2,
        );
      });
    }
  });
}
