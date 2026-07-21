import { describe, expect, it } from "vitest";

import { runSteps, type StepExecutor } from "./orchestrator";
import type { ProvisionStep, StepEvent } from "./types";

const step = (id: string): ProvisionStep => ({ id, kind: "install-engine", title: id, longRunning: false });

// Collect emitted events into a compact "type:id" trail for order assertions.
const trail = (events: StepEvent[]) => events.map((e) => `${e.type}:${e.id}`);

describe("runSteps", () => {
  it("emits start then ok for every step, in order, and returns done", async () => {
    const events: StepEvent[] = [];
    const execute: StepExecutor = async () => ({ status: "ok" });
    const overall = await runSteps([step("a"), step("b")], execute, (e) => events.push(e));
    expect(trail(events)).toEqual(["step.start:a", "step.ok:a", "step.start:b", "step.ok:b"]);
    expect(overall).toBe("done");
  });

  it("streams lines between start and ok", async () => {
    const events: StepEvent[] = [];
    const execute: StepExecutor = async (_s, onLine) => {
      onLine("building…");
      onLine("done");
      return { status: "ok" };
    };
    await runSteps([step("a")], execute, (e) => events.push(e));
    expect(trail(events)).toEqual(["step.start:a", "step.line:a", "step.line:a", "step.ok:a"]);
    const lines = events.filter((e): e is Extract<StepEvent, { type: "step.line" }> => e.type === "step.line");
    expect(lines.map((l) => l.line)).toEqual(["building…", "done"]);
  });

  it("emits skip (with reason) and continues to the next step", async () => {
    const events: StepEvent[] = [];
    const execute: StepExecutor = async (s) =>
      s.id === "a" ? { status: "skip", reason: "already present" } : { status: "ok" };
    const overall = await runSteps([step("a"), step("b")], execute, (e) => events.push(e));
    expect(trail(events)).toEqual(["step.start:a", "step.skip:a", "step.start:b", "step.ok:b"]);
    const skip = events.find((e) => e.type === "step.skip");
    expect(skip && "reason" in skip && skip.reason).toBe("already present");
    expect(overall).toBe("done");
  });

  it("emits fail and halts at the first failure — later steps never start", async () => {
    const events: StepEvent[] = [];
    const execute: StepExecutor = async (s) => {
      if (s.id === "a") {
        throw new Error("boom");
      }
      return { status: "ok" };
    };
    const overall = await runSteps([step("a"), step("b")], execute, (e) => events.push(e));
    expect(trail(events)).toEqual(["step.start:a", "step.fail:a"]);
    const fail = events.find((e) => e.type === "step.fail");
    expect(fail && "error" in fail && fail.error).toBe("boom");
    expect(overall).toBe("failed");
  });

  it("stringifies a non-Error throw for the failure detail", async () => {
    const events: StepEvent[] = [];
    const execute: StepExecutor = async () => {
      throw "plain failure";
    };
    await runSteps([step("a")], execute, (e) => events.push(e));
    const fail = events.find((e) => e.type === "step.fail");
    expect(fail && "error" in fail && fail.error).toBe("plain failure");
  });
});
