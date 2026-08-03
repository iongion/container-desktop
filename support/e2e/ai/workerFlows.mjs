// Worker library and execution-configuration flows.
import { selectExecutionKind, setFieldValue } from "./flowSupport.mjs";

export async function workersFlow(driver) {
  const name = `e2e-inspector-${Date.now()}`;
  await driver.goto("#/screens/ai/workers");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.workers"]'), undefined, {
    timeout: 20000,
    message: "workers list",
  });

  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector("#workerName"), undefined, {
    timeout: 20000,
    message: "worker editor",
  });

  await driver.evaluate((workerName) => {
    const input = document.querySelector("#workerName");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, workerName);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, name);

  // "All allowed" must check AND lock every tool — the mode is the grant, not a starting point to edit. Click and
  // assert in SEPARATE steps: setPolicy is a React state update, so the grid locks on the next render, not inline.
  const clickedPolicy = await driver.evaluate(() => {
    const all = [...document.querySelectorAll(".WorkerEditorPolicy button")].find((b) =>
      (b.textContent || "").includes("All allowed"),
    );
    if (!all) return false;
    all.click();
    return true;
  });
  if (!clickedPolicy) return { name: "workers", ok: false, detail: "no policy control" };
  await driver.waitFor(
    () => {
      const boxes = [...document.querySelectorAll(".WorkerEditorTool input")];
      return boxes.length > 0 && boxes.every((b) => b.checked && b.disabled);
    },
    undefined,
    { timeout: 8000, message: "all-allowed locks the grid" },
  );
  const policyLocked = await driver.evaluate(() => {
    const boxes = [...document.querySelectorAll(".WorkerEditorTool input")];
    return { ok: boxes.length > 0 && boxes.every((b) => b.checked && b.disabled), reason: `${boxes.length} tools` };
  });
  if (!policyLocked?.ok) {
    return { name: "workers", ok: false, detail: `all-allowed did not lock the grid: ${policyLocked?.reason}` };
  }

  await driver.evaluate(() => {
    const save = [...document.querySelectorAll("form button[type=submit]")].find((b) =>
      (b.textContent || "").includes("Create"),
    );
    if (save) save.click();
  });

  // The workers library renders as a card grid (.WorkerCard), not a table — match the created worker's card.
  // waitFor throws on timeout and resolves (undefined) on success, so reaching the next line IS the assertion.
  await driver.waitFor(
    (workerName) =>
      [...document.querySelectorAll(".WorkerCard")].some((card) => (card.textContent || "").includes(workerName)),
    name,
    { timeout: 20000, message: "worker listed" },
  );
  await driver.screenshot("./webdriver/artifacts/ai-workers.png");

  // Round-trip it back out so the flow leaves no state behind for the next run.
  const removed = await driver.evaluate(async (workerName) => {
    const before = (await window.AI.listWorkers()).workers;
    const mine = before.find((w) => w.name === workerName);
    if (!mine) return { ok: false, reason: "not in the store" };
    const after = (await window.AI.removeWorker(mine.id)).workers;
    return { ok: !after.some((w) => w.id === mine.id), reason: `${before.length} -> ${after.length}` };
  }, name);

  const ok = !!removed?.ok;
  return { name: "workers", ok, detail: ok ? `created, listed and removed (${removed.reason})` : removed?.reason };
}

