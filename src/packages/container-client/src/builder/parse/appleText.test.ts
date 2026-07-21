import { describe, expect, it } from "vitest";
import type { BuildEvent } from "../types";
import { createAppleTextParser } from "./appleText";

function latestSteps(events: BuildEvent[]) {
  const map = new Map<string, any>();
  for (const e of events) {
    if (e.type === "step") {
      map.set(e.step.key, e.step);
    }
  }
  return [...map.values()];
}

describe("createAppleTextParser", () => {
  it("parses #n vertices with CACHED and DONE markers", () => {
    const parser = createAppleTextParser();
    const events: BuildEvent[] = [
      ...parser.push("stdout", "#1 [1/2] FROM alpine\n#1 CACHED\n"),
      ...parser.push("stdout", "#2 [2/2] RUN echo hi\n#2 DONE 0.3s\n"),
    ];
    const steps = latestSteps(events);
    expect(steps.length).toBe(2);
    expect(steps[0].cached).toBe(true);
    expect(steps[0].status).toBe("cached");
    expect(steps[1].status).toBe("done");
  });

  it("emits the built image id from apple's 'writing image' line", () => {
    const parser = createAppleTextParser();
    const id = "0d1e2f3a4b5c6d7e8f90112233445566778899aabbccddeeff00112233445566";
    const events = parser.push("stdout", `#8 exporting to image\n#8 writing image sha256:${id} done\n`);
    const image = events.find((e) => e.type === "image");
    expect(image).toEqual({ type: "image", imageId: id });
  });
});
