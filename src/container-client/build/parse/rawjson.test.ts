import { describe, expect, it } from "vitest";
import type { BuildEvent } from "../types";
import { createRawjsonParser } from "./rawjson";

function latestSteps(events: BuildEvent[]) {
  const map = new Map<string, any>();
  for (const e of events) {
    if (e.type === "step") {
      map.set(e.step.key, e.step);
    }
  }
  return [...map.values()];
}

describe("createRawjsonParser", () => {
  it("decodes a buildx vertex line into a step and a base64 log", () => {
    const parser = createRawjsonParser();
    const line = JSON.stringify({
      vertexes: [
        { digest: "sha256:aa", name: "[1/2] FROM alpine", started: "t0", completed: "t1", cached: true },
      ],
      logs: [{ vertex: "sha256:aa", msg: btoa("building alpine"), stream: 1 }],
    });
    const events = parser.push("stdout", `${line}\n`);
    const steps = latestSteps(events);
    expect(steps.length).toBe(1);
    expect(steps[0].cached).toBe(true);
    expect(steps[0].name).toContain("FROM alpine");
    const logs = events.filter((e) => e.type === "log");
    expect(logs.some((l) => l.type === "log" && l.line.text.includes("building alpine"))).toBe(true);
  });

  it("tolerates a JSON line split across chunk boundaries", () => {
    const parser = createRawjsonParser();
    const line = JSON.stringify({ vertexes: [{ digest: "sha256:bb", name: "[2/2] RUN echo", completed: "t" }] });
    const half = Math.floor(line.length / 2);
    const events = [...parser.push("stdout", line.slice(0, half)), ...parser.push("stdout", `${line.slice(half)}\n`)];
    expect(latestSteps(events).length).toBe(1);
  });

  it("emits the built image id from a buildx 'writing image' log", () => {
    const parser = createRawjsonParser();
    const id = "0d1e2f3a4b5c6d7e8f90112233445566778899aabbccddeeff00112233445566";
    const line = JSON.stringify({
      vertexes: [{ digest: "sha256:exp", name: "exporting to image" }],
      logs: [{ vertex: "sha256:exp", stream: 1, msg: btoa(`writing image sha256:${id} done`) }],
    });
    const events = parser.push("stdout", `${line}\n`);
    const image = events.find((e) => e.type === "image");
    expect(image).toEqual({ type: "image", imageId: id });
  });
});