export async function workerConfigFlow(driver) {
  const name = `e2e-config-${Date.now()}`;
  await driver.goto("#/screens/ai/workers");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.workers"]'), undefined, {
    timeout: 20000,
    message: "workers list",
  });

  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Create"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector("#workerName"), undefined, {
    timeout: 20000,
    message: "worker editor",
  });

  await driver.evaluate(setFieldValue, { selector: "#workerName", value: name });
  await driver.evaluate(setFieldValue, { selector: "#workerSpecialty", value: "Audits image layers for CVEs" });
  await driver.evaluate(setFieldValue, { selector: ".workerSystemPrompt", value: "You inspect and report only." });

  // Model: a new worker defaults to "inherit", so the picker row starts disabled. Toggling inherit OFF enables it,
  // ON disables it again — the data-disabled attr is the observable. Leave inherit ON so the save needs no model.
  const clickInherit = () => {
    const label = [...document.querySelectorAll('[data-form="ai.worker.edit"] label')].find((l) =>
      (l.textContent || "").includes("Use the model selected for the Team Run"),
    );
    const box = label?.querySelector('input[type="checkbox"]');
    if (box) box.click();
  };
  await driver.waitFor(() => document.querySelector(".WorkerEditorPickerRow")?.dataset.disabled === "yes", undefined, {
    timeout: 8000,
    message: "model picker disabled while inheriting",
  });
  await driver.evaluate(clickInherit);
  await driver.waitFor(() => document.querySelector(".WorkerEditorPickerRow")?.dataset.disabled === "no", undefined, {
    timeout: 8000,
    message: "model picker enabled when not inheriting",
  });
  await driver.evaluate(clickInherit);
  await driver.waitFor(() => document.querySelector(".WorkerEditorPickerRow")?.dataset.disabled === "yes", undefined, {
    timeout: 8000,
    message: "model picker disabled again",
  });

  // Tool policy: `ask` hides the grid entirely, `granular` shows an editable grid (a new worker defaults to
  // granular). Drive both, then toggle one tool on so the saved policy is a real granular allowlist.
  const clickPolicy = (label) => {
    const btn = [...document.querySelectorAll(".WorkerEditorPolicy button")].find((b) =>
      (b.textContent || "").includes(label),
    );
    if (btn) btn.click();
    return !!btn;
  };
  await driver.evaluate(clickPolicy, "Prompt me");
  await driver.waitFor(() => document.querySelectorAll(".WorkerEditorTool").length === 0, undefined, {
    timeout: 8000,
    message: "ask mode hides the tool grid",
  });
  await driver.evaluate(clickPolicy, "Granular");
  await driver.waitFor(
    () => {
      const boxes = [...document.querySelectorAll(".WorkerEditorTool input")];
      return boxes.length > 0 && boxes.every((b) => !b.disabled);
    },
    undefined,
    { timeout: 8000, message: "granular shows an editable grid" },
  );
  await driver.evaluate(() => {
    const box = document.querySelector(".WorkerEditorTool input");
    if (box && !box.checked) box.click();
  });
  await driver.waitFor(() => !!document.querySelector(".WorkerEditorTool input:checked"), undefined, {
    timeout: 8000,
    message: "a granular tool checks",
  });

  // Runs on: exercise a non-host transition (sandbox surfaces its image field), then settle back on host so save
  // does not require a connection.
  await driver.evaluate(selectExecutionKind, "sandbox");
  await driver.waitFor(
    () =>
      [...document.querySelectorAll('[data-form="ai.worker.edit"] input')].some((i) =>
        (i.value || "").includes("alpine"),
      ),
    undefined,
    { timeout: 8000, message: "sandbox image field appears" },
  );
  await driver.evaluate(selectExecutionKind, "host");

  await driver.evaluate(() => {
    const save = [...document.querySelectorAll("form button[type=submit]")].find((b) =>
      (b.textContent || "").includes("Create"),
    );
    if (save) save.click();
  });
  await driver.waitFor(
    (workerName) =>
      [...document.querySelectorAll(".WorkerCard")].some((c) => (c.textContent || "").includes(workerName)),
    name,
    { timeout: 20000, message: "worker listed" },
  );

  // EDIT via the card's pencil: change the specialty, save, assert the card reflects the new specialty.
  const editedSpecialty = `edited-${Date.now()}`;
  await driver.evaluate((workerName) => {
    const card = [...document.querySelectorAll(".WorkerCard")].find((c) => (c.textContent || "").includes(workerName));
    const edit = card?.querySelector('.WorkerCardActions [title="Edit"]');
    if (edit) edit.click();
  }, name);
  await driver.waitFor((workerName) => (document.querySelector("#workerName")?.value || "") === workerName, name, {
    timeout: 20000,
    message: "edit drawer prefilled",
  });
  await driver.evaluate(setFieldValue, { selector: "#workerSpecialty", value: editedSpecialty });
  await driver.evaluate(() => {
    const save = [...document.querySelectorAll("form button[type=submit]")].find((b) =>
      (b.textContent || "").includes("Save"),
    );
    if (save) save.click();
  });
  await driver.waitFor(
    (spec) =>
      [...document.querySelectorAll(".WorkerCard")].some((c) =>
        (c.querySelector(".WorkerCardSpecialty")?.textContent || "").includes(spec),
      ),
    editedSpecialty,
    { timeout: 20000, message: "edit reflected in the card" },
  );

  // DELETE via the ConfirmMenu UI: open the card's "…" menu, click Remove, confirm Yes — the path a user takes.
  await driver.evaluate((workerName) => {
    const card = [...document.querySelectorAll(".WorkerCard")].find((c) => (c.textContent || "").includes(workerName));
    const more = card?.querySelector(".WorkerCardActions .bp6-icon-more")?.closest("button");
    if (more) more.click();
  }, name);
  await driver.waitFor(
    () =>
      [...document.querySelectorAll(".bp6-popover-content a.bp6-menu-item")].some(
        (a) => (a.textContent || "").trim() === "Remove",
      ),
    undefined,
    { timeout: 8000, message: "worker actions menu" },
  );
  await driver.evaluate(() => {
    const remove = [...document.querySelectorAll(".bp6-popover-content a.bp6-menu-item")].find(
      (a) => (a.textContent || "").trim() === "Remove",
    );
    if (remove) remove.click();
  });
  await driver.waitFor(
    () =>
      [...document.querySelectorAll(".bp6-popover-content button")].some((b) => (b.textContent || "").trim() === "Yes"),
    undefined,
    { timeout: 8000, message: "remove confirm" },
  );
  await driver.evaluate(() => {
    const yes = [...document.querySelectorAll(".bp6-popover-content button")].find(
      (b) => (b.textContent || "").trim() === "Yes",
    );
    if (yes) yes.click();
  });
  await driver.waitFor(
    (workerName) =>
      ![...document.querySelectorAll(".WorkerCard")].some((c) => (c.textContent || "").includes(workerName)),
    name,
    { timeout: 20000, message: "worker removed from the list" },
  );

  await driver.screenshot("./webdriver/artifacts/ai-worker-config.png");
  return {
    name: "workerConfig",
    ok: true,
    detail: "configured (specialty/inherit/policy ask+granular/runs-on), edited the specialty, deleted via ConfirmMenu",
  };
}
