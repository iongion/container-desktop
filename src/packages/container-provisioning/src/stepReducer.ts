import type { Overall, ProvisionRunState, StepEvent, StepRunState } from "./types";

// Keep only the last N streamed lines per step so a chatty install can't grow the buffer unbounded.
const LINE_CAP = 500;

export function initRunState(stepIds: string[]): ProvisionRunState {
  return {
    steps: stepIds.map((id) => ({ id, status: "pending", lines: [] })),
    overall: "idle",
    activeStepId: undefined,
  };
}

function rollup(steps: StepRunState[]): Overall {
  if (steps.some((s) => s.status === "failed")) {
    return "failed";
  }
  if (steps.length > 0 && steps.every((s) => s.status === "ok" || s.status === "skipped")) {
    return "done";
  }
  const started = steps.some((s) => s.status !== "pending");
  return started ? "running" : "idle";
}

// Pure: fold one StepEvent into the run state. Events for unknown ids are ignored.
export function reduce(state: ProvisionRunState, event: StepEvent): ProvisionRunState {
  const idx = state.steps.findIndex((s) => s.id === event.id);
  if (idx === -1) {
    return state;
  }

  const steps = state.steps.map((s) => ({ ...s }));
  const step = steps[idx];
  let activeStepId = state.activeStepId;

  switch (event.type) {
    case "step.start":
      step.status = "running";
      activeStepId = event.id;
      break;
    case "step.line":
      step.lines = [...step.lines, event.line].slice(-LINE_CAP);
      break;
    case "step.ok":
      step.status = "ok";
      if (activeStepId === event.id) activeStepId = undefined;
      break;
    case "step.fail":
      step.status = "failed";
      step.error = event.error;
      if (activeStepId === event.id) activeStepId = undefined;
      break;
    case "step.skip":
      step.status = "skipped";
      if (activeStepId === event.id) activeStepId = undefined;
      break;
  }

  return { steps, overall: rollup(steps), activeStepId };
}
