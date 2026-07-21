import { describe, expect, it } from "vitest";
import type { BuildEvent } from "../types";
import { createPodmanTextParser } from "./podmanText";

function latestSteps(events: BuildEvent[]) {
  const map = new Map<string, any>();
  for (const e of events) {
    if (e.type === "step") {
      map.set(e.step.key, e.step);
    }
  }
  return [...map.values()];
}

describe("createPodmanTextParser", () => {
  it("parses STEP n/m across chunk boundaries into distinct steps", () => {
    const parser = createPodmanTextParser();
    const events: BuildEvent[] = [];
    events.push(...parser.push("stdout", "STEP 1/2: FROM alpine\n--> Using ca"));
    events.push(...parser.push("stdout", "che abc\nSTEP 2/2: RUN echo hi\n"));
    const steps = latestSteps(events);
    expect(steps.length).toBe(2);
    expect(steps[0].cached).toBe(true);
    expect(steps[0].name).toContain("FROM alpine");
    expect(steps[1].name).toContain("RUN echo hi");
  });

  it("emits one synthetic step when there are no STEP markers", () => {
    const parser = createPodmanTextParser();
    const events = parser.push("stdout", "just some output\nmore output\n");
    expect(latestSteps(events).length).toBe(1);
  });

  it("emits the built image id from podman's trailing id line", () => {
    const parser = createPodmanTextParser();
    const id = "0d1e2f3a4b5c6d7e8f90112233445566778899aabbccddeeff00112233445566";
    const events = parser.push("stdout", `STEP 1/1: FROM alpine\nCOMMIT app:latest\n--> 0d1e2f3a4b5c\n${id}\n`);
    const image = events.find((e) => e.type === "image");
    expect(image).toEqual({ type: "image", imageId: id });
  });
});
