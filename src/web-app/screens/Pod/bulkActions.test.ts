import { describe, expect, it } from "vitest";

import { PodStatusList } from "@/container-client/types/pod";
import { podCanPause, podCanRestart, podCanStart, podCanStop } from "./bulkActions";

// Four fixed bulk buttons (Pause / Stop / Start / Restart) are always shown; only their enabled state
// depends on the item. Pause/Stop/Restart act on running pods; Start acts on anything not running
// (resumes paused, starts/restarts the rest).
describe("pod bulk eligibility", () => {
  it("pause applies only to running pods", () => {
    expect(podCanPause(PodStatusList.RUNNING)).toBe(true);
    expect(podCanPause(PodStatusList.PAUSED)).toBe(false);
    expect(podCanPause(PodStatusList.EXITED)).toBe(false);
  });

  it("stop applies only to running pods", () => {
    expect(podCanStop(PodStatusList.RUNNING)).toBe(true);
    expect(podCanStop(PodStatusList.EXITED)).toBe(false);
  });

  it("restart applies only to running pods", () => {
    expect(podCanRestart(PodStatusList.RUNNING)).toBe(true);
    expect(podCanRestart(PodStatusList.PAUSED)).toBe(false);
    expect(podCanRestart(PodStatusList.EXITED)).toBe(false);
  });

  it("start applies to anything that is not running", () => {
    expect(podCanStart(PodStatusList.RUNNING)).toBe(false);
    expect(podCanStart(PodStatusList.PAUSED)).toBe(true);
    expect(podCanStart(PodStatusList.EXITED)).toBe(true);
    expect(podCanStart(PodStatusList.STOPPED)).toBe(true);
  });
});
