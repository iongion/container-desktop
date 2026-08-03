// Team Run creation, roster, and list flows.
export async function runFlow(driver) {
  // Runs are a LIST: the run is created from the list's drawer, then opened as its own route. Walking
  // list -> create -> run is the point — it is the path a user actually takes.
  await driver.goto("#/screens/ai/runs");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.runs"]'), undefined, {
    timeout: 20000,
    message: "runs list",
  });

  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("New run"));
    if (create) create.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunCreateInput"), undefined, {
    timeout: 20000,
    message: "run create drawer",
  });

  const submitted = await driver.evaluate((text) => {
    const ta = document.querySelector(".RunCreateInput");
    if (!ta) return { ok: false, reason: "no goal textarea" };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  }, "Audit my running containers and tell me what to fix first.");
  if (!submitted?.ok) return { name: "run", ok: false, detail: submitted?.reason || "submit failed" };

  await driver.evaluate(() => {
    const run = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Start run"));
    if (run) run.click();
  });

  // Starting navigates to the run's own route; the plan gate belongs to that screen.
  await driver.waitFor(() => !!document.querySelector(".RunPlanGate"), undefined, {
    timeout: 30000,
    message: "plan gate",
  });
  // The gate must hold: no task may report as started while the plan is still awaiting approval.
  const dispatchedEarly = await driver.evaluate(
    () => !![...document.querySelectorAll(".RunTask")].find((t) => t.dataset.status === "running"),
  );
  if (dispatchedEarly) return { name: "run", ok: false, detail: "a task ran before the plan was approved" };

  await driver.evaluate(() => {
    const approve = [...document.querySelectorAll("button")].find((b) =>
      (b.textContent || "").includes("Approve plan"),
    );
    if (approve) approve.click();
  });

  // A gated tool raises an approval prompt mid-run; allow it so the run can finish.
  await driver.waitFor(
    () => !!document.querySelector(".RunApproval") || !!document.querySelector(".RunSynthesis"),
    undefined,
    { timeout: 40000, message: "tool approval or synthesis" },
  );
  await driver.evaluate(() => {
    const allow = [...document.querySelectorAll(".RunApproval button")].find((b) =>
      (b.textContent || "").includes("Allow"),
    );
    if (allow) allow.click();
  });

  await driver.waitFor(() => !!document.querySelector(".RunSynthesis"), undefined, {
    timeout: 60000,
    message: "synthesis",
  });
  const summary = await driver.evaluate(() => ({
    statuses: [...document.querySelectorAll(".RunTask")].map((t) => t.dataset.status),
    // The task graph lays tasks out in dependency waves (Wave 1 parallel, Wave 2 …); assert that layout rendered,
    // not merely that no task is still pending, so a regression that flattens the DAG is caught.
    waves: document.querySelectorAll(".RunWaveLabel").length,
    waveLabels: [...document.querySelectorAll(".RunWaveLabel")].map((n) => (n.textContent || "").trim()),
    synthesis: (document.querySelector(".RunSynthesisBody")?.textContent || "").trim().slice(0, 80),
  }));

  await driver.evaluate(() => {
    const waterfall = [...document.querySelectorAll(".RunViewMode button")].find((button) =>
      (button.textContent || "").includes("Waterfall"),
    );
    if (waterfall) waterfall.click();
  });
  await driver.waitFor(
    () => !!document.querySelector(".RunWaterfallAxis") && !!document.querySelector(".RunWaterfallNode"),
    undefined,
    { timeout: 12000, message: "waterfall rendered" },
  );
  const waterfallBefore = await driver.evaluate(() => ({
    width: document.querySelector(".RunWaterfall")?.getBoundingClientRect().width ?? 0,
  }));
  await driver.evaluate(async () => {
    const divider = document
      .querySelector(".RunWaterfall")
      ?.closest(".split-pane.horizontal")
      ?.querySelector(":scope > .split-pane-divider.horizontal");
    if (!divider) return;
    for (let index = 0; index < 2; index += 1) {
      divider.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
  });
  await driver.waitFor(
    (before) => (document.querySelector(".RunWaterfall")?.getBoundingClientRect().width ?? 0) > before + 40,
    waterfallBefore.width,
    { timeout: 8000, message: "waterfall panel resized" },
  );
  const waterfall = await driver.evaluate(() => {
    const axis = document.querySelector(".RunWaterfallAxis")?.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".RunWaterfallNode > .bp6-tree-node-content")];
    const tracks = rows
      .map((row) => row.querySelector(".bp6-tree-node-secondary-label")?.getBoundingClientRect())
      .filter(Boolean);
    const positions = (selector) => [
      ...new Set(rows.map((row) => row.querySelector(selector)?.getBoundingClientRect().left).filter(Number.isFinite)),
    ];
    return {
      axis: axis ? { left: axis.left, right: axis.right, width: axis.width } : null,
      trackCount: tracks.length,
      maxLeftDelta: axis ? Math.max(0, ...tracks.map((track) => Math.abs(track.left - axis.left))) : Infinity,
      maxRightDelta: axis ? Math.max(0, ...tracks.map((track) => Math.abs(track.right - axis.right))) : Infinity,
      kindColumns: positions(".RunWaterfallKindLabel").length,
      durationColumns: positions(".RunWaterfallDuration").length,
      attemptPosition: getComputedStyle(document.querySelector(".RunWaterfallAttempt")).position,
      axisPosition: getComputedStyle(document.querySelector(".RunWaterfallAxis")).position,
    };
  });
  await driver.screenshot("./webdriver/artifacts/ai-run.png");
  const ok =
    summary.statuses.length > 0 &&
    summary.statuses.every((s) => s !== "pending") &&
    summary.waves > 0 &&
    !!summary.synthesis &&
    waterfall.trackCount > 0 &&
    waterfall.maxLeftDelta < 0.5 &&
    waterfall.maxRightDelta < 0.5 &&
    waterfall.kindColumns === 1 &&
    waterfall.durationColumns === 1 &&
    waterfall.attemptPosition !== "sticky" &&
    waterfall.axisPosition === "sticky";
  return {
    name: "run",
    ok,
    detail: ok
      ? `plan gated, ${summary.statuses.length} tasks across ${summary.waves} wave(s) settled, answer + aligned waterfall rendered`
      : JSON.stringify({ summary, waterfall }),
  };
}

