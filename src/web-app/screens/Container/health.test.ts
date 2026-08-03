import { describe, expect, it } from "vitest";

import { type Container, ContainerStateList } from "@/container-client/types/container";

import { aggregateStatus, stateLabel, statusLabel, statusTone } from "./health";

const container = (
  state?: ContainerStateList,
  health?: "healthy" | "unhealthy" | "starting",
  status?: string,
): Container => ({ Computed: { DecodedState: state, Health: health }, Status: status }) as unknown as Container;

describe("statusTone", () => {
  it("lets the healthcheck status win over the run state", () => {
    expect(statusTone(container(ContainerStateList.RUNNING, "unhealthy"))).toBe("danger");
    expect(statusTone(container(ContainerStateList.RUNNING, "starting"))).toBe("warning");
    expect(statusTone(container(ContainerStateList.RUNNING, "healthy"))).toBe("success");
  });

  it("derives the tone from the run state when there is no healthcheck", () => {
    expect(statusTone(container(ContainerStateList.RUNNING))).toBe("success");
    expect(statusTone(container(ContainerStateList.CREATED))).toBe("warning");
    expect(statusTone(container(ContainerStateList.PAUSED))).toBe("warning");
    expect(statusTone(container(ContainerStateList.ERROR))).toBe("danger");
  });

  it("treats a cleanly stopped container as neutral (off), ignoring any stale last-health", () => {
    expect(statusTone(container(ContainerStateList.EXITED))).toBe("muted");
    expect(statusTone(container(ContainerStateList.STOPPED))).toBe("muted");
    expect(statusTone(container(ContainerStateList.EXITED, undefined, "Exited (0) 2 hours ago"))).toBe("muted");
    // 143 = SIGTERM (a deliberate stop) is a clean exit, not a crash
    expect(statusTone(container(ContainerStateList.EXITED, undefined, "Exited (143) 1 day ago"))).toBe("muted");
    // stale "unhealthy" from when it was running must NOT make a cleanly stopped container red
    expect(statusTone(container(ContainerStateList.EXITED, "unhealthy"))).toBe("muted");
    expect(statusTone(container(ContainerStateList.EXITED, "unhealthy", "Exited (137) 1 day ago"))).toBe("muted");
  });

  it("reads a non-clean exit code as a crash (danger), ignoring stale health", () => {
    expect(statusTone(container(ContainerStateList.EXITED, undefined, "Exited (1) 5 minutes ago"))).toBe("danger");
    expect(statusTone(container(ContainerStateList.STOPPED, undefined, "Exited (255) ago"))).toBe("danger");
    // a crash reads red even if its last health happened to be "healthy"
    expect(statusTone(container(ContainerStateList.EXITED, "healthy", "Exited (2) ago"))).toBe("danger");
  });

  it("is muted for an unknown state", () => {
    expect(statusTone(container())).toBe("muted");
  });
});

describe("stateLabel", () => {
  it("appends the exit code for a stopped container, bare otherwise", () => {
    expect(stateLabel(container(ContainerStateList.EXITED, undefined, "Exited (1) 5 minutes ago"))).toBe("exited (1)");
    expect(stateLabel(container(ContainerStateList.EXITED))).toBe("exited");
    expect(stateLabel(container(ContainerStateList.RUNNING))).toBe("running");
  });
});

describe("statusLabel", () => {
  it("is the healthcheck status only while running", () => {
    expect(statusLabel(container(ContainerStateList.RUNNING, "healthy"))).toBe("healthy");
    expect(statusLabel(container(ContainerStateList.RUNNING, "unhealthy"))).toBe("unhealthy");
    expect(statusLabel(container(ContainerStateList.RUNNING))).toBe("running");
  });

  it("is the run state (never stale health) when stopped, so it can never contradict the dot", () => {
    expect(statusLabel(container(ContainerStateList.EXITED, "unhealthy", "Exited (0) 2 hours ago"))).toBe("exited (0)");
    expect(statusLabel(container(ContainerStateList.EXITED, "unhealthy"))).toBe("exited");
    expect(statusLabel(container(ContainerStateList.EXITED))).toBe("exited");
  });
});

describe("aggregateStatus", () => {
  it("returns the worst member's tone and its label", () => {
    const agg = aggregateStatus([
      container(ContainerStateList.RUNNING, "healthy"),
      container(ContainerStateList.RUNNING, "unhealthy"),
    ]);
    expect(agg.tone).toBe("danger");
    expect(agg.label).toBe("unhealthy");
  });

  it("rolls a crashed member up to the group even when others exited cleanly", () => {
    const agg = aggregateStatus([
      container(ContainerStateList.EXITED, undefined, "Exited (0) ago"),
      container(ContainerStateList.EXITED, undefined, "Exited (1) ago"),
    ]);
    expect(agg.tone).toBe("danger");
    expect(agg.label).toBe("exited (1)");
  });

  it("labels an all-off group with a representative member, never a blank tooltip", () => {
    const agg = aggregateStatus([
      container(ContainerStateList.EXITED, undefined, "Exited (0) ago"),
      container(ContainerStateList.EXITED, undefined, "Exited (143) ago"),
    ]);
    expect(agg.tone).toBe("muted");
    expect(agg.label).toBe("exited (0)");
  });

  it("is muted for an empty group", () => {
    expect(aggregateStatus([])).toEqual({ tone: "muted", label: "" });
  });
});
