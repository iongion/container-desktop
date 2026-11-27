// A container offers Pause only when its own connection can pause: Apple Container cannot (socktainer answers
// "not supported"), Docker can. The container ids come from the in-realm engine snapshot (the mock's data), the route
// from the container screen's own logs path; the detail header shows Pause inline when the connection can pause.

import { navigate, waitReady } from "../support/mockApp.js";

const DOCKER = "mock.docker.system";
const APPLE = "mock.container.system";

// A running container of one connection, from the snapshot the screens render.
const runningContainerOf = (connectionId) =>
  browser.execute((id) => {
    const snapshot = window.__resourceSyncHost?.service?.getSyncSnapshot?.();
    const containers = snapshot?.resources?.[id]?.containers ?? [];
    return containers.find((container) => container.Computed?.DecodedState === "running")?.Id ?? "";
  }, connectionId);

async function headerOffersPause(connectionId) {
  const id = await runningContainerOf(connectionId);
  expect(id).toBeTruthy();
  await navigate(browser, `/screens/container/${encodeURIComponent(id)}/logs?connId=${connectionId}`);
  await (await $('.AppScreenHeader [data-action="container.stop"]')).waitForExist({ timeout: 15000 });
  return browser.execute(() => Boolean(document.querySelector('.AppScreenHeader [data-action="container.pause"]')));
}

describe("container detail — Pause follows the container's own connection", () => {
  it("offers Pause on a running Docker container", async () => {
    await waitReady(browser, 90000);
    expect(await headerOffersPause(DOCKER)).toBe(true);
  });

  it("offers no Pause on a running Apple Container container", async () => {
    expect(await headerOffersPause(APPLE)).toBe(false);
  });
});