/**
 * Runs board/table. Always verifies the four lifecycle columns and both views. When the app was launched with the
 * optional scaled Run fixture, also proves that the board and table window their mounted rows.
 * @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function runsListFlow(driver) {
  await driver.goto("#/screens/ai/runs");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.runs"]'), undefined, {
    timeout: 20000,
    message: "runs list",
  });
  await driver.waitFor(() => !!document.querySelector(".RunBoard"), undefined, {
    timeout: 20000,
    message: "runs board",
  });

  const board = await driver.evaluate(() => {
    const counts = [...document.querySelectorAll(".BoardColumn .BoardColumnCount")].map((n) =>
      Number(n.textContent || "0"),
    );
    return {
      columns: document.querySelectorAll(".BoardColumn").length,
      total: counts.reduce((a, b) => a + b, 0),
      renderedCards: document.querySelectorAll(".RunCard").length,
    };
  });
  if (board.columns !== 4) return { name: "runsList", ok: false, detail: `expected 4 columns, saw ${board.columns}` };
  if (board.total === 0) return { name: "runsList", ok: false, detail: "Runs board is empty" };
  const scaled = board.total >= 300;
  const boardWindowed = board.renderedCards < board.total;

  await driver.evaluate(() => {
    const toTable = [...document.querySelectorAll(".RunViewSwitch button")].find(
      (b) => (b.getAttribute("aria-label") || "") === "Table",
    );
    if (toTable) toTable.click();
  });
  await driver.waitFor(() => !!document.querySelector('table[data-table="ai.runs"][data-windowed="true"]'), undefined, {
    timeout: 12000,
    message: "runs table",
  });
  const tableRows = await driver.evaluate(
    () => document.querySelectorAll('table[data-table="ai.runs"] tbody tr[data-index]').length,
  );
  const tableWindowed = tableRows > 0 && tableRows < board.total;

  await driver.evaluate(() => {
    const toBoard = [...document.querySelectorAll(".RunViewSwitch button")].find(
      (b) => (b.getAttribute("aria-label") || "") === "Board",
    );
    if (toBoard) toBoard.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunBoard"), undefined, {
    timeout: 12000,
    message: "back to board",
  });

  await driver.screenshot("./webdriver/artifacts/ai-runs-list.png");
  const ok =
    board.renderedCards > 0 &&
    board.renderedCards <= board.total &&
    tableRows > 0 &&
    tableRows <= board.total &&
    (!scaled || (boardWindowed && tableWindowed));
  return {
    name: "runsList",
    ok,
    detail: ok
      ? `board 4 cols (${board.total} runs, ${board.renderedCards} cards mounted), table ${scaled ? "windowed to" : "rendered"} ${tableRows} rows`
      : JSON.stringify({ board, tableRows }),
  };
}

/**
 * Run roster — the CreateDrawer Worker selection + budget. Picks a non-default budget
 * and TWO named workers, starts the run, and asserts the plan routes across BOTH workers (the mock coordinator
 * binds each task to a roster id round-robin, so the plan shows more than one distinct agent). Asserts at the
 * gate, before approval, so it is deterministic and cheap. @param {AiE2eDriver} driver @returns {Promise<FlowResult>}
 */
