import { existsSync } from "node:fs";
import type { Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AppSession, headlessFromEnv, launchApp, productionMainPath } from "./app-harness";

// Swarm UI over the deterministic mock backend (no Docker needed). Reuses the mock-backend harness:
// launchApp() with CONTAINER_DESKTOP_MOCK=docker; the scenario rides CONTAINER_DESKTOP_MOCK_SWARM
// (main-side, read by mockApiAdapter). `manager` → populated tabs; `none` → the Initialize empty-state.
const skipReason = !existsSync(productionMainPath())
  ? "no production build - run `cross-env ENVIRONMENT=production yarn build`"
  : process.platform === "linux" && !process.env.DISPLAY && !headlessFromEnv()
    ? "no DISPLAY on Linux - run under a display, or set CONTAINER_DESKTOP_HEADLESS=1 (with xvfb)"
    : null;

if (skipReason) {
  console.warn(`[ui] swarm skipped: ${skipReason}`);
}
const suite = skipReason ? describe.skip : describe;

async function launchSwarmApp(scenario: "manager" | "none") {
  const prevMock = process.env.CONTAINER_DESKTOP_MOCK;
  const prevSwarm = process.env.CONTAINER_DESKTOP_MOCK_SWARM;
  process.env.CONTAINER_DESKTOP_MOCK = "docker";
  process.env.CONTAINER_DESKTOP_MOCK_SWARM = scenario;
  try {
    return await launchApp({ preloadTimeoutMs: 45_000 });
  } finally {
    if (prevMock === undefined) {
      delete process.env.CONTAINER_DESKTOP_MOCK;
    } else {
      process.env.CONTAINER_DESKTOP_MOCK = prevMock;
    }
    if (prevSwarm === undefined) {
      delete process.env.CONTAINER_DESKTOP_MOCK_SWARM;
    } else {
      process.env.CONTAINER_DESKTOP_MOCK_SWARM = prevSwarm;
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

async function expectSelector(page: Page, selector: string, minimum: number) {
  await page.waitForFunction(
    (args: { selector: string; minimum: number }) => document.querySelectorAll(args.selector).length >= args.minimum,
    { selector, minimum },
    { timeout: 60_000 },
  );
  expect(await page.locator(selector).count()).toBeGreaterThanOrEqual(minimum);
}

suite("swarm mock UI — manager scenario", () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await launchSwarmApp("manager");
    await waitReady(session.page);
  }, 90_000);

  afterAll(async () => {
    await session?.close().catch(() => {});
  });

  it("renders the services, nodes and stacks tabs from fixtures", async () => {
    await navigate(session.page, "/screens/swarm?tab=services");
    await expectSelector(session.page, '[data-table="swarm.services"] [data-service]', 1);
    await navigate(session.page, "/screens/swarm?tab=nodes");
    await expectSelector(session.page, '[data-table="swarm.nodes"] [data-node]', 1);
    await navigate(session.page, "/screens/swarm?tab=stacks");
    await expectSelector(session.page, '[data-table="swarm.stacks"] [data-stack]', 1);
  });
});

suite("swarm mock UI — not-in-a-swarm scenario", () => {
  let session: AppSession;

  beforeAll(async () => {
    session = await launchSwarmApp("none");
    await waitReady(session.page);
  }, 90_000);

  afterAll(async () => {
    await session?.close().catch(() => {});
  });

  it("shows the Initialize Swarm empty state", async () => {
    await navigate(session.page, "/screens/swarm");
    await session.page.waitForFunction(
      () => document.body.textContent?.includes("Initialize Swarm") === true,
      undefined,
      {
        timeout: 30_000,
      },
    );
    expect(await session.page.getByText("Initialize Swarm").count()).toBeGreaterThanOrEqual(1);
  });
});
