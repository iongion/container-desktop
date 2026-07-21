import { describe, expect, it } from "vitest";

import { initRunState, reduce } from "./stepReducer";

const twoSteps = () => initRunState(["detect", "install"]);

describe("initRunState", () => {
  it("starts every step pending and overall idle", () => {
    const s = initRunState(["a", "b"]);
    expect(s.overall).toBe("idle");
    expect(s.steps).toEqual([
      { id: "a", status: "pending", lines: [] },
      { id: "b", status: "pending", lines: [] },
    ]);
    expect(s.activeStepId).toBeUndefined();
  });
});

describe("reduce", () => {
  it("step.start marks the step running, sets it active, overall running", () => {
    const s = reduce(twoSteps(), { type: "step.start", id: "detect" });
    expect(s.steps[0].status).toBe("running");
    expect(s.activeStepId).toBe("detect");
    expect(s.overall).toBe("running");
  });

  it("step.line appends to that step's lines", () => {
    let s = reduce(twoSteps(), { type: "step.start", id: "detect" });
    s = reduce(s, { type: "step.line", id: "detect", line: "hello" });
    s = reduce(s, { type: "step.line", id: "detect", line: "world" });
    expect(s.steps[0].lines).toEqual(["hello", "world"]);
  });

  it("caps a step's line buffer to the last 500 lines", () => {
    let s = reduce(twoSteps(), { type: "step.start", id: "detect" });
    for (let i = 0; i < 600; i++) {
      s = reduce(s, { type: "step.line", id: "detect", line: `L${i}` });
    }
    expect(s.steps[0].lines).toHaveLength(500);
    expect(s.steps[0].lines[499]).toBe("L599");
    expect(s.steps[0].lines[0]).toBe("L100");
  });

  it("step.ok clears the active step; mid-run overall stays running", () => {
    let s = reduce(twoSteps(), { type: "step.start", id: "detect" });
    s = reduce(s, { type: "step.ok", id: "detect" });
    expect(s.steps[0].status).toBe("ok");
    expect(s.activeStepId).toBeUndefined();
    expect(s.overall).toBe("running"); // second step still pending
  });

  it("overall becomes done when every step is ok or skipped", () => {
    let s = twoSteps();
    s = reduce(s, { type: "step.ok", id: "detect" });
    s = reduce(s, { type: "step.skip", id: "install", reason: "already installed" });
    expect(s.overall).toBe("done");
  });

  it("step.fail records the error and makes overall failed", () => {
    let s = reduce(twoSteps(), { type: "step.start", id: "detect" });
    s = reduce(s, { type: "step.fail", id: "detect", error: "boom" });
    expect(s.steps[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(s.overall).toBe("failed");
  });

  it("is pure — does not mutate the previous state", () => {
    const prev = twoSteps();
    const snapshot = JSON.stringify(prev);
    reduce(prev, { type: "step.start", id: "detect" });
    expect(JSON.stringify(prev)).toBe(snapshot);
  });

  it("ignores events for unknown step ids", () => {
    const s = reduce(twoSteps(), { type: "step.start", id: "nope" });
    expect(s.steps.every((x) => x.status === "pending")).toBe(true);
    expect(s.overall).toBe("idle");
  });
});