export async function runRosterFlow(driver) {
  await driver.goto("#/screens/ai/runs");
  await driver.waitFor(() => !!document.querySelector('[data-screen="ai.runs"]'), undefined, {
    timeout: 20000,
    message: "runs list",
  });
  await driver.evaluate(() => {
    const create = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("New run"));
    if (create) create.click();
  });
  await driver.waitFor(() => document.querySelectorAll(".RunCreateRoster .bp6-checkbox").length >= 2, undefined, {
    timeout: 20000,
    message: "run create drawer with a roster",
  });

  await driver.evaluate((text) => {
    const ta = document.querySelector(".RunCreateInput");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Audit and review my running containers across two agents.");

  // Non-default token budget — exercise the budget select.
  await driver.evaluate(() => {
    const select = document.querySelector("#goalBudget");
    if (!select) return;
    const other = [...select.options].find((o) => o.value !== select.value);
    if (!other) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, other.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const picked = await driver.evaluate(
    (names) => {
      const chosen = [];
      for (const wanted of names) {
        const row = [...document.querySelectorAll(".RunCreateRoster .bp6-checkbox")].find(
          (l) => (l.querySelector(".RunCreateWorkerName")?.textContent || "") === wanted,
        );
        const box = row?.querySelector('input[type="checkbox"]');
        if (box && !box.checked) {
          box.click();
          chosen.push(wanted);
        }
      }
      return chosen;
    },
    ["Inspector", "Operator"],
  );
  if (picked.length < 2) return { name: "runRoster", ok: false, detail: `could not pick two workers (${picked})` };
  await driver.waitFor(
    () => document.querySelectorAll('.RunCreateRoster input[type="checkbox"]:checked').length >= 2,
    undefined,
    { timeout: 8000, message: "two workers selected" },
  );

  await driver.evaluate(() => {
    const run = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Start run"));
    if (run) run.click();
  });
  await driver.waitFor(() => !!document.querySelector(".RunPlanGate"), undefined, {
    timeout: 30000,
    message: "plan gate",
  });

  const plan = await driver.evaluate(() => {
    const agents = [...document.querySelectorAll(".RunPlanList .RunPlanDeps")].map((n) =>
      (n.textContent || "").split("·")[0].trim(),
    );
    return { tasks: document.querySelectorAll(".RunPlanList li").length, distinct: [...new Set(agents)] };
  });
  await driver.screenshot("./webdriver/artifacts/ai-run-roster.png");
  const ok = plan.tasks >= 2 && plan.distinct.includes("Inspector") && plan.distinct.includes("Operator");
  return {
    name: "runRoster",
    ok,
    detail: ok
      ? `roster of 2 routed ${plan.tasks} tasks across ${plan.distinct.length} workers (${plan.distinct.join(", ")})`
      : JSON.stringify(plan),
  };
}
