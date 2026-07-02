import { describe, expect, it } from "vitest";
import { lint } from "@/container-client/builder/containerfile/lint";
import { parse } from "@/container-client/builder/containerfile/parse";
import type { LintFinding } from "@/container-client/builder/types";
import { lintFindingsToMarkers } from "./lintMarkers";

describe("lintFindingsToMarkers", () => {
  it("maps severity and converts 0-based ranges to 1-based Monaco lines", () => {
    const finding: LintFinding = {
      ruleId: "CF002",
      severity: "warning",
      message: "pinned to :latest",
      range: { start: 4, end: 4 },
    };
    const [marker] = lintFindingsToMarkers([finding]);
    expect(marker.severity).toBe(4); // Monaco Warning
    expect(marker.startLineNumber).toBe(5);
    expect(marker.endLineNumber).toBe(5);
    expect(marker.code).toBe("CF002");
    expect(marker.message).toContain("CF002");
  });

  it("produces a warning marker for a :latest base image end-to-end", () => {
    const markers = lintFindingsToMarkers(lint(parse("FROM node:latest\n")));
    expect(markers.some((marker) => marker.severity === 4 && marker.code === "CF002")).toBe(true);
  });
});
