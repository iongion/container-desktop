// Build Studio's configuration panel follows each engine's build command. Only Docker's (buildx) pushes as part of the
// build, so only Docker offers "Push after build"; `podman build` has no push flag at all. Apple's `container build`
// takes every platform into one image, kept in Apple's own image store, so it shows no "can't be loaded" note.
// The route is the screen's own (screens/Build/Navigation.ts BUILD_ROUTE); the ids are the mock's system connections.

import { keystrokeChunks } from "../support/keystrokes.js";
import { navigate, waitReady } from "../support/mockApp.js";

const BUILD = "/screens/build";
const PANEL = '[data-region="config"]';

const preview = () =>
  browser.execute((panel) => document.querySelector(`${panel} .cmd code`)?.textContent ?? "", PANEL);

const switchLabels = () =>
  browser.execute(
    (panel) => [...document.querySelectorAll(`${panel} .bp6-switch`)].map((element) => element.textContent.trim()),
    PANEL,
  );

// Opens the panel for one connection, with Advanced · BuildKit expanded (it holds the switches).
async function openBuild(connectionId, previewStart) {
  await navigate(browser, `${BUILD}?connId=${connectionId}`);
  await browser.waitUntil(async () => (await preview()).startsWith(previewStart), {
    timeout: 15000,
    interval: 300,
    timeoutMsg: `the command preview never started with "${previewStart}"`,
  });
  if (!(await switchLabels()).length) {
    await browser.execute((panel) => {
      [...document.querySelectorAll(`${panel} button`)].find((button) => /Advanced/.test(button.textContent))?.click();
    }, PANEL);
  }
  await browser.waitUntil(async () => (await switchLabels()).includes("No cache"), {
    timeout: 5000,
    interval: 200,
    timeoutMsg: "Advanced · BuildKit never opened",
  });
}

describe("build configuration — what each engine's build command can do", () => {
  it("offers Push after build for Docker", async () => {
    await waitReady(browser, 90000);
    await openBuild("mock.docker.system", "docker buildx build");
    expect(await switchLabels()).toContain("Push after build");
  });

  it("offers no push for Podman, whose build command has none", async () => {
    await openBuild("mock.podman.system", "podman build");
    expect(await switchLabels()).not.toContain("Push after build");
  });

  it("offers no push for Apple, and builds every platform into one local image", async () => {
    await openBuild("mock.container.system", "container build");
    expect(await switchLabels()).not.toContain("Push after build");

    const platforms = await $(`${PANEL} input[placeholder="linux/amd64…"]`);
    await platforms.click();
    for (const platform of ["linux/arm64", "linux/amd64"]) {
      for (const chunk of keystrokeChunks(platform)) {
        await browser.keys(chunk);
      }
      await browser.keys("Enter");
    }
    await browser.waitUntil(async () => (await preview()).includes("--platform linux/arm64 --platform linux/amd64"), {
      timeout: 5000,
      interval: 200,
      timeoutMsg: `the preview never named both platforms: ${await preview()}`,
    });
    const note = await browser.execute((panel) => document.querySelector(`${panel} .cfg-note`)?.textContent ?? "", PANEL);
    expect(note).not.toContain("can't be loaded");
  });
});
