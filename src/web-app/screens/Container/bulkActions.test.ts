import { describe, expect, it } from "vitest";

import { ContainerStateList } from "@/container-client/types/container";
import {
  containerCanPause,
  containerCanRemove,
  containerCanRestart,
  containerCanStart,
  containerCanStop,
} from "./bulkActions";

// Four fixed bulk buttons (Pause / Stop / Start / Restart) are always shown; only their enabled state
// depends on the item. Pause/Stop/Restart act on running containers; Start acts on anything not running
// (resumes paused, starts stopped).
describe("container bulk eligibility", () => {
  it("pause applies only to running containers", () => {
    expect(containerCanPause(ContainerStateList.RUNNING)).toBe(true);
    expect(containerCanPause(ContainerStateList.PAUSED)).toBe(false);
    expect(containerCanPause(ContainerStateList.EXITED)).toBe(false);
  });

  it("stop applies only to running containers", () => {
    expect(containerCanStop(ContainerStateList.RUNNING)).toBe(true);
    expect(containerCanStop(ContainerStateList.EXITED)).toBe(false);
  });

  it("restart applies only to running containers", () => {
    expect(containerCanRestart(ContainerStateList.RUNNING)).toBe(true);
    expect(containerCanRestart(ContainerStateList.PAUSED)).toBe(false);
    expect(containerCanRestart(ContainerStateList.EXITED)).toBe(false);
  });

  it("start applies to anything that is not running", () => {
    expect(containerCanStart(ContainerStateList.RUNNING)).toBe(false);
    expect(containerCanStart(ContainerStateList.PAUSED)).toBe(true);
    expect(containerCanStart(ContainerStateList.EXITED)).toBe(true);
    expect(containerCanStart(ContainerStateList.STOPPED)).toBe(true);
  });

  it("remove applies to anything that is not running", () => {
    expect(containerCanRemove(ContainerStateList.RUNNING)).toBe(false);
    expect(containerCanRemove(ContainerStateList.EXITED)).toBe(true);
    expect(containerCanRemove(ContainerStateList.PAUSED)).toBe(true);
  });
});
