// The setup wizard's Provision step, per scenario — selected by CONTAINER_DESKTOP_MOCK_PROVISION_EXIT, which the shell
// forwards into the webview: unset → every mock provisioning command succeeds, a code → each exits with it
// (mock/MockCommand.ts). A failed step shows a plain sentence, Retry and a collapsed Details section; the raw command
// line appears only inside Details.

import { countOf, waitReady } from "../support/mockApp.js";

const EXIT = Number.parseInt(process.env.CONTAINER_DESKTOP_MOCK_PROVISION_EXIT || "0", 10) || 0;
const SCENARIO = EXIT ? `exit ${EXIT}` : "success";
const SHOT = process.env.CONTAINER_DESKTOP_E2E_SHOT;

const RUN_FINISHED = () =>
  browser.execute(() => {
    const steps = [...document.querySelectorAll(".PWizRunStep")];
    return (
      steps.length > 0 &&
      (steps.some((step) => step.classList.contains("is-failed")) ||
        steps.every((step) => step.classList.contains("is-ok") || step.classList.contains("is-skipped")))
    );
  });

async function openProvisionStep() {
  await waitReady(browser, 90000);
  await (await $('[data-testid="provision-button"]')).click();
  await (await $('[data-testid="provisioning-wizard"]')).waitForExist({ timeout: 15000 });
  // Detection picks the target the plan is built for; its recommendation callout means it finished.
  await (await $(".PWizSystemCheck .bp6-callout")).waitForExist({ timeout: 30000 });
  const rail = await $$(".PWizRail .PWizStep");
  await rail[5].click();
  await browser.waitUntil(RUN_FINISHED, {
    timeout: 30000,
    interval: 300,
    timeoutMsg: "the provisioning run never ended",
  });
}

describe(`provisioning — ${SCENARIO} scenario`, () => {
  it("runs the plan to the end this scenario asks for", async () => {
    await openProvisionStep();
    expect(await countOf(browser, ".PWizRunStep.is-failed")).toBe(EXIT ? 1 : 0);
    expect(await countOf(browser, ".PWizRunStepFailure")).toBe(EXIT ? 1 : 0);
  });

  it("shows a failure as a plain sentence with Retry, the command only inside Details", async () => {
    if (!EXIT) {
      // The success scenario has no failure to show; its assertion is the zero count above.
      return;
    }
    const collapsed = await browser.execute(() => {
      const panel = document.querySelector(".PWizRunStepFailure");
      return {
        message: panel?.querySelector(".PWizRunStepMessage")?.textContent ?? "",
        hint: panel?.querySelector(".PWizRunStepHint")?.textContent ?? "",
        retry: Boolean(panel?.querySelector('[data-action="provision.retry"]')),
        details: Boolean(panel?.querySelector('[data-action="provision.details"]')),
        panelText: panel?.textContent ?? "",
        detailsOpen: Boolean(panel?.querySelector(".PWizRunStepDetails")),
      };
    });
    expect(collapsed.message.length).toBeGreaterThan(0);
    expect(collapsed.hint.length).toBeGreaterThan(0);
    expect(collapsed.retry).toBe(true);
    expect(collapsed.details).toBe(true);
    expect(collapsed.detailsOpen).toBe(false);
    expect(collapsed.panelText).not.toContain("sh -c");

    await (await $('[data-action="provision.details"]')).click();
    await (await $(".PWizRunStepDetails")).waitForExist({ timeout: 5000 });
    const open = await browser.execute(() => {
      const details = document.querySelector(".PWizRunStepDetails");
      return {
        labels: [...(details?.querySelectorAll(".DetailBlockLabel") ?? [])].map((label) => label.textContent),
        logs: [...(details?.querySelectorAll(".DetailBlockPre") ?? [])].map((log) => log.textContent),
        copies: details?.querySelectorAll(".CopyButton").length ?? 0,
      };
    });
    expect(open.labels[0]).toContain(String(EXIT));
    expect(open.logs[0]).toMatch(/^sh -c /);
    expect(open.logs.length).toBe(2);
    expect(open.copies).toBe(2);
    if (SHOT) {
      await browser.saveScreenshot(SHOT);
    }
  });

  it("retries the same plan from Retry", async () => {
    if (!EXIT) {
      return;
    }
    await (await $('[data-action="provision.retry"]')).click();
    // The mock fails every time, so a retry ends failed again, on a fresh run (Details collapsed).
    await browser.waitUntil(async () => browser.execute(() => !document.querySelector(".PWizRunStepDetails")), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: "Retry never reset the run",
    });
    await browser.waitUntil(RUN_FINISHED, { timeout: 30000, interval: 300, timeoutMsg: "the retried run never ended" });
    expect(await countOf(browser, ".PWizRunStep.is-failed")).toBe(1);
  });
});
